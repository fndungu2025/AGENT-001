"""PII minimization on ingest (PRD §6.2).

If a customer ref looks like an email, it is replaced with
``HMAC-SHA256(org_salt, lower(trim(email)))`` as 64 lowercase hex characters. The raw email never
leaves this function: callers receive only the hashed series and a count.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from typing import Final

import pandas as pd  # type: ignore[import-untyped]  # no pandas-stubs in the env

EMAIL_RE: Final[re.Pattern[str]] = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_SALT_BYTES: Final[int] = 16


class MissingSaltError(ValueError):
    """Raised when email-like refs are present but no usable org salt was supplied."""


def _salt_bytes(salt: bytes | str | None) -> bytes:
    if salt is None:
        raise MissingSaltError("an org salt is required to hash email-like customer refs")
    raw = salt.encode("utf-8") if isinstance(salt, str) else salt
    if len(raw) < MIN_SALT_BYTES:
        raise MissingSaltError(f"org salt must be at least {MIN_SALT_BYTES} bytes")
    return raw


def looks_like_email(value: str) -> bool:
    """True if ``value`` (trimmed) matches the email regex."""
    return bool(EMAIL_RE.match(value.strip()))


def hash_customer_ref(value: str, salt: bytes | str) -> str:
    """HMAC-SHA256 of the lower-cased, trimmed value keyed with the org salt (hex digest)."""
    key = _salt_bytes(salt)
    return hmac.new(key, value.strip().lower().encode("utf-8"), hashlib.sha256).hexdigest()


def hash_email_refs(refs: pd.Series, salt: bytes | str | None) -> tuple[pd.Series, int]:
    """Replace every email-like value in ``refs`` with its HMAC hash.

    Returns the new series (string dtype, same index) and the number of rows hashed. Non-email
    refs are returned unchanged. ``salt`` may be ``None`` only if no email-like value exists.
    """
    s = refs.astype("string")
    is_email = s.str.strip().str.fullmatch(EMAIL_RE.pattern).fillna(False).astype(bool)
    n = int(is_email.sum())
    if n == 0:
        return s, 0
    key = _salt_bytes(salt)
    uniques = s[is_email].unique()
    lookup = {str(u): hash_customer_ref(str(u), key) for u in uniques}
    out = s.copy()
    out[is_email] = s[is_email].map(lookup)
    return out.astype("string"), n
