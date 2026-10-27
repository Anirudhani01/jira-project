"""Typed, validated application configuration.

Settings come from environment variables only. Outside dev/test the configuration is
checked for unsafe values and the process refuses to start rather than run insecurely.
Validation errors never echo input values (`hide_input_in_errors`), so secrets in
connection strings cannot leak into startup logs.
"""

from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["dev", "test", "staging", "prod"]
LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR"]

PLACEHOLDER_MARKERS = ("change-me", "changeme", "placeholder")
# Roles that must never be used by the API or worker at runtime.
FORBIDDEN_RUNTIME_DB_USERS = frozenset({"postgres", "app_owner"})


class UnsafeConfigurationError(ValueError):
    """Raised when settings are unsafe for the selected environment."""


def _db_username(url: str) -> str | None:
    return urlsplit(url).username


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=None,
        extra="ignore",
        case_sensitive=False,
        hide_input_in_errors=True,
    )

    environment: Environment = "dev"
    log_level: LogLevel = "INFO"
    app_base_url: str = "http://localhost:5173"
    cookie_secure: bool = True

    database_url: SecretStr
    # Only consulted to detect API/migration credential reuse; the API never connects with it.
    migration_database_url: SecretStr | None = None
    redis_url: SecretStr

    db_pool_size: int = Field(default=10, ge=1, le=100)
    db_max_overflow: int = Field(default=5, ge=0, le=100)
    db_pool_timeout_seconds: float = Field(default=5.0, gt=0, le=60)
    db_connect_timeout_seconds: float = Field(default=5.0, gt=0, le=60)
    db_statement_timeout_ms: int = Field(default=10_000, ge=100, le=600_000)
    db_lock_timeout_ms: int = Field(default=5_000, ge=100, le=600_000)
    db_idle_in_transaction_timeout_ms: int = Field(default=60_000, ge=1_000)
    readiness_timeout_seconds: float = Field(default=2.0, gt=0, le=30)
    redis_timeout_seconds: float = Field(default=1.0, gt=0, le=30)

    max_request_body_bytes: int = Field(default=1_048_576, ge=1_024, le=104_857_600)

    @field_validator("database_url", "migration_database_url")
    @classmethod
    def _require_asyncpg_scheme(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and not value.get_secret_value().startswith("postgresql+asyncpg://"):
            raise ValueError("must use the postgresql+asyncpg:// scheme")
        return value

    @field_validator("redis_url")
    @classmethod
    def _require_redis_scheme(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().startswith(("redis://", "rediss://")):
            raise ValueError("must use the redis:// or rediss:// scheme")
        return value

    @property
    def is_production_like(self) -> bool:
        return self.environment in ("staging", "prod")

    @property
    def api_docs_enabled(self) -> bool:
        return self.environment == "dev"

    @property
    def enforce_db_role_checks(self) -> bool:
        return self.is_production_like

    @model_validator(mode="after")
    def _validate_environment_safety(self) -> "Settings":
        if not self.is_production_like:
            return self
        problems = list(self._production_problems())
        if problems:
            # Messages name the offending setting but never include its value.
            raise UnsafeConfigurationError(
                f"unsafe configuration for environment={self.environment}: " + "; ".join(problems)
            )
        return self

    def _production_problems(self) -> list[str]:
        problems: list[str] = []
        if not self.cookie_secure:
            problems.append("COOKIE_SECURE must be true")
        if not self.app_base_url.startswith("https://"):
            problems.append("APP_BASE_URL must use https")
        secrets = {"DATABASE_URL": self.database_url, "REDIS_URL": self.redis_url}
        if self.migration_database_url is not None:
            secrets["MIGRATION_DATABASE_URL"] = self.migration_database_url
        for name, secret in secrets.items():
            if any(marker in secret.get_secret_value().lower() for marker in PLACEHOLDER_MARKERS):
                problems.append(f"{name} contains a placeholder value")
        runtime_user = _db_username(self.database_url.get_secret_value())
        if runtime_user is None:
            problems.append("DATABASE_URL must name a database user")
        elif runtime_user in FORBIDDEN_RUNTIME_DB_USERS:
            problems.append("DATABASE_URL must use the least-privileged runtime role")
        if self.migration_database_url is not None:
            migration_user = _db_username(self.migration_database_url.get_secret_value())
            if migration_user is not None and migration_user == runtime_user:
                problems.append("DATABASE_URL must not reuse the migration role")
        return problems


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # pyright: ignore[reportCallIssue] - values come from the environment
