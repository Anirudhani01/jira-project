"""Retention role privileges (M12, plan V2.7 / D5).

``app_retention`` is a dedicated login role (created by ``infra/postgres/init/01-roles.sh``
or the production IaC) used only by the worker's purge job. It may ``SELECT`` and ``DELETE``
exactly the tables with a retention period and nothing else. For tables under row-level
security the purge rule is also written into the policies, so even a buggy job cannot
delete a fresh row:

- ``idempotency_keys``: expired keys (``expires_at`` in the past)
- ``notifications``: older than 90 days
- ``audit_events``: older than 1 year
- ``user_sessions`` / ``user_tokens`` (no RLS): the job deletes those expired 30 days ago
- ``security.platform_security_events`` (no RLS): the job deletes those older than 1 year

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-30
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RLS_RULES = {
    "idempotency_keys": "expires_at < now()",
    "notifications": "created_at < now() - interval '90 days'",
    "audit_events": "created_at < now() - interval '1 year'",
}
PLAIN_TABLES = ("user_sessions", "user_tokens")
EVENTS = "security.platform_security_events"


def upgrade() -> None:
    op.execute(
        "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_retention') "
        "THEN RAISE EXCEPTION 'role app_retention is missing: re-run "
        "infra/postgres/init/01-roles.sh or provision it in your IaC'; END IF; END $$"
    )
    for table, rule in RLS_RULES.items():
        op.execute(f"GRANT SELECT, DELETE ON {table} TO app_retention")
        op.execute(
            f"CREATE POLICY {table}_retention_select ON {table} FOR SELECT TO app_retention "
            f"USING ({rule})"
        )
        op.execute(
            f"CREATE POLICY {table}_retention_delete ON {table} FOR DELETE TO app_retention "
            f"USING ({rule})"
        )
    for table in PLAIN_TABLES:
        op.execute(f"GRANT SELECT, DELETE ON {table} TO app_retention")
    op.execute("GRANT USAGE ON SCHEMA security TO app_retention")
    op.execute(f"GRANT SELECT, DELETE ON {EVENTS} TO app_retention")


def downgrade() -> None:
    op.execute(f"REVOKE ALL ON {EVENTS} FROM app_retention")
    op.execute("REVOKE USAGE ON SCHEMA security FROM app_retention")
    for table in PLAIN_TABLES:
        op.execute(f"REVOKE ALL ON {table} FROM app_retention")
    for table in RLS_RULES:
        op.execute(f"DROP POLICY {table}_retention_delete ON {table}")
        op.execute(f"DROP POLICY {table}_retention_select ON {table}")
        op.execute(f"REVOKE ALL ON {table} FROM app_retention")
