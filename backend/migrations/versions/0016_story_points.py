"""Story points (UI PR 11): an optional estimate on issues.

``issues.story_points`` is a nullable ``smallint`` constrained to 0..100, writable by
``app_rw`` like the other editable fields (its change bumps ``version`` and writes
``issue_activity``, enforced in the service layer, not here).

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("issues", sa.Column("story_points", sa.SmallInteger(), nullable=True))
    op.create_check_constraint(
        "ck_issues_story_points_range",
        "issues",
        "story_points IS NULL OR story_points BETWEEN 0 AND 100",
    )
    op.execute("GRANT UPDATE (story_points) ON issues TO app_rw")


def downgrade() -> None:
    op.execute("REVOKE UPDATE (story_points) ON issues FROM app_rw")
    op.drop_constraint("ck_issues_story_points_range", "issues", type_="check")
    op.drop_column("issues", "story_points")
