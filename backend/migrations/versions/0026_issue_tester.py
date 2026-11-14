"""Issue tester: an optional person on every issue, next to the assignee and reporter.

``issues.tester_id`` is nullable and carries the same composite foreign key to
``org_memberships`` as ``assignee_id`` / ``reporter_id`` (the person must be a member of the
issue's organization; the service layer additionally requires an active project member).
Removing an organization member clears the column first, exactly as it does for the assignee.
The runtime role gets a column-level ``UPDATE`` grant like the other editable issue columns.

Revision ID: 0026
Revises: 0025
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)
FK_NAME = "fk_issues_org_id_tester_id_org_memberships"
INDEX_NAME = "ix_issues_org_id_tester_id"


def upgrade() -> None:
    op.add_column("issues", sa.Column("tester_id", UUID, nullable=True))
    op.create_foreign_key(
        FK_NAME,
        "issues",
        "org_memberships",
        ["org_id", "tester_id"],
        ["org_id", "user_id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        INDEX_NAME,
        "issues",
        ["org_id", "tester_id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.execute("GRANT UPDATE (tester_id) ON issues TO app_rw")


def downgrade() -> None:
    op.execute("REVOKE UPDATE (tester_id) ON issues FROM app_rw")
    op.drop_index(INDEX_NAME, table_name="issues")
    op.drop_constraint(FK_NAME, "issues", type_="foreignkey")
    op.drop_column("issues", "tester_id")
