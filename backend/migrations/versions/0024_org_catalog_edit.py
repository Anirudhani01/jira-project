"""Organization catalog edit (Phase A): active flag and UPDATE policies.

Covers issue types and priorities.

Revision ID: 0024
Revises: 0023
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024"
down_revision: str | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RUNTIME_ROLES = "app_rw, app_worker"
MANAGERS = "ARRAY['owner', 'admin']"


def upgrade() -> None:
    for table in ("issue_types", "priorities"):
        op.add_column(
            table,
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        )

    for table in ("issue_types", "priorities"):
        op.execute(
            f"CREATE POLICY {table}_update ON {table} FOR UPDATE TO app_rw "
            f"USING (org_id = app_current_org() AND app_has_org_role(org_id, {MANAGERS})) "
            f"WITH CHECK (org_id = app_current_org() AND app_has_org_role(org_id, {MANAGERS}))"
        )

    op.execute(f"REVOKE ALL ON issue_types, priorities FROM PUBLIC, {RUNTIME_ROLES}")
    op.execute("GRANT SELECT, INSERT ON issue_types, priorities TO app_rw")
    op.execute("GRANT UPDATE (name, kind, position, is_active) ON issue_types TO app_rw")
    op.execute("GRANT UPDATE (name, sort_order, color, is_active) ON priorities TO app_rw")


def downgrade() -> None:
    for table in ("issue_types", "priorities"):
        op.execute(f"DROP POLICY IF EXISTS {table}_update ON {table}")
    op.drop_column("priorities", "is_active")
    op.drop_column("issue_types", "is_active")
    op.execute(f"REVOKE ALL ON issue_types, priorities FROM PUBLIC, {RUNTIME_ROLES}")
    op.execute("GRANT SELECT, INSERT ON issue_types, priorities TO app_rw")
