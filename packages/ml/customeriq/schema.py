"""Canonical order-line fields (PRD F-03) and pandera schemas for the ingest stage boundaries.

Stage boundaries:
- ``PARSED_SCHEMA``: output of :func:`customeriq.parsing.parse_frame` (every source row, typed;
  unparseable values are null and listed in ``parse_error``).
- ``CLEANED_SCHEMA``: output of :func:`customeriq.cleaning.clean` (``CleaningResult.lines``: every
  parsed row plus integer money columns, ``exclusion_reason`` and flags).
- ``CURATED_SCHEMA``: kept rows only (``CleaningResult.kept``), the shape the loader writes to
  ``fact_order_line``.

Money is carried as exact integers: quantity in thousandths (numeric(14,3)), unit price and
line revenue in ten-thousandths (numeric(14,4) / numeric(16,4)).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

import pandera.pandas as pa

FieldName = Literal[
    "invoice_id",
    "invoice_ts",
    "customer_ref",
    "quantity",
    "unit_price",
    "stock_code",
    "description",
    "country",
    "is_cancellation",
    "line_total",
]


@dataclass(frozen=True, slots=True)
class CanonicalField:
    """One mapping target from the PRD F-03 canonical fields table."""

    name: FieldName
    required: bool
    db_type: str
    uci_column: str | None
    description: str


CANONICAL_FIELDS: Final[tuple[CanonicalField, ...]] = (
    CanonicalField("invoice_id", True, "text", "Invoice", "Order or invoice number"),
    CanonicalField("invoice_ts", True, "timestamptz", "InvoiceDate", "Order date/time"),
    CanonicalField("customer_ref", True, "text", "Customer ID", "Stable customer identifier"),
    CanonicalField("quantity", True, "numeric(14,3)", "Quantity", "Negative = return"),
    CanonicalField("unit_price", True, "numeric(14,4)", "Price", "In dataset currency"),
    CanonicalField("stock_code", False, "text", "StockCode", "Product code / SKU"),
    CanonicalField("description", False, "text", "Description", "Product name"),
    CanonicalField("country", False, "text", "Country", "Customer country"),
    CanonicalField("is_cancellation", False, "boolean", None, "Derived per A.2 if not mapped"),
    CanonicalField("line_total", False, "numeric", None, "Used instead of qty x price"),
)
FIELD_NAMES: Final[tuple[FieldName, ...]] = tuple(f.name for f in CANONICAL_FIELDS)
REQUIRED_FIELDS: Final[tuple[FieldName, ...]] = tuple(
    f.name for f in CANONICAL_FIELDS if f.required
)
UCI_MAPPING: Final[dict[FieldName, str]] = {
    f.name: f.uci_column for f in CANONICAL_FIELDS if f.uci_column is not None
}

# Scale factors for exact integer money arithmetic.
QTY_SCALE: Final[int] = 1_000  # numeric(14,3)
PRICE_SCALE: Final[int] = 10_000  # numeric(14,4)
REVENUE_SCALE: Final[int] = 10_000  # numeric(16,4)

TS_DTYPE: Final[str] = "datetime64[us, UTC]"

# Exclusion reasons (F-03 AC7 wording), one per excluding rule.
EXCLUSION_REASONS: Final[dict[str, str]] = {
    "R1": "parse_error",
    "R2": "missing_customer",
    "R3": "duplicate",
    "R4": "cancellation",
    "R5": "non_positive_price",
    "R6": "non_product",
    "R7": "invalid_date",
}

_TEXT = {
    "invoice_id": pa.Column("string", nullable=True),
    "customer_ref": pa.Column("string", nullable=True),
    "stock_code": pa.Column("string", nullable=True),
    "description": pa.Column("string", nullable=True),
    "country": pa.Column("string", nullable=True),
}

PARSED_SCHEMA: Final[pa.DataFrameSchema] = pa.DataFrameSchema(
    {
        "source_row_num": pa.Column("int64", pa.Check.ge(1), unique=True),
        **_TEXT,
        "invoice_ts": pa.Column(TS_DTYPE, nullable=True),
        "quantity": pa.Column("float64", nullable=True),
        "unit_price": pa.Column("float64", nullable=True),
        "line_total": pa.Column("float64", nullable=True),
        "is_cancellation_src": pa.Column("boolean", nullable=True),
        "parse_error": pa.Column("string", nullable=True),
    },
    strict=True,
    ordered=False,
)

CLEANED_SCHEMA: Final[pa.DataFrameSchema] = PARSED_SCHEMA.add_columns(
    {
        "quantity_milli": pa.Column("Int64", nullable=True),
        "unit_price_e4": pa.Column("Int64", nullable=True),
        "line_revenue_e4": pa.Column("Int64", nullable=True),
        "is_cancellation": pa.Column("boolean", nullable=True),
        "is_non_product": pa.Column("boolean"),
        "is_wholesale": pa.Column("boolean"),
        "exclusion_rule": pa.Column("string", nullable=True),
        "exclusion_reason": pa.Column(
            "string", pa.Check.isin(list(EXCLUSION_REASONS.values())), nullable=True
        ),
        "kept": pa.Column("boolean"),
    }
)

CURATED_SCHEMA: Final[pa.DataFrameSchema] = pa.DataFrameSchema(
    {
        "source_row_num": pa.Column("int64", pa.Check.ge(1), unique=True),
        "invoice_id": pa.Column("string", pa.Check.str_length(min_value=1)),
        "invoice_ts": pa.Column(TS_DTYPE),
        "customer_ref": pa.Column("string", pa.Check.str_length(1, 128)),
        "stock_code": pa.Column("string", nullable=True),
        "description": pa.Column("string", nullable=True),
        "country": pa.Column("string", nullable=True),
        "quantity_milli": pa.Column("Int64", pa.Check.ne(0)),
        "unit_price_e4": pa.Column("Int64", pa.Check.ge(0)),
        "line_revenue_e4": pa.Column("Int64"),
        "is_cancellation": pa.Column("boolean"),
        "is_non_product": pa.Column("boolean"),
        "is_wholesale": pa.Column("boolean"),
    },
    strict=True,
    ordered=False,
)
