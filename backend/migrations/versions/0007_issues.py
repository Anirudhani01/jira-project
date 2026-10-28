"""Issues core (M6): issues, issue activity and idempotency keys.

Composite foreign keys (plan R3.3 rows 9-15) all include ``org_id``: an issue's workflow is
its project's workflow, its status belongs to that workflow, and type, priority, reporter,
assignee and parent come from the same tenant (parent: same project). ``sprint_id`` gets
its foreign key in M10; ``parent_id``/``assignee_id`` are written from M7.

RLS (forced) is project-aware, not just org-scoped: an issue is visible only to callers
who can view its project (org owner/admin, or a project member), and writable only by org
owners/admins and project admins/members (SECURITY DEFINER helpers, pinned search_path).
``issue_activity`` is append-only for ``app_rw``; ``idempotency_keys`` rows belong to one
member of one org.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-28
"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)
DEFINER = "LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp"
MANAGERS = "ARRAY['owner', 'admin']"
TABLES = ("issues", "issue_activity", "idempotency_keys")
HELPERS = ("app_can_view_project(uuid)", "app_can_write_issues(uuid)")
NOT_DELETED = sa.text("deleted_at IS NULL")


def _ts(name: str, nullable: bool = False) -> sa.Column[Any]:
    default = None if nullable else sa.text("now()")
    return sa.Column(name, sa.DateTime(timezone=True), server_default=default, nullable=nullable)


def _fk(
    name: str, cols: list[str], table: str, refcols: list[str], **kw: object
) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(cols, [f"{table}.{c}" for c in refcols], name=name, **kw)  # type: ignore[arg-type]


def _member_fk(table: str, column: str) -> sa.ForeignKeyConstraint:
    return _fk(
        f"fk_{table}_org_id_{column}_org_memberships",
        ["org_id", column],
        "org_memberships",
        ["org_id", "user_id"],
        ondelete="RESTRICT",
    )


def _tables() -> None:
    op.create_table(
        "issues",
        sa.Column("id", UUID, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("org_id", UUID, nullable=False),
        sa.Column("project_id", UUID, nullable=False),
        sa.Column("workflow_id", UUID, nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("type_id", UUID, nullable=False),
        sa.Column("status_id", UUID, nullable=False),
        sa.Column("priority_id", UUID, nullable=False),
        sa.Column("parent_id", UUID, nullable=True),
        sa.Column("assignee_id", UUID, nullable=True),
        sa.Column("reporter_id", UUID, nullable=False),
        sa.Column("sprint_id", UUID, nullable=True),
        sa.Column("summary", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("rank", sa.Text(collation="C"), nullable=False),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        _ts("done_at", nullable=True),
        _ts("created_at"),
        _ts("updated_at"),
        _ts("deleted_at", nullable=True),
        sa.CheckConstraint("seq > 0", name="ck_issues_seq_positive"),
        sa.CheckConstraint(
            "summary = btrim(summary) AND char_length(summary) BETWEEN 1 AND 255",
            name="ck_issues_summary_valid",
        ),
        sa.CheckConstraint(
            "description IS NULL OR char_length(description) <= 32000",
            name="ck_issues_description_length",
        ),
        sa.CheckConstraint("parent_id <> id", name="ck_issues_parent_not_self"),
        sa.CheckConstraint("version > 0", name="ck_issues_version_positive"),
        _fk(
            "fk_issues_org_id_projects",
            ["org_id", "project_id", "workflow_id"],
            "projects",
            ["org_id", "id", "workflow_id"],
            ondelete="RESTRICT",
        ),
        _fk(
            "fk_issues_org_id_workflow_statuses",
            ["org_id", "workflow_id", "status_id"],
            "workflow_statuses",
            ["org_id", "workflow_id", "id"],
            ondelete="RESTRICT",
        ),
        _fk(
            "fk_issues_org_id_issue_types",
            ["org_id", "type_id"],
            "issue_types",
            ["org_id", "id"],
            ondelete="RESTRICT",
        ),
        _fk(
            "fk_issues_org_id_priorities",
            ["org_id", "priority_id"],
            "priorities",
            ["org_id", "id"],
            ondelete="RESTRICT",
        ),
        _fk(
            "fk_issues_org_id_parent_issues",
            ["org_id", "project_id", "parent_id"],
            "issues",
            ["org_id", "project_id", "id"],
            ondelete="RESTRICT",
        ),
        _member_fk("issues", "reporter_id"),
        _member_fk("issues", "assignee_id"),
        sa.PrimaryKeyConstraint("id", name="pk_issues"),
        sa.UniqueConstraint("project_id", "seq", name="uq_issues_project_id_seq"),
        sa.UniqueConstraint("org_id", "id", name="uq_issues_org_id_id"),
        sa.UniqueConstraint("org_id", "project_id", "id", name="uq_issues_org_id_project_id_id"),
    )
    op.create_index(
        "ix_issues_project_id_status_id_rank",
        "issues",
        ["project_id", "status_id", "rank", "id"],
        postgresql_where=NOT_DELETED,
    )
    op.create_index(
        "ix_issues_project_id_sprint_id_rank",
        "issues",
        ["project_id", "sprint_id", "rank"],
        postgresql_where=NOT_DELETED,
    )
    op.create_index(
        "ix_issues_org_id_assignee_id",
        "issues",
        ["org_id", "assignee_id"],
        postgresql_where=NOT_DELETED,
    )
    op.create_index("ix_issues_parent_id", "issues", ["parent_id"])
    op.create_index(
        "ix_issues_project_id_updated_at", "issues", ["project_id", sa.text("updated_at DESC")]
    )
    op.create_index(
        "ix_issues_org_id_updated_at", "issues", ["org_id", sa.text("updated_at DESC"), "id"]
    )
    op.create_table(
        "issue_activity",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("org_id", UUID, nullable=False),
        sa.Column("issue_id", UUID, nullable=False),
        sa.Column("actor_id", UUID, nullable=True),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("field", sa.String(32), nullable=True),
        sa.Column("old_value", postgresql.JSONB(), nullable=True),
        sa.Column("new_value", postgresql.JSONB(), nullable=True),
        _ts("created_at"),
        _fk(
            "fk_issue_activity_org_id_issues",
            ["org_id", "issue_id"],
            "issues",
            ["org_id", "id"],
            ondelete="RESTRICT",
        ),
        _member_fk("issue_activity", "actor_id"),
        sa.PrimaryKeyConstraint("id", name="pk_issue_activity"),
    )
    op.create_index(
        "ix_issue_activity_issue_id_created_at", "issue_activity", ["issue_id", "created_at", "id"]
    )
    op.create_table(
        "idempotency_keys",
        sa.Column("org_id", UUID, nullable=False),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("request_hash", sa.LargeBinary(), nullable=False),
        sa.Column("response_status", sa.SmallInteger(), nullable=True),
        sa.Column("response_body", postgresql.JSONB(), nullable=True),
        _ts("created_at"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        _member_fk("idempotency_keys", "user_id"),
        sa.PrimaryKeyConstraint("org_id", "user_id", "key", name="pk_idempotency_keys"),
    )


def _helpers() -> None:
    member = (
        "app_is_org_member(p.org_id) AND EXISTS (SELECT 1 FROM project_memberships pm "
        "WHERE pm.project_id = p.id AND pm.user_id = app_current_user()"
    )
    op.execute(
        f"""
        CREATE FUNCTION app_can_view_project(project uuid) RETURNS boolean {DEFINER} AS $$
          SELECT EXISTS (SELECT 1 FROM projects p WHERE p.id = project
                           AND (app_has_org_role(p.org_id, {MANAGERS}) OR ({member}))))
        $$
        """
    )
    op.execute(
        f"""
        CREATE FUNCTION app_can_write_issues(project uuid) RETURNS boolean {DEFINER} AS $$
          SELECT EXISTS (SELECT 1 FROM projects p WHERE p.id = project
                           AND (app_has_org_role(p.org_id, {MANAGERS})
                                OR ({member} AND pm.role IN ('admin', 'member')))))
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
    scoped = "org_id = app_current_org() AND "
    op.execute(
        "CREATE POLICY issues_select ON issues FOR SELECT TO app_rw "
        f"USING ({scoped}app_can_view_project(project_id))"
    )
    op.execute(
        "CREATE POLICY issues_insert ON issues FOR INSERT TO app_rw WITH CHECK "
        f"({scoped}reporter_id = app_current_user() AND app_can_write_issues(project_id))"
    )
    op.execute(
        "CREATE POLICY issues_update ON issues FOR UPDATE TO app_rw "
        f"USING ({scoped}app_can_write_issues(project_id)) "
        f"WITH CHECK ({scoped}app_can_write_issues(project_id))"
    )
    # Activity follows its issue: the subquery runs under the issues policy above.
    op.execute(
        "CREATE POLICY issue_activity_select ON issue_activity FOR SELECT TO app_rw "
        f"USING ({scoped}EXISTS (SELECT 1 FROM issues i WHERE i.id = issue_id))"
    )
    op.execute(
        "CREATE POLICY issue_activity_insert ON issue_activity FOR INSERT TO app_rw WITH CHECK "
        f"({scoped}actor_id = app_current_user() AND EXISTS (SELECT 1 FROM issues i "
        "WHERE i.id = issue_id AND app_can_write_issues(i.project_id)))"
    )
    own_key = f"{scoped}user_id = app_current_user()"
    op.execute(
        "CREATE POLICY idempotency_keys_own ON idempotency_keys FOR ALL TO app_rw "
        f"USING ({own_key}) WITH CHECK ({own_key})"
    )
    op.execute(
        "CREATE POLICY project_issue_counters_update ON project_issue_counters FOR UPDATE "
        f"TO app_rw USING ({scoped}app_can_write_issues(project_id)) "
        "WITH CHECK (org_id = app_current_org())"
    )


def _grants() -> None:
    for table in TABLES:
        op.execute(f"REVOKE ALL ON {table} FROM PUBLIC, app_rw, app_worker")
        op.execute(f"GRANT SELECT, INSERT ON {table} TO app_rw")
    op.execute(
        "GRANT UPDATE (summary, description, type_id, priority_id, assignee_id, rank, version, "
        "updated_at, deleted_at) ON issues TO app_rw"
    )
    op.execute(
        "GRANT UPDATE (request_hash, response_status, response_body, created_at, expires_at) "
        "ON idempotency_keys TO app_rw"
    )
    op.execute("GRANT UPDATE (next_seq) ON project_issue_counters TO app_rw")


def upgrade() -> None:
    _tables()
    _helpers()
    _policies()
    _grants()


def downgrade() -> None:
    op.execute("REVOKE UPDATE (next_seq) ON project_issue_counters FROM app_rw")
    op.execute("DROP POLICY project_issue_counters_update ON project_issue_counters")
    for table in reversed(TABLES):
        op.drop_table(table)  # policies, indexes and constraints go with the tables
    for helper in reversed(HELPERS):
        op.execute(f"DROP FUNCTION {helper}")
