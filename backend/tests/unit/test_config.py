from typing import Any

import pytest
from pydantic import SecretStr, ValidationError

from app.core.config import Settings

SAFE_PROD: dict[str, Any] = {
    "environment": "prod",
    "app_base_url": "https://pm.example.com",
    "cookie_secure": True,
    "database_url": SecretStr("postgresql+asyncpg://app_rw:s3cr3t-value@db:5432/jira"),
    "migration_database_url": SecretStr("postgresql+asyncpg://app_owner:other@db:5432/jira"),
    "redis_url": SecretStr("rediss://cache:6380/0"),
    "app_secret_key": SecretStr("prod-secret-key-with-plenty-of-entropy-0123456789"),
}


def build(**overrides: Any) -> Settings:
    return Settings(**{**SAFE_PROD, **overrides})


def test_safe_production_configuration_is_accepted() -> None:
    settings = build()
    assert settings.is_production_like
    assert settings.enforce_db_role_checks
    assert not settings.api_docs_enabled


def test_dev_configuration_allows_local_defaults() -> None:
    settings = build(
        environment="dev",
        app_base_url="http://localhost:5173",
        cookie_secure=False,
        database_url=SecretStr("postgresql+asyncpg://app_rw:change-me-app-rw@localhost/jira"),
    )
    assert settings.api_docs_enabled
    assert not settings.enforce_db_role_checks


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"cookie_secure": False}, "COOKIE_SECURE=false is only allowed"),
        ({"app_base_url": "http://pm.example.com"}, "APP_BASE_URL must use https"),
        (
            {"database_url": SecretStr("postgresql+asyncpg://app_rw:change-me@db/jira")},
            "DATABASE_URL contains a placeholder value",
        ),
        (
            {"redis_url": SecretStr("redis://:change-me@cache:6379/0")},
            "REDIS_URL contains a placeholder value",
        ),
        (
            {"database_url": SecretStr("postgresql+asyncpg://app_owner:x1@db/jira")},
            "least-privileged runtime role",
        ),
        (
            {"database_url": SecretStr("postgresql+asyncpg://postgres:x1@db/jira")},
            "least-privileged runtime role",
        ),
        (
            {"migration_database_url": SecretStr("postgresql+asyncpg://app_rw:other@db/jira")},
            "must not reuse the migration role",
        ),
    ],
)
@pytest.mark.parametrize("environment", ["staging", "prod"])
def test_unsafe_production_configuration_is_rejected(
    overrides: dict[str, Any], expected: str, environment: str
) -> None:
    with pytest.raises(ValidationError, match=expected):
        build(environment=environment, **overrides)


def test_validation_errors_never_echo_secret_values() -> None:
    secret = "super-secret-password-value"
    with pytest.raises(ValidationError) as excinfo:
        build(
            cookie_secure=False,
            database_url=SecretStr(f"postgresql+asyncpg://app_rw:{secret}@db/jira"),
        )
    assert secret not in str(excinfo.value)
    assert secret not in repr(excinfo.value.errors())


def test_secret_values_are_masked_in_repr() -> None:
    settings = build()
    assert "s3cr3t-value" not in repr(settings)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("database_url", "postgresql://app_rw:x@db/jira"),
        ("migration_database_url", "mysql://app_owner:x@db/jira"),
        ("redis_url", "http://cache:6379"),
    ],
)
def test_connection_url_schemes_are_validated(field: str, value: str) -> None:
    with pytest.raises(ValidationError, match="scheme"):
        build(**{field: SecretStr(value)})


def test_unknown_environment_is_rejected() -> None:
    with pytest.raises(ValidationError):
        build(environment="production")


# ---------------------------------------------------------------------------- M1 rules
@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"signup_enabled": True}, "SIGNUP_ENABLED requires EMAIL_DELIVERY_ENABLED"),
        ({"breach_check_mode": "local_only"}, "BREACH_CHECK_MODE must be hibp"),
        ({"hibp_base_url": "http://hibp.example"}, "HIBP_BASE_URL must use https"),
        ({"password_hash_time_cost": 1}, "below OWASP minimums"),
        ({"password_hash_memory_kib": 4096}, "below OWASP minimums"),
        (
            {"app_secret_key": SecretStr("change-me-but-long-enough-0123456789")},
            "APP_SECRET_KEY contains a placeholder value",
        ),
    ],
)
def test_m1_production_rules(overrides: dict[str, Any], expected: str) -> None:
    with pytest.raises(ValidationError, match=expected):
        build(**overrides)


@pytest.mark.parametrize("environment", ["dev", "test", "staging", "prod"])
def test_email_delivery_cannot_be_enabled_before_m2(environment: str) -> None:
    with pytest.raises(ValidationError, match="not available until milestone M2"):
        build(environment=environment, email_delivery_enabled=True)


@pytest.mark.parametrize("environment", ["dev", "test", "staging", "prod"])
def test_short_secret_key_rejected_everywhere(environment: str) -> None:
    with pytest.raises(ValidationError, match="APP_SECRET_KEY must be at least 32"):
        build(environment=environment, app_secret_key=SecretStr("too-short"))


def test_insecure_cookie_only_allowed_in_dev() -> None:
    dev = build(environment="dev", app_base_url="http://localhost:5173", cookie_secure=False)
    assert dev.session_cookie_name == "session"
    with pytest.raises(ValidationError, match="COOKIE_SECURE=false is only allowed"):
        build(environment="test", cookie_secure=False)


def test_signup_defaults_off_in_prod_and_on_elsewhere() -> None:
    assert not build().signup_is_enabled
    assert build(environment="staging").signup_is_enabled
    assert build(environment="dev", app_base_url="http://localhost:5173").signup_is_enabled


def test_secure_cookie_uses_host_prefix_and_origin_is_derived() -> None:
    settings = build()
    assert settings.session_cookie_name == "__Host-session"
    assert settings.allowed_origin == "https://pm.example.com"
