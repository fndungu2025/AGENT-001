"""File reading and field parsing (PRD F-03, Appendix A.1).

Pure library code: no database, no network. Typical flow::

    raw = read_raw(path)                                    # CSV / XLSX / Parquet -> RawTable
    pv = preview(raw, ParseOptions(mapping=...))            # per-field parse rates (F-03 AC4)
    result = parse_frame(raw, ParseOptions(mapping=...))    # canonical typed frame
    raw_to_parquet(raw, "normalized.parquet")               # parse the upload only once

Parsed values follow A.1:
- dates: ISO 8601, ``DD/MM/YYYY HH:MM``, ``MM/DD/YYYY HH:MM`` (``/``, ``-`` or ``.``; optional
  seconds and AM/PM), Excel serial numbers and native XLSX datetimes. If the day/month order is
  ambiguous (every day-first candidate has both parts <= 12) the caller must pass ``date_order``.
  Naive timestamps are localized to ``source_timezone`` and converted to UTC;
- numbers: currency symbols/codes and thousands separators are stripped; a decimal comma is only
  accepted when the CSV delimiter is ``;`` (or ``decimal_comma=True`` is forced);
- invoice IDs and stock codes trimmed and upper-cased; customer refs trimmed, ``"12345.0"`` ->
  ``"12345"``; email-like refs replaced by their HMAC-SHA256 (§6.2).
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any, Final, Literal

import numpy as np
import openpyxl  # type: ignore[import-untyped]  # no types-openpyxl in the env
import pandas as pd  # type: ignore[import-untyped]  # no pandas-stubs in the env

from customeriq.privacy import hash_email_refs
from customeriq.schema import FIELD_NAMES, PARSED_SCHEMA, REQUIRED_FIELDS, TS_DTYPE

FileType = Literal["csv", "xlsx", "parquet"]
DateOrder = Literal["auto", "DMY", "MDY"]
DetectedOrder = Literal["DMY", "MDY", "ambiguous", "inconsistent", "none"]

MAX_FILE_BYTES: Final[int] = 100 * 1024 * 1024  # F-03 AC1
MAX_ROWS: Final[int] = 2_000_000  # F-03 AC1
PREVIEW_ROWS: Final[int] = 200  # F-03 AC3
MIN_PREVIEW_PARSE_RATE: Final[float] = 0.95  # F-03 AC4
EXCEL_EPOCH: Final[pd.Timestamp] = pd.Timestamp("1899-12-30")
EXCEL_SERIAL_MAX: Final[float] = 2_958_466.0  # 9999-12-31
NULL_TOKENS: Final[frozenset[str]] = frozenset({"", "nan", "NaN", "None", "NaT", "<NA>"})
TYPED_FIELDS: Final[tuple[str, ...]] = ("invoice_ts", "quantity", "unit_price", "line_total")
TEXT_FIELDS: Final[tuple[str, ...]] = (
    "invoice_id",
    "customer_ref",
    "stock_code",
    "description",
    "country",
)
CURRENCY_SYMBOLS: Final[dict[str, str]] = {"£": "GBP", "€": "EUR", "¥": "JPY", "₹": "INR", "$": "$"}


class ParseError(Exception):
    """A file-level problem. ``code`` is a stable sub-code; the worker maps all to PARSE_ERROR."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# =============================================================================== reading
@dataclass(frozen=True, slots=True)
class RawTable:
    """A file read as-is: one column per header, values as strings (CSV/Parquet) or Python
    objects (XLSX). ``frame`` has a fresh RangeIndex; row i is source row ``i + 1``."""

    frame: pd.DataFrame
    file_type: FileType
    encoding: str | None = None
    delimiter: str | None = None
    sheets: tuple[str, ...] = ()

    @property
    def headers(self) -> list[str]:
        return [str(c) for c in self.frame.columns]


def detect_file_type(head: bytes) -> FileType:
    """Magic-byte check on the first bytes of a file (>= 8 KiB recommended)."""
    if not head:
        raise ParseError("EMPTY_FILE", "The file is empty.")
    if head.startswith(b"PK\x03\x04"):
        return "xlsx"  # confirmed as a workbook in _read_xlsx
    if head.startswith(b"PAR1"):
        return "parquet"
    if head.startswith(b"\xd0\xcf\x11\xe0"):
        raise ParseError(
            "UNSUPPORTED_FILE_TYPE", "Legacy .xls files are not supported; save as .xlsx or .csv."
        )
    binary = (b"%PDF", b"\x89PNG", b"GIF8", b"\xff\xd8\xff", b"\x1f\x8b", b"7z\xbc\xaf", b"Rar!")
    if head.startswith(binary):
        raise ParseError("UNSUPPORTED_FILE_TYPE", "Only .csv and .xlsx files are supported.")
    if head.startswith((b"\xff\xfe", b"\xfe\xff")):
        return "csv"  # UTF-16 text with BOM
    if b"\x00" in head[:8192]:
        raise ParseError("UNSUPPORTED_FILE_TYPE", "The file looks binary, not CSV text.")
    return "csv"


def detect_encoding(data: bytes) -> str:
    """UTF-8 (with or without BOM), UTF-16 with BOM, else Windows-1252 (latin-1 last resort)."""
    if data.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return "utf-16"
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        pass
    else:
        return "utf-8"
    try:
        data.decode("cp1252")
    except UnicodeDecodeError:
        return "latin-1"
    return "cp1252"


def detect_delimiter(text: str) -> str:
    """Comma, semicolon or tab, sniffed on the first lines (header-count fallback)."""
    sample = "\n".join(text.splitlines()[:50])
    try:
        found = csv.Sniffer().sniff(sample, delimiters=",;\t").delimiter
    except csv.Error:
        found = ""
    if found in {",", ";", "\t"}:
        return found
    header = sample.split("\n", 1)[0]
    counts = {d: header.count(d) for d in (",", ";", "\t")}
    return max(counts, key=lambda d: counts[d]) if max(counts.values()) > 0 else ","


def _load_bytes(source: str | Path | bytes) -> bytes:
    data = source if isinstance(source, bytes) else Path(source).read_bytes()
    if len(data) > MAX_FILE_BYTES:
        raise ParseError("FILE_TOO_LARGE", "The file is larger than 100 MB.")
    return data


def _check_rows(frame: pd.DataFrame) -> pd.DataFrame:
    if len(frame) > MAX_ROWS:
        raise ParseError("TOO_MANY_ROWS", f"The file has more than {MAX_ROWS:,} rows.")
    if frame.shape[1] == 0:
        raise ParseError("EMPTY_FILE", "No header row was found.")
    return frame.reset_index(drop=True)


def _read_csv(data: bytes, nrows: int | None) -> RawTable:
    encoding = detect_encoding(data)
    text = data.decode(encoding)
    if not text.strip():
        raise ParseError("EMPTY_FILE", "The file is empty.")
    delimiter = detect_delimiter(text)
    try:
        frame = pd.read_csv(
            io.StringIO(text),
            sep=delimiter,
            dtype=str,
            keep_default_na=False,
            na_filter=False,
            nrows=nrows,
            skip_blank_lines=True,
        )
    except (pd.errors.ParserError, ValueError) as exc:
        raise ParseError("MALFORMED_CSV", "The CSV could not be read.") from exc
    frame.columns = [str(c).strip() for c in frame.columns]
    frame = frame.astype(object)
    return RawTable(_check_rows(frame), "csv", encoding=encoding, delimiter=delimiter)


def list_sheets(source: str | Path | bytes) -> list[str]:
    """Sheet names of an XLSX workbook (read-only)."""
    wb = _open_workbook(_load_bytes(source))
    try:
        return [str(n) for n in wb.sheetnames]
    finally:
        wb.close()


def _open_workbook(data: bytes) -> Any:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            if "xl/workbook.xml" not in zf.namelist():
                raise ParseError("UNSUPPORTED_FILE_TYPE", "The zip file is not an .xlsx workbook.")
    except zipfile.BadZipFile as exc:
        raise ParseError("UNSUPPORTED_FILE_TYPE", "The .xlsx file is corrupt.") from exc
    return openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)


def _read_xlsx(data: bytes, sheets: Sequence[str] | None, nrows: int | None) -> RawTable:
    wb = _open_workbook(data)
    try:
        names = [str(n) for n in wb.sheetnames]
        chosen = list(sheets) if sheets else names
        unknown = [s for s in chosen if s not in names]
        if unknown:
            raise ParseError("UNKNOWN_SHEET", f"Sheet(s) not found: {', '.join(unknown)}.")
        frames: list[pd.DataFrame] = []
        remaining = nrows
        for name in chosen:
            if remaining is not None and remaining <= 0:
                break
            rows = wb[name].iter_rows(values_only=True)
            header: list[str] | None = None
            body: list[tuple[Any, ...]] = []
            for row in rows:
                if all(v is None or (isinstance(v, str) and not v.strip()) for v in row):
                    continue
                if header is None:
                    header = [
                        str(v).strip() if v is not None else f"column_{i + 1}"
                        for i, v in enumerate(row)
                    ]
                    continue
                body.append(tuple(row[: len(header)]) + (None,) * (len(header) - len(row)))
                if remaining is not None and len(body) >= remaining:
                    break
            if header is None:
                continue
            frames.append(pd.DataFrame(body, columns=header, dtype=object))
            if remaining is not None:
                remaining -= len(body)
    finally:
        wb.close()
    if not frames:
        raise ParseError("EMPTY_FILE", "The workbook has no data.")
    frame = pd.concat(frames, ignore_index=True, sort=False).astype(object)
    return RawTable(_check_rows(frame), "xlsx", sheets=tuple(chosen))


def read_raw(
    source: str | Path | bytes,
    *,
    sheets: Sequence[str] | None = None,
    nrows: int | None = None,
) -> RawTable:
    """Read a CSV, XLSX (all or the chosen sheets, concatenated) or our own Parquet file.

    ``nrows`` limits data rows (use :data:`PREVIEW_ROWS` for the mapping preview).
    """
    data = _load_bytes(source)
    kind = detect_file_type(data[:8192])
    if kind == "xlsx":
        return _read_xlsx(data, sheets, nrows)
    if kind == "parquet":
        frame = pd.read_parquet(io.BytesIO(data))
        if nrows is not None:
            frame = frame.head(nrows)
        return RawTable(_check_rows(frame.astype(object)), "parquet")
    return _read_csv(data, nrows)


def _cell_to_text(v: Any) -> str | None:
    if v is None or (isinstance(v, float) and np.isnan(v)) or v is pd.NaT:
        return None
    if isinstance(v, datetime | date):
        return v.isoformat()
    return str(v)


def raw_to_parquet(raw: RawTable, path: str | Path) -> Path:
    """Persist a RawTable as an all-text Parquet file (F-03: parse the upload only once).

    XLSX datetimes become ISO strings, numbers their ``str()``; ``read_raw`` reads it back."""
    out = Path(path)
    text = pd.DataFrame(
        {c: pd.array([_cell_to_text(v) for v in raw.frame[c]], dtype="string") for c in raw.headers}
    )
    text.to_parquet(out, index=False)
    return out


def write_parquet(frame: pd.DataFrame, path: str | Path) -> Path:
    """Write a parsed/cleaned frame to Parquet (dtypes preserved)."""
    out = Path(path)
    frame.to_parquet(out, index=False)
    return out


# =============================================================================== text helpers
def normalize_text(values: pd.Series) -> pd.Series:
    """Trim; blank and null tokens (``nan``, ``None``…) become <NA>. Returns string dtype."""
    s = pd.Series([_cell_to_text(v) for v in values], index=values.index, dtype="string")
    s = s.str.strip()
    return s.mask(s.isin(NULL_TOKENS))


def normalize_customer_ref(values: pd.Series) -> pd.Series:
    """A.1: trim; numeric refs normalized (``"12345.0"`` -> ``"12345"``)."""
    s = normalize_text(values)
    return s.str.replace(r"^(\d+)\.0+$", r"\1", regex=True)


def normalize_code(values: pd.Series) -> pd.Series:
    """A.1: invoice IDs and stock codes are trimmed and upper-cased."""
    return normalize_text(values).str.upper()


_TRUE = {"true", "t", "yes", "y", "1"}
_FALSE = {"false", "f", "no", "n", "0"}


def parse_bool(values: pd.Series) -> pd.Series:
    s = normalize_text(values).str.lower()
    out = pd.Series(pd.NA, index=values.index, dtype="boolean")
    out[s.isin(_TRUE).fillna(False).astype(bool)] = True
    out[s.isin(_FALSE).fillna(False).astype(bool)] = False
    return out


# =============================================================================== numbers
_CODE_RE = r"(?:[A-Z]{3})"
_SYMBOL_RE = "[" + re.escape("".join(CURRENCY_SYMBOLS)) + "]"
_NUM_DOT = re.compile(r"^[+-]?(?:\d{1,3}(?:[, ']\d{3})+|\d+)?(?:\.\d+)?(?:[eE][+-]?\d+)?$")
_NUM_COMMA = re.compile(r"^[+-]?(?:\d{1,3}(?:[. ']\d{3})+|\d+)?(?:,\d+)?$")


@dataclass(frozen=True, slots=True)
class NumberParse:
    values: pd.Series  # float64, NaN where unparseable or blank
    currencies: frozenset[str]


def parse_numbers(values: pd.Series, *, decimal_comma: bool = False) -> NumberParse:
    """Parse numbers per A.1. Native numbers pass through; strings are cleaned of currency
    symbols/ISO codes, spaces and thousands separators. ``(12.50)`` means -12.50."""
    out = np.full(len(values), np.nan, dtype="float64")
    obj = values.to_numpy(dtype=object)
    is_num = np.array(
        [
            isinstance(v, int | float | np.integer | np.floating) and not isinstance(v, bool)
            for v in obj
        ],
        dtype=bool,
    )
    if is_num.any():
        out[is_num] = np.asarray(obj[is_num], dtype="float64")
    currencies: set[str] = set()
    str_idx = np.flatnonzero(~is_num)
    if len(str_idx):
        s = normalize_text(pd.Series(obj[str_idx]))
        s = s.str.replace("\u00a0", " ", regex=False).str.replace("\u202f", " ", regex=False)
        sym = s.str.extract(f"({_SYMBOL_RE})", expand=False).dropna()
        code = s.str.extract(rf"^({_CODE_RE})\s*|\s*({_CODE_RE})$", expand=True)
        code_any = code[0].fillna(code[1]).dropna()
        currencies |= {CURRENCY_SYMBOLS[str(c)] for c in sym.unique()}
        currencies |= {str(c) for c in code_any.unique()}
        s = s.str.replace(_SYMBOL_RE, "", regex=True)
        s = s.str.replace(rf"^{_CODE_RE}\s*|\s*{_CODE_RE}$", "", regex=True).str.strip()
        neg = s.str.fullmatch(r"\(.*\)").fillna(False).astype(bool)
        s = s.mask(neg, s.str.slice(1, -1)).str.strip()
        s = s.str.replace(r"^([+-])\s+", r"\1", regex=True)
        if decimal_comma:
            ok = s.str.fullmatch(_NUM_COMMA.pattern).fillna(False).astype(bool)
            cleaned = s.str.replace(r"[. ']", "", regex=True).str.replace(",", ".", regex=False)
        else:
            ok = s.str.fullmatch(_NUM_DOT.pattern).fillna(False).astype(bool)
            cleaned = s.str.replace(r"[, ']", "", regex=True)
        ok &= cleaned.str.contains(r"\d", regex=True).fillna(False).astype(bool)
        parsed = pd.to_numeric(cleaned.where(ok), errors="coerce").astype("float64")
        parsed = parsed.where(~neg, -parsed)
        out[str_idx] = parsed.to_numpy(dtype="float64", na_value=np.nan)
    out[~np.isfinite(out)] = np.nan
    return NumberParse(pd.Series(out, index=values.index, dtype="float64"), frozenset(currencies))


# =============================================================================== dates
_YMD = re.compile(
    r"^(?P<y>\d{4})[-/.](?P<a>\d{1,2})[-/.](?P<b>\d{1,2})"
    r"(?:[ T](?P<H>\d{1,2}):(?P<M>\d{2})(?::(?P<S>\d{2})(?:[.,](?P<f>\d{1,9}))?)?)?"
    r"\s*(?P<tz>Z|[+-]\d{2}:?\d{2})?$"
)
_XYZ = re.compile(
    r"^(?P<a>\d{1,2})[-/.](?P<b>\d{1,2})[-/.](?P<y>\d{4}|\d{2})"
    r"(?:[ T,]+(?P<H>\d{1,2}):(?P<M>\d{2})(?::(?P<S>\d{2}))?\s*(?P<p>[AaPp][Mm])?)?$"
)
_SERIAL = re.compile(r"^\d+(?:\.\d+)?$")


@dataclass(frozen=True, slots=True)
class DateOrderDetection:
    """Day/month order evidence among ``a/b/yyyy`` strings in a sample."""

    order: DetectedOrder
    candidates: int  # values in a/b/yyyy form
    first_gt_12: int
    second_gt_12: int

    @property
    def needs_confirmation(self) -> bool:
        return self.order in ("ambiguous", "inconsistent")


def _text_series(values: pd.Series) -> pd.Series:
    return normalize_text(values)


def detect_date_order(values: pd.Series) -> DateOrderDetection:
    """DMY if some first part > 12, MDY if some second part > 12; if neither, ambiguous."""
    s = _text_series(values).dropna()
    parts = s.str.extract(_XYZ.pattern).dropna(subset=["a", "b"])
    a = parts["a"].astype(int)
    b = parts["b"].astype(int)
    n, fa, sb = len(parts), int((a > 12).sum()), int((b > 12).sum())
    order: DetectedOrder
    if n == 0:
        order = "none"
    elif fa and sb:
        order = "inconsistent"
    elif fa:
        order = "DMY"
    elif sb:
        order = "MDY"
    else:
        order = "ambiguous"
    return DateOrderDetection(order, n, fa, sb)


def _localize(naive: pd.Series, tz: str) -> pd.Series:
    """Naive wall-clock -> tz -> UTC. DST-ambiguous times resolve to standard time and
    non-existent times shift forward (deterministic, no rows lost)."""
    if naive.empty:
        return naive.astype(TS_DTYPE)
    local = naive.dt.tz_localize(
        tz, ambiguous=np.zeros(len(naive), dtype=bool), nonexistent="shift_forward"
    )
    return local.dt.tz_convert("UTC").dt.as_unit("us")


def _from_parts(
    parts: pd.DataFrame, year: pd.Series, month: pd.Series, day: pd.Series
) -> pd.Series:
    hour = parts["H"].fillna("0").astype(int)
    if "p" in parts:
        pm = parts["p"].str.lower().eq("pm").fillna(False).astype(bool)
        am = parts["p"].str.lower().eq("am").fillna(False).astype(bool)
        bad = (pm | am) & ((hour < 1) | (hour > 12))
        hour = hour.where(~(pm & (hour < 12)), hour + 12).where(~(am & (hour == 12)), 0)
        hour = hour.where(~bad, 99)
    frac = parts["f"].fillna("0") if "f" in parts else pd.Series("0", index=parts.index)
    micro = frac.str.slice(0, 6).str.ljust(6, "0").astype(int)
    comp = pd.DataFrame(
        {
            "year": year,
            "month": month,
            "day": day,
            "hour": hour,
            "minute": parts["M"].fillna("0").astype(int),
            "second": parts["S"].fillna("0").astype(int),
            "microsecond": micro,
        }
    )
    valid = (comp["hour"] < 24) & (comp["minute"] < 60) & (comp["second"] < 60)
    ts = pd.to_datetime(comp, errors="coerce").dt.as_unit("us")
    return ts.where(valid)


def parse_datetimes(
    values: pd.Series,
    *,
    source_timezone: str = "UTC",
    date_order: DateOrder = "auto",
    date_format: str | None = None,
) -> pd.Series:
    """Parse to ``datetime64[us, UTC]``; NaT where unparseable or blank.

    Raises ParseError(AMBIGUOUS_DATE_ORDER) when ``date_order='auto'`` and the day-first /
    month-first order cannot be determined from the values.
    """
    out = pd.Series(pd.NaT, index=values.index, dtype=TS_DTYPE)
    obj = values.to_numpy(dtype=object)
    is_dt = np.array([isinstance(v, datetime | date | pd.Timestamp) for v in obj], dtype=bool)
    is_num = np.array(
        [
            isinstance(v, int | float | np.integer | np.floating) and not isinstance(v, bool)
            for v in obj
        ],
        dtype=bool,
    )
    idx = values.index
    if is_dt.any():
        stamps = [pd.Timestamp(v) for v in obj[is_dt]]
        aware = np.array([t.tzinfo is not None for t in stamps], dtype=bool)
        sub = idx[is_dt]
        if (~aware).any():
            naive = pd.Series([t for t, a in zip(stamps, aware, strict=True) if not a])
            out.loc[sub[~aware]] = _localize(
                pd.to_datetime(naive).dt.as_unit("us"), source_timezone
            ).to_numpy()
        if aware.any():
            conv = [t.tz_convert("UTC") for t, a in zip(stamps, aware, strict=True) if a]
            out.loc[sub[aware]] = pd.to_datetime(conv, utc=True).as_unit("us")
    text = _text_series(pd.Series(obj, index=idx)).where(~is_dt & ~is_num)
    serial_txt = text.str.fullmatch(_SERIAL.pattern).fillna(False).astype(bool)
    serial = pd.Series(np.nan, index=idx, dtype="float64")
    if is_num.any():
        serial[is_num] = np.asarray(obj[is_num], dtype="float64")
    if serial_txt.any():
        serial[serial_txt] = text[serial_txt].astype(float)
    in_range = serial.notna() & (serial >= 1) & (serial < EXCEL_SERIAL_MAX)
    if in_range.any():
        naive = (EXCEL_EPOCH + pd.to_timedelta(serial[in_range], unit="D")).dt.round("s")
        out[in_range] = _localize(naive.dt.as_unit("us"), source_timezone)
    rest = text.where(~serial_txt).dropna()
    if rest.empty:
        return out
    if date_format is not None and date_format != "auto":
        naive = pd.to_datetime(rest, format=date_format, errors="coerce").dt.as_unit("us")
        out[naive.notna().reindex(idx, fill_value=False)] = _localize(
            naive.dropna(), source_timezone
        )
        return out
    ymd = rest.str.extract(_YMD.pattern).dropna(subset=["y"])
    if not ymd.empty:
        ts = _from_parts(ymd, ymd["y"].astype(int), ymd["a"].astype(int), ymd["b"].astype(int))
        tzs = ymd["tz"]
        has_off = tzs.notna() & ts.notna()
        naive_ok = tzs.isna() & ts.notna()
        if naive_ok.any():
            out[naive_ok[naive_ok].index] = _localize(ts[naive_ok], source_timezone)
        if has_off.any():
            off = tzs[has_off].str.replace(":", "", regex=False)
            minutes = off.map(
                lambda o: (
                    0 if o == "Z" else (1 if o[0] == "+" else -1) * (int(o[1:3]) * 60 + int(o[3:5]))
                )
            )
            utc = ts[has_off] - pd.to_timedelta(minutes.astype(int), unit="min")
            out[has_off[has_off].index] = utc.dt.tz_localize("UTC").dt.as_unit("us")
    xyz = rest.str.extract(_XYZ.pattern).dropna(subset=["a"])
    if not xyz.empty:
        order: str = date_order
        if order == "auto":
            det = detect_date_order(rest)
            if det.needs_confirmation:
                raise ParseError(
                    "AMBIGUOUS_DATE_ORDER",
                    "Dates could be day-first or month-first; please confirm the date order.",
                )
            order = det.order
        a, b = xyz["a"].astype(int), xyz["b"].astype(int)
        day, month = (a, b) if order == "DMY" else (b, a)
        y = xyz["y"].astype(int)
        y = y.where(y >= 100, y.where(y >= 70, y + 2000).where(y < 70, y + 1900))
        ts = _from_parts(xyz, y, month, day)
        ok = ts.notna()
        if ok.any():
            out[ok[ok].index] = _localize(ts[ok], source_timezone)
    return out


# =============================================================================== frame parsing
@dataclass(frozen=True, slots=True)
class ParseOptions:
    """How to turn a RawTable into canonical fields.

    ``mapping`` is canonical field -> source column (as stored in
    ``dataset_column_mappings.mapping``). ``decimal_comma=None`` means "only if the CSV
    delimiter is ``;``" (A.1). ``org_salt`` is required if any customer ref is email-like.
    ``currency_column`` (optional, not a canonical field) feeds mixed-currency detection.
    """

    mapping: Mapping[str, str]
    source_timezone: str = "UTC"
    date_order: DateOrder = "auto"
    date_format: str | None = None
    decimal_comma: bool | None = None
    org_salt: bytes | str | None = field(default=None, repr=False)
    currency_column: str | None = None


@dataclass(frozen=True, slots=True)
class FieldParseReport:
    """Per-field parse statistics (F-03 AC4). For typed fields (dates, numbers) a blank value
    counts as a failure; for text fields the rate is over non-blank values and is 1.0."""

    field: str
    source_column: str
    rows: int
    blank: int
    parsed: int
    failed: int
    parse_rate: float


@dataclass(frozen=True, slots=True)
class ParseResult:
    frame: pd.DataFrame  # validated by schema.PARSED_SCHEMA
    field_reports: dict[str, FieldParseReport]
    date_order: DateOrderDetection
    currencies_detected: frozenset[str]
    emails_hashed: int


def _check_mapping(mapping: Mapping[str, str], headers: Sequence[str]) -> None:
    unknown = [f for f in mapping if f not in FIELD_NAMES]
    if unknown:
        raise ParseError("INVALID_MAPPING", f"Unknown canonical field(s): {', '.join(unknown)}.")
    missing = [f for f in REQUIRED_FIELDS if f not in mapping]
    if missing:
        raise ParseError("INVALID_MAPPING", f"Required field(s) not mapped: {', '.join(missing)}.")
    absent = sorted({c for c in mapping.values() if c not in headers})
    if absent:
        raise ParseError("MISSING_COLUMN", f"Column(s) not in the file: {', '.join(absent)}.")


def _report(
    name: str, col: str, raw_blank: pd.Series, ok: pd.Series, typed: bool
) -> FieldParseReport:
    rows = len(ok)
    blank = int(raw_blank.sum())
    parsed = int(ok.sum())
    denom = rows if typed else rows - blank
    failed = denom - parsed
    rate = 1.0 if denom == 0 else parsed / denom
    return FieldParseReport(name, col, rows, blank, parsed, failed, round(rate, 6))


def parse_frame(raw: RawTable | pd.DataFrame, options: ParseOptions) -> ParseResult:
    """Map and parse every row into canonical, typed columns (PARSED_SCHEMA).

    Rows are never dropped here: unparseable required values are null and named in
    ``parse_error`` (``;``-separated field names) so cleaning rule R1 can exclude and count them.
    """
    table = raw if isinstance(raw, RawTable) else RawTable(raw.reset_index(drop=True), "csv")
    src = table.frame
    m = dict(options.mapping)
    _check_mapping(m, table.headers)
    decimal_comma = (
        options.decimal_comma if options.decimal_comma is not None else table.delimiter == ";"
    )
    idx = src.index
    out = pd.DataFrame(index=idx)
    out["source_row_num"] = np.arange(1, len(src) + 1, dtype="int64")
    reports: dict[str, FieldParseReport] = {}

    def col(name: str) -> pd.Series:
        return src[m[name]] if name in m else pd.Series([None] * len(src), index=idx, dtype=object)

    for name in TEXT_FIELDS:
        raw_col = col(name)
        if name in ("invoice_id", "stock_code"):
            values = normalize_code(raw_col)
        elif name == "customer_ref":
            values = normalize_customer_ref(raw_col)
        else:
            values = normalize_text(raw_col)
        out[name] = values
        if name in m:
            blank = values.isna()
            reports[name] = _report(name, m[name], blank, ~blank, typed=False)

    hashed, n_hashed = hash_email_refs(out["customer_ref"], options.org_salt)
    out["customer_ref"] = hashed

    currencies: set[str] = set()
    for name in ("quantity", "unit_price", "line_total"):
        raw_col = col(name)
        parsed = parse_numbers(raw_col, decimal_comma=decimal_comma)
        out[name] = parsed.values
        if name in ("unit_price", "line_total"):
            currencies |= parsed.currencies
        if name in m:
            blank = normalize_text(raw_col).isna()
            reports[name] = _report(name, m[name], blank, parsed.values.notna(), typed=True)

    detection = detect_date_order(col("invoice_ts"))
    order = options.date_order
    if order == "auto" and detection.order in ("DMY", "MDY"):
        order = detection.order
    out["invoice_ts"] = parse_datetimes(
        col("invoice_ts"),
        source_timezone=options.source_timezone,
        date_order=order,
        date_format=options.date_format,
    )
    blank_ts = normalize_text(col("invoice_ts")).isna()
    reports["invoice_ts"] = _report(
        "invoice_ts", m["invoice_ts"], blank_ts, out["invoice_ts"].notna(), typed=True
    )

    if "is_cancellation" in m:
        out["is_cancellation_src"] = parse_bool(col("is_cancellation"))
    else:
        out["is_cancellation_src"] = pd.Series(pd.NA, index=idx, dtype="boolean")

    if options.currency_column is not None:
        if options.currency_column not in table.headers:
            raise ParseError(
                "MISSING_COLUMN", f"Column not in the file: {options.currency_column}."
            )
        cur = normalize_text(src[options.currency_column]).str.upper().dropna().unique()
        currencies |= {str(c) for c in cur}

    errors = pd.DataFrame(
        {
            "invoice_id": out["invoice_id"].isna(),
            "invoice_ts": out["invoice_ts"].isna(),
            "quantity": out["quantity"].isna(),
            "unit_price": out["unit_price"].isna(),
            "line_total": out["line_total"].isna() & ~normalize_text(col("line_total")).isna(),
        }
    )
    labels = np.array(errors.columns, dtype=object)
    joined = [";".join(labels[row]) for row in errors.to_numpy(dtype=bool)]
    out["parse_error"] = pd.Series(joined, index=idx, dtype="string").replace("", pd.NA)

    out = PARSED_SCHEMA.validate(out)
    return ParseResult(out, reports, detection, frozenset(currencies), n_hashed)


# =============================================================================== preview
@dataclass(frozen=True, slots=True)
class PreviewResult:
    """F-03 AC3/AC4: parse rates on the first rows and whether the mapping may be submitted."""

    rows: pd.DataFrame  # first ``display_rows`` parsed rows (customer refs already hashed)
    field_reports: dict[str, FieldParseReport]
    date_order: DateOrderDetection
    currencies_detected: frozenset[str]
    problems: list[str]

    @property
    def ok(self) -> bool:
        return not self.problems


def preview(
    raw: RawTable,
    options: ParseOptions,
    *,
    n_rows: int = PREVIEW_ROWS,
    display_rows: int = 20,
) -> PreviewResult:
    """Parse the first ``n_rows`` rows and check AC4 (every mapped field >= 95% parsed).

    An ambiguous date order is reported as a problem (the user must choose DMY or MDY) instead
    of raising.
    """
    head = RawTable(
        raw.frame.head(n_rows).reset_index(drop=True),
        raw.file_type,
        raw.encoding,
        raw.delimiter,
        raw.sheets,
    )
    problems: list[str] = []
    m = dict(options.mapping)
    try:
        _check_mapping(m, head.headers)
    except ParseError as exc:
        return PreviewResult(
            head.frame.head(0), {}, DateOrderDetection("none", 0, 0, 0), frozenset(), [exc.message]
        )
    detection = detect_date_order(head.frame[m["invoice_ts"]])
    opts = options
    if options.date_order == "auto" and detection.needs_confirmation:
        problems.append("DATE_ORDER_REQUIRED: confirm whether dates are day-first or month-first.")
        opts = ParseOptions(**{**_options_dict(options), "date_order": "DMY"})
    try:
        result = parse_frame(head, opts)
    except ParseError as exc:
        return PreviewResult(
            head.frame.head(0), {}, detection, frozenset(), [*problems, exc.message]
        )
    for rep in result.field_reports.values():
        if rep.parse_rate < MIN_PREVIEW_PARSE_RATE:
            problems.append(
                f"LOW_PARSE_RATE: {rep.field} ({rep.source_column}) parsed on "
                f"{rep.parse_rate:.0%} of preview rows (minimum 95%)."
            )
    return PreviewResult(
        result.frame.head(display_rows),
        result.field_reports,
        detection,
        result.currencies_detected,
        problems,
    )


def _options_dict(o: ParseOptions) -> dict[str, Any]:
    return {
        "mapping": o.mapping,
        "source_timezone": o.source_timezone,
        "date_order": o.date_order,
        "date_format": o.date_format,
        "decimal_comma": o.decimal_comma,
        "org_salt": o.org_salt,
        "currency_column": o.currency_column,
    }
