"""Organization story points defaults (B1): enabled flag and max estimate on organization_settings.

Backfill existing rows with enabled=true and max=100. Extends column-level UPDATE grant.

Revision ID: 0022
Revises: 0020
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RUNTIME_ROLES = "app_rw, app_worker"


def upgrade() -> None:
    op.add_column(
        "organization_settings",
        sa.Column(
            "story_points_enabled",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
    )
    op.add_column(
        "organization_settings",
        sa.Column(
            "story_points_max",
            sa.SmallInteger(),
            server_default=sa.text("100"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_organization_settings_story_points_max_range",
        "organization_settings",
        "story_points_max BETWEEN 1 AND 100",
    )
    op.execute(f"REVOKE ALL ON organization_settings FROM PUBLIC, {RUNTIME_ROLES}")
    op.execute("GRANT SELECT, INSERT ON organization_settings TO app_rw")
    op.execute(
        "GRANT UPDATE (timezone, locale, story_points_enabled, story_points_max, updated_at) "
        "ON organization_settings TO app_rw"
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_organization_settings_story_points_max_range",
        "organization_settings",
        type_="check",
    )
    op.drop_column("organization_settings", "story_points_max")
    op.drop_column("organization_settings", "story_points_enabled")
    op.execute(f"REVOKE ALL ON organization_settings FROM PUBLIC, {RUNTIME_ROLES}")
    op.execute("GRANT SELECT, INSERT ON organization_settings TO app_rw")
    op.execute("GRANT UPDATE (timezone, locale, updated_at) ON organization_settings TO app_rw")
