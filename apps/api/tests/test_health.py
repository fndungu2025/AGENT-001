import pytest
from fastapi.testclient import TestClient

from app import __version__
from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_health_ok_defaults_to_dev_sha(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GIT_SHA", raising=False)
    response = client.get("/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__, "git_sha": "dev"}


def test_health_reports_git_sha(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GIT_SHA", "abc1234")
    assert client.get("/v1/health").json()["git_sha"] == "abc1234"


def test_settings_load_without_env(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import Settings

    for name in ("SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "ENVIRONMENT"):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert settings.environment == "local"
    assert settings.supabase_service_role_key is None
    assert settings.database_url is None
