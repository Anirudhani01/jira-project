"""Transitions, assignment, labels, hierarchy (M7).

``issues.assignee_id`` and ``issues.parent_id`` already exist and carry their composite
foreign keys since migration 0007 (written from M7, per that migration's own comment);
this migration only widens the column-level ``UPDATE`` grant on ``app_rw`` to cover
``status_id`` (transitions), ``parent_id`` (hierarchy) and ``done_at`` (set when a
transition's target status category is ``done``, cleared otherwise) -- ``assignee_id``
was already grantable.

New tables: ``labels`` (per project) and ``issue_labels`` (plan R3.3 row 16). Both reuse
the M5/M6 SECURITY DEFINER helpers (``app_can_view_project``, ``app_can_manage_project``,
``app_can_write_issues``) -- no new helper functions.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)
CITEXT = postgresql.CITEXT()
TABLES = ("labels", "issue_labels")


def _fk(
    name: str, cols: list[str], table: str, refcols: list[str], **kw: object
) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(cols, [f"{table}.{c}" for c in refcols], name=name, **kw)  # type: ignore[arg-type]


def _tables() -> None:
    op.create_table(
        "labels",
        sa.Column("id", UUID, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("org_id", UUID, nullable=False),
        sa.Column("project_id", UUID, nullable=False),
        sa.Column("name", CITEXT, nullable=False),
        sa.Column("color", sa.String(7), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "name = btrim(name) AND char_length(name) BETWEEN 1 AND 50", name="ck_labels_name_valid"
        ),
        sa.CheckConstraint("color ~ '^#[0-9A-Fa-f]{6}$'", name="ck_labels_color_valid"),
        _fk(
            "fk_labels_org_id_projects",
            ["org_id", "project_id"],
            "projects",
            ["org_id", "id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_labels"),
        sa.UniqueConstraint("org_id", "id", name="uq_labels_org_id_id"),
        sa.UniqueConstraint("org_id", "project_id", "id", name="uq_labels_org_id_project_id_id"),
        sa.UniqueConstraint("project_id", "name", name="uq_labels_project_id_name"),
        implicit_returning=False,
    )
    op.create_table(
        "issue_labels",
        sa.Column("org_id", UUID, nullable=False),
        sa.Column("project_id", UUID, nullable=False),
        sa.Column("issue_id", UUID, nullable=False),
        sa.Column("label_id", UUID, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        _fk(
            "fk_issue_labels_org_id_issues",
            ["org_id", "project_id", "issue_id"],
            "issues",
            ["org_id", "project_id", "id"],
            ondelete="CASCADE",
        ),
        _fk(
            "fk_issue_labels_org_id_labels",
            ["org_id", "project_id", "label_id"],
            "labels",
            ["org_id", "project_id", "id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("issue_id", "label_id", name="pk_issue_labels"),
        implicit_returning=False,
    )
    op.create_index(
        "ix_issue_labels_project_id_label_id", "issue_labels", ["project_id", "label_id"]
    )


def _policies() -> None:
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    scoped = "org_id = app_current_org() AND "
    op.execute(
        "CREATE POLICY labels_select ON labels FOR SELECT TO app_rw "
        f"USING ({scoped}app_can_view_project(project_id))"
    )
    op.execute(
        "CREATE POLICY labels_insert ON labels FOR INSERT TO app_rw WITH CHECK "
        f"({scoped}app_can_manage_project(project_id))"
    )
    op.execute(
        "CREATE POLICY labels_delete ON labels FOR DELETE TO app_rw "
        f"USING ({scoped}app_can_manage_project(project_id))"
    )
    # issue_labels follows its issue's visibility/write rules, like issue_activity (0007).
    op.execute(
        "CREATE POLICY issue_labels_select ON issue_labels FOR SELECT TO app_rw "
        f"USING ({scoped}EXISTS (SELECT 1 FROM issues i WHERE i.id = issue_id))"
    )
    op.execute(
        "CREATE POLICY issue_labels_insert ON issue_labels FOR INSERT TO app_rw WITH CHECK "
        f"({scoped}EXISTS (SELECT 1 FROM issues i "
        "WHERE i.id = issue_id AND app_can_write_issues(i.project_id)))"
    )
    op.execute(
        "CREATE POLICY issue_labels_delete ON issue_labels FOR DELETE TO app_rw "
        f"USING ({scoped}EXISTS (SELECT 1 FROM issues i "
        "WHERE i.id = issue_id AND app_can_write_issues(i.project_id)))"
    )


def _grants() -> None:
    for table in TABLES:
        op.execute(f"REVOKE ALL ON {table} FROM PUBLIC, app_rw, app_worker")
        op.execute(f"GRANT SELECT, INSERT, DELETE ON {table} TO app_rw")
    # Transitions (status_id), hierarchy (parent_id) and the done-status timestamp: the
    # M6 grant already covered assignee_id.
    op.execute("GRANT UPDATE (status_id, parent_id, done_at) ON issues TO app_rw")


def upgrade() -> None:
    _tables()
    _policies()
    _grants()


def downgrade() -> None:
    op.execute("REVOKE UPDATE (status_id, parent_id, done_at) ON issues FROM app_rw")
    for table in reversed(TABLES):
        op.drop_table(table)  # policies, indexes and constraints go with the tables
