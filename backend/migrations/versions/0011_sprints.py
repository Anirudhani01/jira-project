"""Sprints and backlog (M10).

``sprints`` (plan R3.3 rows 15/21): state ``future -> active -> closed``, a partial unique
index allowing one active sprint per project, date and state CHECKs, and an FK from
``issues`` ``(org_id, project_id, sprint_id) -> sprints`` that is added ``NOT VALID`` and
then validated (plan M10), with ``ON DELETE SET NULL (sprint_id)`` so deleting a future
sprint returns its issues to the backlog without touching org/project.

RLS reuses the M6 helpers: anyone who can view the project reads its sprints;
``app_can_write_issues`` (org owner/admin or project admin/member, the ``sprint.manage``
bucket) inserts and updates; only ``future`` sprints can be deleted. ``app_rw`` also gets
``UPDATE (sprint_id)`` on ``issues``.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-30
"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)
SCOPED = "org_id = app_current_org()"


def _ck(name: str, condition: str) -> sa.CheckConstraint:
    return sa.CheckConstraint(condition, name=name)


def upgrade() -> None:
    columns: list[Any] = [
        sa.Column("id", UUID, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("org_id", UUID, nullable=False),
        sa.Column("project_id", UUID, nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("goal", sa.Text, nullable=True),
        sa.Column("state", sa.String(16), server_default=sa.text("'future'"), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.PrimaryKeyConstraint("id", name="pk_sprints"),
        sa.ForeignKeyConstraint(
            ["org_id", "project_id"],
            ["projects.org_id", "projects.id"],
            name="fk_sprints_org_id_projects",
        ),
        sa.UniqueConstraint("org_id", "project_id", "id", name="uq_sprints_org_id_project_id_id"),
        _ck("ck_sprints_state_valid", "state IN ('future', 'active', 'closed')"),
        _ck(
            "ck_sprints_name_valid",
            "name = btrim(name) AND char_length(name) BETWEEN 1 AND 100",
        ),
        _ck("ck_sprints_goal_length", "goal IS NULL OR char_length(goal) <= 1000"),
        _ck(
            "ck_sprints_dates_valid",
            "(start_at IS NULL) = (end_at IS NULL) AND (end_at IS NULL OR end_at > start_at)",
        ),
        _ck("ck_sprints_started_has_dates", "state = 'future' OR start_at IS NOT NULL"),
        _ck(
            "ck_sprints_completed_matches_state",
            "(completed_at IS NOT NULL) = (state = 'closed')",
        ),
    ]
    op.create_table("sprints", *columns)
    op.create_index("ix_sprints_project_id_state", "sprints", ["project_id", "state"])
    op.create_index(
        "uq_sprints_project_id_active",
        "sprints",
        ["project_id"],
        unique=True,
        postgresql_where=sa.text("state = 'active'"),
    )

    op.execute("ALTER TABLE sprints ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE sprints FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY sprints_select ON sprints FOR SELECT TO app_rw "
        f"USING ({SCOPED} AND app_can_view_project(project_id))"
    )
    op.execute(
        "CREATE POLICY sprints_insert ON sprints FOR INSERT TO app_rw "
        f"WITH CHECK ({SCOPED} AND app_can_write_issues(project_id))"
    )
    op.execute(
        "CREATE POLICY sprints_update ON sprints FOR UPDATE TO app_rw "
        f"USING ({SCOPED} AND app_can_write_issues(project_id)) "
        f"WITH CHECK ({SCOPED} AND app_can_write_issues(project_id))"
    )
    op.execute(
        "CREATE POLICY sprints_delete ON sprints FOR DELETE TO app_rw "
        f"USING ({SCOPED} AND app_can_write_issues(project_id) AND state = 'future')"
    )
    op.execute("REVOKE ALL ON sprints FROM PUBLIC, app_rw, app_worker")
    op.execute("GRANT SELECT, INSERT, DELETE ON sprints TO app_rw")
    op.execute(
        "GRANT UPDATE (name, goal, state, start_at, end_at, completed_at, updated_at) "
        "ON sprints TO app_rw"
    )
    op.execute("GRANT UPDATE (sprint_id) ON issues TO app_rw")

    op.execute(
        "ALTER TABLE issues ADD CONSTRAINT fk_issues_org_id_sprints "
        "FOREIGN KEY (org_id, project_id, sprint_id) "
        "REFERENCES sprints (org_id, project_id, id) ON DELETE SET NULL (sprint_id) NOT VALID"
    )
    op.execute("ALTER TABLE issues VALIDATE CONSTRAINT fk_issues_org_id_sprints")


def downgrade() -> None:
    op.execute("ALTER TABLE issues DROP CONSTRAINT fk_issues_org_id_sprints")
    op.execute("REVOKE UPDATE (sprint_id) ON issues FROM app_rw")
    op.drop_table("sprints")
