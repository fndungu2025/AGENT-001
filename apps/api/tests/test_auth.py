"""Tests for app.deps.auth: JWKS token verification and role requirements (F-01, F-02)."""

from __future__ import annotations

import json
import time
from typing import Any
from uuid import UUID

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from jwt.algorithms import ECAlgorithm, RSAAlgorithm

from app.deps import auth
from app.deps.auth import (
    AuthSettings,
    CurrentUser,
    ProblemError,
    get_auth_settings,
    get_current_user,
    problem_error_handler,
    require_role,
)

ISSUER = "https://project-ref.supabase.co/auth/v1"
JWKS_URL = "https://project-ref.supabase.co/auth/v1/.well-known/jwks.json"
USER_ID = UUID("a4000000-0000-0000-0000-000000000001")
ORG_ID = UUID("a0000000-0000-0000-0000-000000000001")

RSA_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_RSA_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
EC_KEY = ec.generate_private_key(ec.SECP256R1())


def _jwks() -> dict[str, Any]:
    rsa_jwk = json.loads(RSAAlgorithm.to_jwk(RSA_KEY.public_key()))
    rsa_jwk.update(kid="rsa-1", alg="RS256", use="sig")
    ec_jwk = json.loads(ECAlgorithm.to_jwk(EC_KEY.public_key()))
    ec_jwk.update(kid="ec-1", alg="ES256", use="sig")
    return {"keys": [rsa_jwk, ec_jwk]}


def make_token(
    *,
    key: Any = RSA_KEY,
    alg: str = "RS256",
    kid: str = "rsa-1",
    exp_delta: int = 3600,
    **overrides: Any,
) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": str(USER_ID),
        "email": "viewer-a@example.test",
        "role": "authenticated",
        "aud": "authenticated",
        "iss": ISSUER,
        "iat": now,
        "exp": now + exp_delta,
        "org_id": str(ORG_ID),
        "org_role": "analyst",
    }
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm=alg, headers={"kid": kid})


@pytest.fixture(autouse=True)
def fake_jwks(monkeypatch: pytest.MonkeyPatch) -> None:
    """Serve the test JWKS through a real PyJWKClient with the HTTP fetch replaced."""
    client = jwt.PyJWKClient(JWKS_URL, cache_keys=True)
    monkeypatch.setattr(client, "fetch_data", _jwks)
    monkeypatch.setattr(auth, "get_jwk_client", lambda url: client)


require_analyst = require_role("analyst")
require_admin = require_role("admin")


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.add_exception_handler(ProblemError, problem_error_handler)
    app.dependency_overrides[get_auth_settings] = lambda: AuthSettings(
        jwks_url=JWKS_URL, issuer=ISSUER
    )

    @app.get("/me")
    def me(user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
        return {
            "user_id": str(user.user_id),
            "email": user.email,
            "org_id": str(user.org_id) if user.org_id else None,
            "org_role": user.org_role,
        }

    @app.post("/analyst-only")
    def analyst_only(user: CurrentUser = Depends(require_analyst)) -> dict[str, str]:
        return {"role": str(user.org_role)}

    @app.delete("/admin-only")
    def admin_only(user: CurrentUser = Depends(require_admin)) -> dict[str, str]:
        return {"role": str(user.org_role)}

    return TestClient(app)


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _assert_problem(response: Any, status: int, code: str) -> None:
    assert response.status_code == status
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["code"] == code
    assert body["status"] == status
    assert {"type", "title", "detail"} <= body.keys()


# ---------------------------------------------------------------- get_current_user
def test_valid_rs256_token_returns_user(client: TestClient) -> None:
    response = client.get("/me", headers=_bearer(make_token()))
    assert response.status_code == 200
    assert response.json() == {
        "user_id": str(USER_ID),
        "email": "viewer-a@example.test",
        "org_id": str(ORG_ID),
        "org_role": "analyst",
    }


def test_valid_es256_token_returns_user(client: TestClient) -> None:
    token = make_token(key=EC_KEY, alg="ES256", kid="ec-1")
    response = client.get("/me", headers=_bearer(token))
    assert response.status_code == 200
    assert response.json()["user_id"] == str(USER_ID)


def test_token_without_org_claims_is_a_valid_user(client: TestClient) -> None:
    response = client.get("/me", headers=_bearer(make_token(org_id=None, org_role=None)))
    assert response.status_code == 200
    assert response.json()["org_id"] is None
    assert response.json()["org_role"] is None


def test_missing_header_is_401(client: TestClient) -> None:
    response = client.get("/me")
    _assert_problem(response, 401, "UNAUTHENTICATED")
    assert response.headers["www-authenticate"].startswith("Bearer")


def test_non_bearer_scheme_is_401(client: TestClient) -> None:
    response = client.get("/me", headers={"Authorization": f"Basic {make_token()}"})
    _assert_problem(response, 401, "UNAUTHENTICATED")


def test_garbage_token_is_401(client: TestClient) -> None:
    _assert_problem(client.get("/me", headers=_bearer("not.a.jwt")), 401, "UNAUTHENTICATED")


def test_expired_token_is_401(client: TestClient) -> None:
    response = client.get("/me", headers=_bearer(make_token(exp_delta=-60)))
    _assert_problem(response, 401, "UNAUTHENTICATED")
    assert "expired" in response.json()["detail"]


def test_wrong_issuer_is_401(client: TestClient) -> None:
    token = make_token(iss="https://evil.example/auth/v1")
    _assert_problem(client.get("/me", headers=_bearer(token)), 401, "UNAUTHENTICATED")


def test_wrong_audience_is_401(client: TestClient) -> None:
    token = make_token(aud="anon")
    _assert_problem(client.get("/me", headers=_bearer(token)), 401, "UNAUTHENTICATED")


def test_missing_exp_is_401(client: TestClient) -> None:
    now = int(time.time())
    claims = {"sub": str(USER_ID), "aud": "authenticated", "iss": ISSUER, "iat": now}
    token = jwt.encode(claims, RSA_KEY, algorithm="RS256", headers={"kid": "rsa-1"})
    _assert_problem(client.get("/me", headers=_bearer(token)), 401, "UNAUTHENTICATED")


def test_bad_signature_is_401(client: TestClient) -> None:
    token = make_token(key=OTHER_RSA_KEY)  # signed by a key not in the JWKS, same kid
    _assert_problem(client.get("/me", headers=_bearer(token)), 401, "UNAUTHENTICATED")


def test_unknown_kid_is_401(client: TestClient) -> None:
    token = make_token(kid="rotated-away")
    _assert_problem(client.get("/me", headers=_bearer(token)), 401, "UNAUTHENTICATED")


def test_symmetric_hs256_token_is_rejected(client: TestClient) -> None:
    token = make_token(key="legacy-shared-secret-at-least-32-bytes!!", alg="HS256")
    _assert_problem(client.get("/me", headers=_bearer(token)), 401, "UNAUTHENTICATED")


def test_non_uuid_sub_is_401(client: TestClient) -> None:
    _assert_problem(
        client.get("/me", headers=_bearer(make_token(sub="not-a-uuid"))), 401, "UNAUTHENTICATED"
    )


def test_unknown_org_role_is_401(client: TestClient) -> None:
    _assert_problem(
        client.get("/me", headers=_bearer(make_token(org_role="superuser"))),
        401,
        "UNAUTHENTICATED",
    )


def test_missing_configuration_is_500(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SUPABASE_JWKS_URL", raising=False)
    monkeypatch.delenv("SUPABASE_JWT_ISSUER", raising=False)
    with pytest.raises(ProblemError) as excinfo:
        get_auth_settings()
    assert excinfo.value.code == "AUTH_NOT_CONFIGURED"


def test_settings_read_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_JWKS_URL", JWKS_URL)
    monkeypatch.setenv("SUPABASE_JWT_ISSUER", ISSUER)
    assert get_auth_settings() == AuthSettings(jwks_url=JWKS_URL, issuer=ISSUER)


# ---------------------------------------------------------------- require_role
@pytest.mark.parametrize("role", ["analyst", "admin", "owner"])
def test_role_allowed(client: TestClient, role: str) -> None:
    response = client.post("/analyst-only", headers=_bearer(make_token(org_role=role)))
    assert response.status_code == 200
    assert response.json() == {"role": role}


@pytest.mark.parametrize(
    ("role", "path"), [("viewer", "/analyst-only"), ("analyst", "/admin-only")]
)
def test_role_denied(client: TestClient, role: str, path: str) -> None:
    method = client.post if path == "/analyst-only" else client.delete
    _assert_problem(method(path, headers=_bearer(make_token(org_role=role))), 403, "FORBIDDEN")


def test_no_active_org_is_403(client: TestClient) -> None:
    token = make_token(org_id=None, org_role=None)
    _assert_problem(client.post("/analyst-only", headers=_bearer(token)), 403, "NO_ACTIVE_ORG")


def test_org_without_role_claim_is_403(client: TestClient) -> None:
    token = make_token(org_role=None)
    _assert_problem(client.post("/analyst-only", headers=_bearer(token)), 403, "FORBIDDEN")


def test_role_check_requires_valid_token(client: TestClient) -> None:
    _assert_problem(client.post("/analyst-only"), 401, "UNAUTHENTICATED")


def test_membership_checker_is_pluggable(client: TestClient) -> None:
    """A DB-backed checker (M1) overrides the claim: demoted member is denied."""

    class DemotedChecker:
        async def role_in_org(self, user: CurrentUser, org_id: UUID) -> auth.Role | None:
            return "viewer"

    class RemovedChecker:
        async def role_in_org(self, user: CurrentUser, org_id: UUID) -> auth.Role | None:
            return None

    app = client.app
    assert isinstance(app, FastAPI)
    token = make_token(org_role="owner")
    for checker in (DemotedChecker(), RemovedChecker()):
        app.dependency_overrides[auth.get_membership_checker] = lambda c=checker: c
        _assert_problem(client.post("/analyst-only", headers=_bearer(token)), 403, "FORBIDDEN")
    app.dependency_overrides.pop(auth.get_membership_checker)
    assert client.post("/analyst-only", headers=_bearer(token)).status_code == 200


def test_require_role_rejects_unknown_role() -> None:
    with pytest.raises(ValueError, match="unknown role"):
        require_role("superuser")  # type: ignore[arg-type]


def test_problem_error_degrades_to_http_exception() -> None:
    """Without the handler installed, status codes are still correct."""
    app = FastAPI()
    app.dependency_overrides[get_auth_settings] = lambda: AuthSettings(
        jwks_url=JWKS_URL, issuer=ISSUER
    )

    @app.get("/me")
    def me(user: CurrentUser = Depends(get_current_user)) -> str:
        return str(user.user_id)

    response = TestClient(app).get("/me")
    assert response.status_code == 401
