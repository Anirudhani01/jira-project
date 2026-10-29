"""Issue full-text search column (M12).

``issues.search`` is a generated ``tsvector`` (summary weight A, description weight B,
``english`` configuration, which is immutable and therefore allowed in a generated
column). The GIN index is built ``CONCURRENTLY`` in the next, non-transactional revision
(0014), as the plan requires for large tables.

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-30
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE issues ADD COLUMN search tsvector GENERATED ALWAYS AS ("
        "setweight(to_tsvector('english'::regconfig, coalesce(summary, '')), 'A') || "
        "setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'B')"
        ") STORED"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE issues DROP COLUMN search")
