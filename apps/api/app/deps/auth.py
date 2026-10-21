"""Authentication and authorization dependencies (F-01, F-02; PRD §5.2).

* :func:`get_current_user` verifies a Supabase access token (``Authorization: Bearer``)
  against the project's JWKS (asymmetric keys only), checking ``exp``, ``iss`` and
  ``aud="authenticated"``, and returns a :class:`CurrentUser`.
* :func:`require_role` builds a dependency that requires a minimum role in the token's
  active org (``viewer < analyst < admin < owner``).
* :class:`MembershipChecker` is the seam for the per-request membership re-check that
  PRD §5.2 requires (DB lookup, cached <= 60 s). The default
  :class:`ClaimMembershipChecker` trusts the verified ``org_role`` claim and does NOT hit
  the database; M1 must override :func:`get_membership_checker` with a DB-backed checker.

Errors are RFC 9457 problem details (``application/problem+json``) with a stable ``code``.
:class:`ProblemError` subclasses ``HTTPException`` so the status code is right even if
:func:`problem_error_handler` is not registered; register it to get the problem+json body.
"""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, replace
from functools import lru_cache
from typing import Any, Literal, Protocol, get_args
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

Role = Literal["viewer", "analyst", "admin", "owner"]

#: Same order as the SQL helper ``app.role_rank(text)``.
ROLE_RANK: Mapping[str, int] = {"viewer": 1, "analyst": 2, "admin": 3, "owner": 4}

#: Asymmetric algorithms only: symmetric (HS256) tokens are always rejected.
ALLOWED_ALGORITHMS: tuple[str, ...] = ("RS256", "ES256")

PROBLEM_CONTENT_TYPE = "application/problem+json"


# --------------------------------------------------------------------------------------
# Errors (RFC 9457)
# --------------------------------------------------------------------------------------
class ProblemError(HTTPException):
    """An HTTP error rendered as an RFC 9457 problem document with a stable ``code``."""

    def __init__(
        self,
        status_code: int,
        code: str,
        title: str,
        detail: str | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(status_code=status_code, detail=detail or title, headers=headers)
        self.code = code
        self.title = title

    def to_problem(self, instance: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {
            "type": "about:blank",
            "title": self.title,
            "status": self.status_code,
            "detail": self.detail,
            "code": self.code,
        }
        if instance is not None:
            body["instance"] = instance
        return body


async def problem_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Exception handler for :class:`ProblemError` (``app.add_exception_handler``)."""
    if not isinstance(exc, ProblemError):  # pragma: no cover - registered for ProblemError
        raise exc
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_problem(instance=request.url.path),
        media_type=PROBLEM_CONTENT_TYPE,
        headers=exc.headers,
    )


def _unauthenticated(detail: str) -> ProblemError:
    return ProblemError(
        401,
        "UNAUTHENTICATED",
        "Authentication required",
        detail,
        headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
    )


# --------------------------------------------------------------------------------------
# Settings (injectable; independent of app.config so it can be overridden in tests)
# --------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class AuthSettings:
    """Token-verification settings. ``audience`` is fixed by Supabase Auth."""

    jwks_url: str
    issuer: str
    audience: str = "authenticated"
    leeway_seconds: int = 0


def get_auth_settings() -> AuthSettings:
    """Read ``SUPABASE_JWKS_URL`` / ``SUPABASE_JWT_ISSUER`` from the environment.

    Override with ``app.dependency_overrides[get_auth_settings]`` in tests or to source
    the values from ``app.config.Settings``.
    """
    jwks_url = os.environ.get("SUPABASE_JWKS_URL", "").strip()
    issuer = os.environ.get("SUPABASE_JWT_ISSUER", "").strip()
    if not jwks_url or not issuer:
        raise ProblemError(
            500,
            "AUTH_NOT_CONFIGURED",
            "Authentication is not configured",
            "SUPABASE_JWKS_URL and SUPABASE_JWT_ISSUER must be set.",
        )
    return AuthSettings(jwks_url=jwks_url, issuer=issuer)


@lru_cache(maxsize=4)
def get_jwk_client(jwks_url: str) -> jwt.PyJWKClient:
    """Process-wide JWKS client per URL; keys are cached and refetched on unknown ``kid``."""
    return jwt.PyJWKClient(jwks_url, cache_keys=True, lifespan=600, timeout=5)


# --------------------------------------------------------------------------------------
# Current user
# --------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class CurrentUser:
    """The verified caller. ``org_id``/``org_role`` come from the access-token hook."""

    user_id: UUID
    email: str | None
    org_id: UUID | None
    org_role: Role | None
    claims: Mapping[str, Any]


_bearer = HTTPBearer(auto_error=False, description="Supabase access token")


def _parse_uuid(value: Any, claim: str) -> UUID:
    try:
        return UUID(str(value))
    except ValueError as exc:
        raise _unauthenticated(f"Claim '{claim}' is not a valid UUID.") from exc


def decode_access_token(token: str, settings: AuthSettings) -> dict[str, Any]:
    """Verify signature, ``exp``, ``iss``, ``aud`` and return the claims (or raise 401)."""
    try:
        signing_key = get_jwk_client(settings.jwks_url).get_signing_key_from_jwt(token)
        claims: dict[str, Any] = jwt.decode(
            token,
            key=signing_key.key,
            algorithms=list(ALLOWED_ALGORITHMS),
            audience=settings.audience,
            issuer=settings.issuer,
            leeway=settings.leeway_seconds,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except jwt.PyJWKClientConnectionError as exc:
        raise ProblemError(
            503, "AUTH_UNAVAILABLE", "Authentication temporarily unavailable"
        ) from exc
    except jwt.ExpiredSignatureError as exc:
        raise _unauthenticated("The access token has expired.") from exc
    except jwt.PyJWTError as exc:
        raise _unauthenticated("The access token is invalid.") from exc
    return claims


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: AuthSettings = Depends(get_auth_settings),
) -> CurrentUser:
    """FastAPI dependency (auth level ``user``): a valid Supabase access token.

    Sync on purpose: a JWKS fetch is blocking I/O, so FastAPI runs this in its threadpool.
    """
    if credentials is None or credentials.scheme.lower() != "bearer" or not credentials.credentials:
        raise _unauthenticated("Missing bearer token.")

    claims = decode_access_token(credentials.credentials, settings)

    org_role = claims.get("org_role")
    if org_role is not None and org_role not in get_args(Role):
        raise _unauthenticated("Claim 'org_role' is not a known role.")
    org_id_raw = claims.get("org_id")
    email = claims.get("email")

    return CurrentUser(
        user_id=_parse_uuid(claims["sub"], "sub"),
        email=email if isinstance(email, str) and email else None,
        org_id=_parse_uuid(org_id_raw, "org_id") if org_id_raw else None,
        org_role=org_role,
        claims=claims,
    )


# --------------------------------------------------------------------------------------
# Membership re-check seam + role requirement
# --------------------------------------------------------------------------------------
class MembershipChecker(Protocol):
    """Resolves the caller's current role in ``org_id`` (``None`` = not a member).

    PRD §5.2 requires checking ``memberships`` on every request (cached <= 60 s) so a removed
    or demoted member loses API access before their token expires. Implement this with a DB
    lookup (service role, explicit ``org_id``/``user_id`` filter, TTL cache keyed by
    ``(user_id, org_id)``) and install it via ``dependency_overrides`` or by replacing
    :func:`get_membership_checker`.
    """

    async def role_in_org(self, user: CurrentUser, org_id: UUID) -> Role | None: ...


class ClaimMembershipChecker:
    """Default checker: TRUSTS the verified ``org_role`` claim; does not query the database.

    Sprint-zero placeholder only. Revocation then takes effect within one token lifetime
    (<= 1 h, F-02 AC6) rather than <= 60 s. Replace with a DB-backed checker in M1.
    """

    async def role_in_org(self, user: CurrentUser, org_id: UUID) -> Role | None:
        return user.org_role if user.org_id == org_id else None


_claim_checker = ClaimMembershipChecker()


def get_membership_checker() -> MembershipChecker:
    """Dependency returning the active :class:`MembershipChecker`."""
    return _claim_checker


def require_role(min_role: Role) -> Callable[..., Awaitable[CurrentUser]]:
    """Dependency factory: caller must hold at least ``min_role`` in the token's active org.

    Raises 403 ``NO_ACTIVE_ORG`` without an ``org_id`` claim, and 403 ``FORBIDDEN`` when the
    caller is not a member or the role is too low. Returns the user with the re-checked role.
    """
    if min_role not in ROLE_RANK:
        raise ValueError(f"unknown role: {min_role!r}")
    required = ROLE_RANK[min_role]

    async def dependency(
        user: CurrentUser = Depends(get_current_user),
        checker: MembershipChecker = Depends(get_membership_checker),
    ) -> CurrentUser:
        if user.org_id is None:
            raise ProblemError(
                403,
                "NO_ACTIVE_ORG",
                "No active organization",
                "Select or create an organization, then refresh the session.",
            )
        role = await checker.role_in_org(user, user.org_id)
        if role is None or ROLE_RANK[role] < required:
            raise ProblemError(
                403, "FORBIDDEN", "Insufficient role", f"This action requires the {min_role} role."
            )
        return replace(user, org_role=role)

    return dependency
