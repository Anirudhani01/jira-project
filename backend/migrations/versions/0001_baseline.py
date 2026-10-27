"""Baseline: extensions, tenant-context helpers, schema and default privileges.

No domain tables. Establishes the infrastructure every later RLS policy relies on:

- ``app_current_org()`` / ``app_current_user()`` read the transaction-local settings
  bound by ``app.db.tenant.bind_tenant``. An unset/empty setting yields NULL, so RLS
  policies comparing against them match nothing (fail closed).
- Default privileges grant DML to the runtime roles on future tables in ``public``
  only. Tables needing narrower grants (append-only, outbox) must REVOKE explicitly in
  their creating migration. Other schemas get no default grants.
- Runtime roles get no privileges on ``alembic_version``.

Revision ID: 0001
Revises:
Create Date: 2026-10-27
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RUNTIME_ROLES = "app_rw, app_worker"


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")

    op.execute(
        """
        CREATE FUNCTION app_current_org() RETURNS uuid
        LANGUAGE sql STABLE PARALLEL SAFE
        AS $$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION app_current_user() RETURNS uuid
        LANGUAGE sql STABLE PARALLEL SAFE
        AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$
        """
    )

    # Functions are EXECUTE-able by PUBLIC by default; make every grant explicit.
    op.execute(
        "ALTER DEFAULT PRIVILEGES FOR ROLE app_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC"
    )
    op.execute("REVOKE ALL ON FUNCTION app_current_org(), app_current_user() FROM PUBLIC")
    op.execute(
        f"GRANT EXECUTE ON FUNCTION app_current_org(), app_current_user() TO {RUNTIME_ROLES}"
    )

    op.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
    op.execute(f"GRANT USAGE ON SCHEMA public TO {RUNTIME_ROLES}")
    op.execute(
        "ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public "
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {RUNTIME_ROLES}"
    )
    op.execute(
        "ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public "
        f"GRANT USAGE, SELECT ON SEQUENCES TO {RUNTIME_ROLES}"
    )

    op.execute(f"REVOKE ALL ON TABLE alembic_version FROM PUBLIC, {RUNTIME_ROLES}")


def downgrade() -> None:
    op.execute(
        "ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public "
        f"REVOKE USAGE, SELECT ON SEQUENCES FROM {RUNTIME_ROLES}"
    )
    op.execute(
        "ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public "
        f"REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM {RUNTIME_ROLES}"
    )
    op.execute(f"REVOKE USAGE ON SCHEMA public FROM {RUNTIME_ROLES}")
    op.execute("ALTER DEFAULT PRIVILEGES FOR ROLE app_owner GRANT EXECUTE ON FUNCTIONS TO PUBLIC")
    op.execute("DROP FUNCTION app_current_user()")
    op.execute("DROP FUNCTION app_current_org()")
    op.execute("DROP EXTENSION IF EXISTS citext")
    # CREATE on schema public is intentionally not re-granted to PUBLIC: PostgreSQL 15+
    # does not grant it by default, so the pre-baseline state already lacked it.
