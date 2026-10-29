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
BreachCheckMode = Literal["hibp", "local_only"]
SmtpSecurity = Literal["none", "starttls", "tls"]

PLACEHOLDER_MARKERS = ("change-me", "changeme", "placeholder")
# Roles that must never be used by the API or worker at runtime.
FORBIDDEN_RUNTIME_DB_USERS = frozenset({"postgres", "app_owner"})
MIN_SECRET_KEY_LENGTH = 32
# OWASP minimums for Argon2id; production-like environments may not go below them.
MIN_ARGON2_TIME_COST = 2
MIN_ARGON2_MEMORY_KIB = 19_456


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
    # Worker process connection (app_worker role). Required only by `python -m app.worker`.
    worker_database_url: SecretStr | None = None
    # Retention purge connection (app_retention role). Optional: without it the worker does
    # not purge (plan V2.7).
    retention_database_url: SecretStr | None = None
    retention_interval_seconds: int = Field(default=3600, ge=60, le=86400)
    # Global per-user API limit (requests per minute, M12). 0 disables it (rollback switch).
    api_rate_limit_per_minute: int = Field(default=600, ge=0, le=100_000)
    redis_url: SecretStr

    db_pool_size: int = Field(default=10, ge=1, le=100)
    db_max_overflow: int = Field(default=5, ge=0, le=100)
    db_pool_timeout_seconds: float = Field(default=5.0, gt=0, le=60)
    db_connect_timeout_seconds: float = Field(default=5.0, gt=0, le=60)
    db_statement_timeout_ms: int = Field(default=10_000, ge=100, le=600_000)
    db_lock_timeout_ms: int = Field(default=5_000, ge=100, le=600_000)
    db_idle_in_transaction_timeout_ms: int = Field(default=60_000, ge=1_000)
    readiness_timeout_seconds: float = Field(default=2.0, gt=0, le=30)
    # First ``ping()`` opens the connection; remote TLS (e.g. Upstash ``rediss://``) needs
    # more than 1s from cloud hosts — keep in line with ``db_connect_timeout_seconds``.
    redis_timeout_seconds: float = Field(default=5.0, gt=0, le=30)

    max_request_body_bytes: int = Field(default=1_048_576, ge=1_024, le=104_857_600)

    # --- Identity (M1) ---------------------------------------------------------------
    # Root secret; purpose-specific keys (CSRF, email HMAC, rate-limit keys) are derived
    # from it with domain separation. Rotating it invalidates CSRF tokens only.
    app_secret_key: SecretStr
    # None = environment default: enabled everywhere except prod (D1: prod stays off
    # until M2 delivers email verification).
    signup_enabled: bool | None = None
    # --- Email (M2) ------------------------------------------------------------------
    # Off by default: nothing is sent until a provider is explicitly configured.
    # Dev/test use Mailpit (free, local). Production requires an approved provider (D13/D14).
    email_delivery_enabled: bool = False
    email_from: str | None = None
    smtp_host: str | None = None
    smtp_port: int = Field(default=587, ge=1, le=65_535)
    smtp_security: SmtpSecurity = "starttls"
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    smtp_timeout_seconds: float = Field(default=10.0, gt=0, le=60)
    verify_email_token_ttl_seconds: int = Field(default=86_400, ge=600, le=604_800)
    reset_password_token_ttl_seconds: int = Field(default=3_600, ge=300, le=86_400)
    max_active_tokens_per_purpose: int = Field(default=3, ge=1, le=10)
    # --- Worker (M2) -----------------------------------------------------------------
    worker_poll_interval_seconds: float = Field(default=1.0, gt=0, le=60)
    worker_batch_size: int = Field(default=20, ge=1, le=500)
    worker_lease_seconds: int = Field(default=300, ge=10, le=3_600)
    worker_max_attempts: int = Field(default=10, ge=1, le=50)
    session_idle_ttl_seconds: int = Field(default=86_400, ge=300)
    session_absolute_ttl_seconds: int = Field(default=1_209_600, ge=3_600)
    session_max_active: int = Field(default=20, ge=1, le=100)
    session_touch_interval_seconds: int = Field(default=300, ge=0, le=3_600)
    password_hash_time_cost: int = Field(default=3, ge=1, le=10)
    password_hash_memory_kib: int = Field(default=65_536, ge=8, le=1_048_576)
    password_hash_parallelism: int = Field(default=4, ge=1, le=16)
    breach_check_mode: BreachCheckMode = "hibp"
    hibp_base_url: str = "https://api.pwnedpasswords.com"
    hibp_timeout_ms: int = Field(default=2_000, ge=100, le=10_000)

    @field_validator("database_url", "migration_database_url", "worker_database_url")
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

    @property
    def signup_is_enabled(self) -> bool:
        if self.signup_enabled is None:
            return self.environment != "prod"
        return self.signup_enabled

    @property
    def session_cookie_name(self) -> str:
        # The __Host- prefix requires Secure, Path=/ and no Domain (browser-enforced).
        return "__Host-session" if self.cookie_secure else "session"

    @property
    def allowed_origin(self) -> str:
        parts = urlsplit(self.app_base_url)
        return f"{parts.scheme}://{parts.netloc}"

    @model_validator(mode="after")
    def _validate_environment_safety(self) -> "Settings":
        problems = self._general_problems()
        if self.is_production_like:
            problems += self._production_problems()
        if problems:
            # Messages name the offending setting but never include its value.
            raise UnsafeConfigurationError(
                f"unsafe configuration for environment={self.environment}: " + "; ".join(problems)
            )
        return self

    def _general_problems(self) -> list[str]:
        problems: list[str] = []
        if not self.cookie_secure and self.environment != "dev":
            problems.append("COOKIE_SECURE=false is only allowed when ENVIRONMENT=dev")
        if len(self.app_secret_key.get_secret_value()) < MIN_SECRET_KEY_LENGTH:
            problems.append(f"APP_SECRET_KEY must be at least {MIN_SECRET_KEY_LENGTH} characters")
        if self.email_delivery_enabled:
            if not self.smtp_host:
                problems.append("EMAIL_DELIVERY_ENABLED requires SMTP_HOST")
            if not self.email_from or "@" not in self.email_from:
                problems.append("EMAIL_DELIVERY_ENABLED requires a valid EMAIL_FROM")
        if self.session_absolute_ttl_seconds < self.session_idle_ttl_seconds:
            problems.append("SESSION_ABSOLUTE_TTL_SECONDS must be >= SESSION_IDLE_TTL_SECONDS")
        return problems

    def _production_email_problems(self) -> list[str]:
        # Production mail must go over TLS to an authenticated provider (never a local
        # sink such as Mailpit). Which provider is a future decision (D13, zero cost D14).
        problems: list[str] = []
        if self.email_delivery_enabled:
            if self.smtp_security == "none":
                problems.append("SMTP_SECURITY must be starttls or tls")
            if not self.smtp_username or self.smtp_password is None:
                problems.append("SMTP_USERNAME and SMTP_PASSWORD are required")
        return problems

    def _database_role_problems(self) -> list[str]:
        problems: list[str] = []
        runtime_user = _db_username(self.database_url.get_secret_value())
        if runtime_user is None:
            problems.append("DATABASE_URL must name a database user")
        elif runtime_user in FORBIDDEN_RUNTIME_DB_USERS:
            problems.append("DATABASE_URL must use the least-privileged runtime role")
        if self.migration_database_url is not None:
            migration_user = _db_username(self.migration_database_url.get_secret_value())
            if migration_user is not None and migration_user == runtime_user:
                problems.append("DATABASE_URL must not reuse the migration role")
        if self.worker_database_url is not None:
            worker_user = _db_username(self.worker_database_url.get_secret_value())
            if worker_user is None or worker_user in FORBIDDEN_RUNTIME_DB_USERS:
                problems.append("WORKER_DATABASE_URL must use the least-privileged worker role")
        if self.retention_database_url is not None:
            retention_user = _db_username(self.retention_database_url.get_secret_value())
            if retention_user is None or retention_user in FORBIDDEN_RUNTIME_DB_USERS:
                problems.append("RETENTION_DATABASE_URL must use the retention role")
        return problems

    def _production_problems(self) -> list[str]:
        problems: list[str] = []
        if (
            self.environment == "prod"
            and self.signup_is_enabled
            and not self.email_delivery_enabled
        ):
            problems.append("SIGNUP_ENABLED requires EMAIL_DELIVERY_ENABLED in prod (D1)")
        problems += self._production_email_problems()
        if self.breach_check_mode != "hibp":
            problems.append("BREACH_CHECK_MODE must be hibp")
        if not self.hibp_base_url.startswith("https://"):
            problems.append("HIBP_BASE_URL must use https")
        if (
            self.password_hash_time_cost < MIN_ARGON2_TIME_COST
            or self.password_hash_memory_kib < MIN_ARGON2_MEMORY_KIB
        ):
            problems.append("PASSWORD_HASH_* parameters are below OWASP minimums")
        if not self.app_base_url.startswith("https://"):
            problems.append("APP_BASE_URL must use https")
        secrets = {
            "DATABASE_URL": self.database_url,
            "REDIS_URL": self.redis_url,
            "APP_SECRET_KEY": self.app_secret_key,
        }
        if self.migration_database_url is not None:
            secrets["MIGRATION_DATABASE_URL"] = self.migration_database_url
        if self.worker_database_url is not None:
            secrets["WORKER_DATABASE_URL"] = self.worker_database_url
        if self.retention_database_url is not None:
            secrets["RETENTION_DATABASE_URL"] = self.retention_database_url
        if self.smtp_password is not None:
            secrets["SMTP_PASSWORD"] = self.smtp_password
        for name, secret in secrets.items():
            if any(marker in secret.get_secret_value().lower() for marker in PLACEHOLDER_MARKERS):
                problems.append(f"{name} contains a placeholder value")
        problems += self._database_role_problems()
        return problems


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # pyright: ignore[reportCallIssue] - values come from the environment
