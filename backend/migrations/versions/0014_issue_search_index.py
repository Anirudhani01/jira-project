"""GIN index on ``issues.search`` (M12), created ``CONCURRENTLY``.

``CREATE INDEX CONCURRENTLY`` cannot run inside a transaction, so this revision commits
the surrounding migration transaction first (``autocommit_block``) and is deliberately
separate from the column revision (0013). A failed concurrent build leaves an invalid
index; ``IF NOT EXISTS`` plus the drop in ``downgrade`` make a retry safe after the
invalid index is dropped.

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-30
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_issues_search ON issues USING gin (search)"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_issues_search")
