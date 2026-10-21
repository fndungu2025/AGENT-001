"""Typed application settings, read from environment variables (names: CLAUDE.md §6)."""

from functools import lru_cache
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """API and worker settings. Secrets default to None so tests run without any env."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    environment: Literal["local", "test", "staging", "production"] = "local"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

    supabase_url: str | None = None
    supabase_service_role_key: SecretStr | None = None
    supabase_jwks_url: str | None = None
    supabase_jwt_issuer: str | None = None

    database_url: SecretStr | None = None
    database_direct_url: SecretStr | None = None

    cors_allowed_origin_regex: str | None = None

    sentry_dsn: SecretStr | None = None
    resend_api_key: SecretStr | None = None
    posthog_api_key: SecretStr | None = None

    git_sha: str = "dev"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings (cached; use as a FastAPI dependency)."""
    return Settings()
