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
        ({"cookie_secure": False}, "COOKIE_SECURE must be true"),
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
