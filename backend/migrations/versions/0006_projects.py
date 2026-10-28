"""Projects, project membership and seeded workflow/board configuration (M5).

Composite foreign keys (plan R3.3 rows 4-8, 19-20) all include ``org_id`` and tie
statuses, transitions, boards and column mappings to the *same workflow*, so a status
from another workflow or tenant cannot be referenced at the database level (FK checks
bypass RLS, which is why composite keys are required). ``workflows.initial_status_id``
is a DEFERRABLE composite FK, so a workflow and its statuses are created together.

RLS (forced): reads need an active org membership; writes need the matching right,
checked by SECURITY DEFINER helpers (pinned search_path):
- ``app_can_create_projects(org)``: org owner/admin, or explicit grant (D9 Option B);
- ``app_can_manage_project(project)``: org owner/admin, or project admin who is an
  active org member;
- the project's first admin row may be inserted only by its creator (initial claim);
- workflow/board rows are writable while their project is being created by someone who
  may create projects, and afterwards only by those who manage the project.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-27
"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)
DEFINER = "LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp"
MANAGERS = "ARRAY['owner', 'admin']"
TABLES = (
    "workflows",
    "workflow_statuses",
    "workflow_transitions",
    "projects",
    "project_issue_counters",
    "project_memberships",
    "boards",
    "board_columns",
    "board_column_statuses",
)
HELPERS = (
    "app_can_create_projects(uuid)",
    "app_can_manage_project(uuid)",
    "app_can_claim_project_admin(uuid)",
    "app_can_edit_workflow(uuid)",
    "app_can_edit_board(uuid)",
)


def _id() -> sa.Column[Any]:
    return sa.Column("id", UUID, server_default=sa.text("gen_random_uuid()"), nullable=False)


def _org() -> sa.Column[Any]:
    return sa.Column("org_id", UUID, nullable=False)


def _fk(
    name: str, cols: list[str], table: str, refcols: list[str], **kw: object
) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(cols, [f"{table}.{c}" for c in refcols], name=name, **kw)  # type: ignore[arg-type]


def _tables() -> None:
    op.create_table(
        "workflows",
        _id(),
        _org(),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("initial_status_id", UUID, nullable=False),
        _fk(
            "fk_workflows_org_id_organizations",
            ["org_id"],
            "organizations",
            ["id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_workflows"),
        sa.UniqueConstraint("org_id", "id", name="uq_workflows_org_id_id"),
    )
    op.create_table(
        "workflow_statuses",
        _id(),
        _org(),
        sa.Column("workflow_id", UUID, nullable=False),
        sa.Column("name", postgresql.CITEXT(), nullable=False),
        sa.Column("category", sa.String(16), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "category IN ('todo', 'in_progress', 'done')",
            name="ck_workflow_statuses_category_valid",
        ),
        _fk(
            "fk_workflow_statuses_org_id_workflows",
            ["org_id", "workflow_id"],
            "workflows",
            ["org_id", "id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_workflow_statuses"),
        sa.UniqueConstraint(
            "org_id", "workflow_id", "id", name="uq_workflow_statuses_org_id_workflow_id_id"
        ),
        sa.UniqueConstraint("workflow_id", "name", name="uq_workflow_statuses_workflow_id_name"),
    )
    op.create_foreign_key(
        "fk_workflows_org_id_initial_status_workflow_statuses",
        "workflows",
        "workflow_statuses",
        ["org_id", "id", "initial_status_id"],
        ["org_id", "workflow_id", "id"],
        deferrable=True,
        initially="DEFERRED",
    )
    op.create_table(
        "workflow_transitions",
        _id(),
        _org(),
        sa.Column("workflow_id", UUID, nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("from_status_id", UUID, nullable=True),
        sa.Column("to_status_id", UUID, nullable=False),
        _fk(
            "fk_workflow_transitions_org_id_workflows",
            ["org_id", "workflow_id"],
            "workflows",
            ["org_id", "id"],
            ondelete="CASCADE",
        ),
        _fk(
            "fk_workflow_transitions_org_id_from_status",
            ["org_id", "workflow_id", "from_status_id"],
            "workflow_statuses",
            ["org_id", "workflow_id", "id"],
        ),
        _fk(
            "fk_workflow_transitions_org_id_to_status",
            ["org_id", "workflow_id", "to_status_id"],
            "workflow_statuses",
            ["org_id", "workflow_id", "id"],
        ),
        sa.PrimaryKeyConstraint("id", name="pk_workflow_transitions"),
        sa.UniqueConstraint(
            "workflow_id",
            "from_status_id",
            "to_status_id",
            name="uq_workflow_transitions_workflow_id_from_status_id_to_status_id",
            postgresql_nulls_not_distinct=True,
        ),
    )
    op.create_table(
        "projects",
        _id(),
        _org(),
        sa.Column("key", sa.String(10), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.String(2000), nullable=True),
        sa.Column("board_type", sa.String(16), nullable=False),
        sa.Column("workflow_id", UUID, nullable=False),
        sa.Column("created_by", UUID, nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.CheckConstraint("key ~ '^[A-Z][A-Z0-9]{1,9}$'", name="ck_projects_key_format"),
        sa.CheckConstraint(
            "board_type IN ('kanban', 'scrum')", name="ck_projects_board_type_valid"
        ),
        sa.CheckConstraint(
            "name = btrim(name) AND char_length(name) BETWEEN 1 AND 100",
            name="ck_projects_name_valid",
        ),
        _fk(
            "fk_projects_org_id_workflows", ["org_id", "workflow_id"], "workflows", ["org_id", "id"]
        ),
        _fk(
            "fk_projects_org_id_created_by_org_memberships",
            ["org_id", "created_by"],
            "org_memberships",
            ["org_id", "user_id"],
        ),
        sa.PrimaryKeyConstraint("id", name="pk_projects"),
        sa.UniqueConstraint("org_id", "key", name="uq_projects_org_id_key"),
        sa.UniqueConstraint("org_id", "id", name="uq_projects_org_id_id"),
        sa.UniqueConstraint(
            "org_id", "id", "workflow_id", name="uq_projects_org_id_id_workflow_id"
        ),
        sa.UniqueConstraint("workflow_id", name="uq_projects_workflow_id"),
    )
    op.create_table(
        "project_issue_counters",
        _org(),
        sa.Column("project_id", UUID, nullable=False),
        sa.Column("next_seq", sa.Integer(), server_default=sa.text("0"), nullable=False),
        _fk(
            "fk_project_issue_counters_org_id_projects",
            ["org_id", "project_id"],
            "projects",
            ["org_id", "id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", name="pk_project_issue_counters"),
    )
    op.create_table(
        "project_memberships",
        _org(),
        sa.Column("project_id", UUID, nullable=False),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "role IN ('admin', 'member', 'viewer')", name="ck_project_memberships_role_valid"
        ),
        _fk(
            "fk_project_memberships_org_id_projects",
            ["org_id", "project_id"],
            "projects",
            ["org_id", "id"],
            ondelete="CASCADE",
        ),
        _fk(
            "fk_project_memberships_org_id_org_memberships",
            ["org_id", "user_id"],
            "org_memberships",
            ["org_id", "user_id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("project_id", "user_id", name="pk_project_memberships"),
    )
    op.create_index(
        "ix_project_memberships_org_id_user_id", "project_memberships", ["org_id", "user_id"]
    )
    op.create_table(
        "boards",
        _id(),
        _org(),
        sa.Column("project_id", UUID, nullable=False),
        sa.Column("workflow_id", UUID, nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        _fk(
            "fk_boards_org_id_projects",
            ["org_id", "project_id", "workflow_id"],
            "projects",
            ["org_id", "id", "workflow_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_boards"),
        sa.UniqueConstraint("project_id", name="uq_boards_project_id"),
        sa.UniqueConstraint("org_id", "id", name="uq_boards_org_id_id"),
        sa.UniqueConstraint("org_id", "id", "workflow_id", name="uq_boards_org_id_id_workflow_id"),
    )
    op.create_table(
        "board_columns",
        _id(),
        _org(),
        sa.Column("board_id", UUID, nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("wip_limit", sa.Integer(), nullable=True),
        _fk(
            "fk_board_columns_org_id_boards",
            ["org_id", "board_id"],
            "boards",
            ["org_id", "id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_board_columns"),
        sa.UniqueConstraint(
            "board_id",
            "position",
            name="uq_board_columns_board_id_position",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.UniqueConstraint("org_id", "board_id", "id", name="uq_board_columns_org_id_board_id_id"),
    )
    op.create_table(
        "board_column_statuses",
        _org(),
        sa.Column("board_id", UUID, nullable=False),
        sa.Column("workflow_id", UUID, nullable=False),
        sa.Column("column_id", UUID, nullable=False),
        sa.Column("status_id", UUID, nullable=False),
        _fk(
            "fk_board_column_statuses_org_id_board_columns",
            ["org_id", "board_id", "column_id"],
            "board_columns",
            ["org_id", "board_id", "id"],
            ondelete="CASCADE",
        ),
        _fk(
            "fk_board_column_statuses_org_id_boards",
            ["org_id", "board_id", "workflow_id"],
            "boards",
            ["org_id", "id", "workflow_id"],
            ondelete="CASCADE",
        ),
        _fk(
            "fk_board_column_statuses_org_id_workflow_statuses",
            ["org_id", "workflow_id", "status_id"],
            "workflow_statuses",
            ["org_id", "workflow_id", "id"],
        ),
        sa.PrimaryKeyConstraint("board_id", "status_id", name="pk_board_column_statuses"),
    )


def _helpers() -> None:
    op.execute(
        f"""
        CREATE FUNCTION app_can_create_projects(org uuid) RETURNS boolean {DEFINER} AS $$
          SELECT app_has_org_role(org, {MANAGERS})
              OR EXISTS (SELECT 1 FROM org_memberships m
                          WHERE m.org_id = org AND m.user_id = app_current_user()
                            AND m.removed_at IS NULL AND m.can_create_projects)
        $$
        """
    )
    op.execute(
        f"""
        CREATE FUNCTION app_can_manage_project(project uuid) RETURNS boolean {DEFINER} AS $$
          SELECT EXISTS (
            SELECT 1 FROM projects p
             WHERE p.id = project
               AND (app_has_org_role(p.org_id, {MANAGERS})
                    OR (app_is_org_member(p.org_id) AND EXISTS (
                          SELECT 1 FROM project_memberships pm
                           WHERE pm.project_id = p.id AND pm.user_id = app_current_user()
                             AND pm.role = 'admin'))))
        $$
        """
    )
    op.execute(
        f"""
        CREATE FUNCTION app_can_claim_project_admin(project uuid) RETURNS boolean {DEFINER} AS $$
          SELECT EXISTS (SELECT 1 FROM projects p
                          WHERE p.id = project AND p.created_by = app_current_user())
             AND NOT EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.project_id = project)
        $$
        """
    )
    # A workflow is editable while it belongs to no project yet (same-transaction creation)
    # by someone who may create projects, and afterwards only by the project's managers.
    op.execute(
        f"""
        CREATE FUNCTION app_can_edit_workflow(workflow uuid) RETURNS boolean {DEFINER} AS $$
          SELECT CASE
            WHEN EXISTS (SELECT 1 FROM projects p WHERE p.workflow_id = workflow)
              THEN EXISTS (SELECT 1 FROM projects p
                            WHERE p.workflow_id = workflow AND app_can_manage_project(p.id))
            ELSE EXISTS (SELECT 1 FROM workflows w
                          WHERE w.id = workflow AND app_can_create_projects(w.org_id))
          END
        $$
        """
    )
    op.execute(
        f"""
        CREATE FUNCTION app_can_edit_board(board uuid) RETURNS boolean {DEFINER} AS $$
          SELECT EXISTS (SELECT 1 FROM boards b
                          WHERE b.id = board AND app_can_manage_project(b.project_id))
        $$
        """
    )
    for helper in HELPERS:
        op.execute(f"REVOKE ALL ON FUNCTION {helper} FROM PUBLIC")
        op.execute(f"GRANT EXECUTE ON FUNCTION {helper} TO app_rw")


def _policies() -> None:
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY {table}_select ON {table} FOR SELECT TO app_rw "
            "USING (org_id = app_current_org() AND app_is_org_member(org_id))"
        )
    for table in ("projects", "project_memberships", "workflows", "boards"):
        op.execute(f"CREATE POLICY {table}_helpers ON {table} FOR SELECT TO app_owner USING (true)")

    scoped = "org_id = app_current_org() AND "
    op.execute(
        "CREATE POLICY projects_insert ON projects FOR INSERT TO app_rw WITH CHECK "
        f"({scoped}created_by = app_current_user() AND app_can_create_projects(org_id))"
    )
    op.execute(
        "CREATE POLICY projects_update ON projects FOR UPDATE TO app_rw "
        f"USING ({scoped}app_can_manage_project(id)) WITH CHECK (org_id = app_current_org())"
    )
    op.execute(
        "CREATE POLICY project_memberships_insert ON project_memberships FOR INSERT TO app_rw "
        f"WITH CHECK ({scoped}(app_can_manage_project(project_id) OR (user_id = app_current_user() "
        "AND role = 'admin' AND app_can_claim_project_admin(project_id))))"
    )
    for action in ("UPDATE", "DELETE"):
        check = " WITH CHECK (org_id = app_current_org())" if action == "UPDATE" else ""
        op.execute(
            f"CREATE POLICY project_memberships_{action.lower()} ON project_memberships "
            f"FOR {action} TO app_rw USING ({scoped}app_can_manage_project(project_id)){check}"
        )
    op.execute(
        "CREATE POLICY project_issue_counters_insert ON project_issue_counters FOR INSERT TO "
        "app_rw "
        f"WITH CHECK ({scoped}app_can_manage_project(project_id))"
    )
    op.execute(
        "CREATE POLICY workflows_insert ON workflows FOR INSERT TO app_rw "
        f"WITH CHECK ({scoped}app_can_create_projects(org_id))"
    )
    for table in ("workflow_statuses", "workflow_transitions"):
        op.execute(
            f"CREATE POLICY {table}_insert ON {table} FOR INSERT TO app_rw "
            f"WITH CHECK ({scoped}app_can_edit_workflow(workflow_id))"
        )
    op.execute(
        "CREATE POLICY boards_insert ON boards FOR INSERT TO app_rw "
        f"WITH CHECK ({scoped}app_can_manage_project(project_id))"
    )
    for table in ("board_columns", "board_column_statuses"):
        op.execute(
            f"CREATE POLICY {table}_insert ON {table} FOR INSERT TO app_rw "
            f"WITH CHECK ({scoped}app_can_edit_board(board_id))"
        )


def _grants() -> None:
    for table in TABLES:
        op.execute(f"REVOKE ALL ON {table} FROM PUBLIC, app_rw, app_worker")
        op.execute(f"GRANT SELECT, INSERT ON {table} TO app_rw")
    op.execute("GRANT UPDATE (name, description, archived_at, updated_at) ON projects TO app_rw")
    op.execute("GRANT UPDATE (role), DELETE ON project_memberships TO app_rw")


def upgrade() -> None:
    _tables()
    _helpers()
    _policies()
    _grants()


def downgrade() -> None:
    op.drop_constraint(
        "fk_workflows_org_id_initial_status_workflow_statuses", "workflows", type_="foreignkey"
    )
    for table in reversed(TABLES):
        op.drop_table(table)  # policies, indexes and constraints go with the tables
    for helper in reversed(HELPERS):
        op.execute(f"DROP FUNCTION {helper}")
