"""Project settings (B2): nullable story points overrides per project.

One optional row per project; NULL override columns inherit from organization_settings.
RLS mirrors project-scoped resources such as versions (view vs manage).

Revision ID: 0023
Revises: 0022
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)
SCOPED = "org_id = app_current_org()"
RUNTIME_ROLES = "app_rw, app_worker"


def upgrade() -> None:
    op.create_table(
        "project_settings",
        sa.Column("project_id", UUID, nullable=False),
        sa.Column("org_id", UUID, nullable=False),
        sa.Column("story_points_enabled_override", sa.Boolean(), nullable=True),
        sa.Column("story_points_max_override", sa.SmallInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("project_id", name="pk_project_settings"),
        sa.ForeignKeyConstraint(
            ["org_id", "project_id"],
            ["projects.org_id", "projects.id"],
            name="fk_project_settings_org_id_projects",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "story_points_max_override IS NULL OR "
            "story_points_max_override BETWEEN 1 AND 100",
            name="ck_project_settings_story_points_max_override_range",
        ),
    )

    op.execute("ALTER TABLE project_settings ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE project_settings FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY project_settings_select ON project_settings FOR SELECT TO app_rw "
        f"USING ({SCOPED} AND app_can_view_project(project_id))"
    )
    op.execute(
        "CREATE POLICY project_settings_insert ON project_settings FOR INSERT TO app_rw "
        f"WITH CHECK ({SCOPED} AND app_can_manage_project(project_id))"
    )
    op.execute(
        "CREATE POLICY project_settings_update ON project_settings FOR UPDATE TO app_rw "
        f"USING ({SCOPED} AND app_can_manage_project(project_id)) "
        f"WITH CHECK ({SCOPED} AND app_can_manage_project(project_id))"
    )
    op.execute(
        "CREATE POLICY project_settings_delete ON project_settings FOR DELETE TO app_rw "
        f"USING ({SCOPED} AND app_can_manage_project(project_id))"
    )

    op.execute(f"REVOKE ALL ON project_settings FROM PUBLIC, {RUNTIME_ROLES}")
    op.execute("GRANT SELECT, INSERT, DELETE ON project_settings TO app_rw")
    op.execute(
        "GRANT UPDATE (story_points_enabled_override, story_points_max_override, updated_at) "
        "ON project_settings TO app_rw"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS project_settings_delete ON project_settings")
    op.execute("DROP POLICY IF EXISTS project_settings_update ON project_settings")
    op.execute("DROP POLICY IF EXISTS project_settings_insert ON project_settings")
    op.execute("DROP POLICY IF EXISTS project_settings_select ON project_settings")
    op.drop_table("project_settings")
