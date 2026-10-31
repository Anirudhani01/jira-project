"""Versions / releases and the issue fix version.

``versions`` (per project): name (unique per project, case-insensitive), description, start and
release dates, status ``unreleased -> released -> archived`` and a manual ``position`` for
ordering. RLS: anyone who can view the project reads its versions; only project admins (the
``app_can_manage_project`` helper, which includes org owners/admins) create, update or delete.

``issues.fix_version_id`` is an optional single fix version, tied to the same project by a
composite FK that is ``ON DELETE SET NULL (fix_version_id)``; ``app_rw`` may update it (the
service layer also bumps ``version`` and writes activity).

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-01
"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)
SCOPED = "org_id = app_current_org()"


def upgrade() -> None:
    columns: list[Any] = [
        sa.Column("id", UUID, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("org_id", UUID, nullable=False),
        sa.Column("project_id", UUID, nullable=False),
        sa.Column("name", postgresql.CITEXT(), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("start_date", sa.Date, nullable=True),
        sa.Column("release_date", sa.Date, nullable=True),
        sa.Column("status", sa.String(16), server_default=sa.text("'unreleased'"), nullable=False),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("position", sa.Integer, nullable=False),
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
        sa.PrimaryKeyConstraint("id", name="pk_versions"),
        sa.ForeignKeyConstraint(
            ["org_id", "project_id"],
            ["projects.org_id", "projects.id"],
            name="fk_versions_org_id_projects",
        ),
        sa.UniqueConstraint("org_id", "project_id", "id", name="uq_versions_org_id_project_id_id"),
        sa.UniqueConstraint("project_id", "name", name="uq_versions_project_id_name"),
        sa.CheckConstraint(
            "status IN ('unreleased', 'released', 'archived')", name="ck_versions_status_valid"
        ),
        sa.CheckConstraint(
            "name = btrim(name) AND char_length(name) BETWEEN 1 AND 100",
            name="ck_versions_name_valid",
        ),
        sa.CheckConstraint(
            "description IS NULL OR char_length(description) <= 1000",
            name="ck_versions_description_length",
        ),
        sa.CheckConstraint(
            "start_date IS NULL OR release_date IS NULL OR release_date >= start_date",
            name="ck_versions_dates_ordered",
        ),
        sa.CheckConstraint(
            "status <> 'released' OR released_at IS NOT NULL", name="ck_versions_released_has_time"
        ),
    ]
    op.create_table("versions", *columns)
    op.create_index("ix_versions_project_id_position", "versions", ["project_id", "position"])

    op.execute("ALTER TABLE versions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE versions FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY versions_select ON versions FOR SELECT TO app_rw "
        f"USING ({SCOPED} AND app_can_view_project(project_id))"
    )
    op.execute(
        "CREATE POLICY versions_insert ON versions FOR INSERT TO app_rw "
        f"WITH CHECK ({SCOPED} AND app_can_manage_project(project_id))"
    )
    op.execute(
        "CREATE POLICY versions_update ON versions FOR UPDATE TO app_rw "
        f"USING ({SCOPED} AND app_can_manage_project(project_id)) "
        f"WITH CHECK ({SCOPED} AND app_can_manage_project(project_id))"
    )
    op.execute(
        "CREATE POLICY versions_delete ON versions FOR DELETE TO app_rw "
        f"USING ({SCOPED} AND app_can_manage_project(project_id))"
    )
    op.execute("REVOKE ALL ON versions FROM PUBLIC, app_rw, app_worker")
    op.execute("GRANT SELECT, INSERT, DELETE ON versions TO app_rw")
    op.execute(
        "GRANT UPDATE (name, description, start_date, release_date, status, released_at, "
        "position, updated_at) ON versions TO app_rw"
    )

    op.add_column("issues", sa.Column("fix_version_id", UUID, nullable=True))
    op.execute(
        "ALTER TABLE issues ADD CONSTRAINT fk_issues_org_id_versions "
        "FOREIGN KEY (org_id, project_id, fix_version_id) "
        "REFERENCES versions (org_id, project_id, id) ON DELETE SET NULL (fix_version_id)"
    )
    op.create_index(
        "ix_issues_project_id_fix_version_id",
        "issues",
        ["project_id", "fix_version_id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.execute("GRANT UPDATE (fix_version_id) ON issues TO app_rw")


def downgrade() -> None:
    op.execute("REVOKE UPDATE (fix_version_id) ON issues FROM app_rw")
    op.drop_index("ix_issues_project_id_fix_version_id", table_name="issues")
    op.execute("ALTER TABLE issues DROP CONSTRAINT fk_issues_org_id_versions")
    op.drop_column("issues", "fix_version_id")
    op.drop_table("versions")
