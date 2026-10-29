"""Comments & activity timeline (M8).

``comments`` (plan §2.3, R3.3 row 17): one row per comment, soft-deleted (never hard
``DELETE``-d, matching ``issues``: no ``DELETE`` grant on ``app_rw`` at all, only
``UPDATE (... deleted_at)``). The FK to ``issues`` is ``(org_id, issue_id) -> (org_id,
id)`` only -- no denormalized ``project_id`` column, exactly like ``issue_activity``
(0007): project-level checks reach the issue's project through a join, and the issue's
own RLS policy already gates that join.

No new SECURITY DEFINER helpers: reuses ``app_can_write_issues`` (M6/0007 -- org
owner/admin or an active project admin/member, not viewer) for create and for a comment's
own author editing/deleting it, and ``app_can_manage_project`` (M5/0006 -- org owner/admin
or an active project admin) for deleting *any* comment. These two helpers already match
the plan's permission matrix exactly: ``comment.create``/``comment.edit_own`` sit in the
same role bucket as ``issue.create``/``issue.edit``; ``comment.delete_any`` sits in the
same bucket as ``issue.delete``.

``comments_update`` is one policy covering both an edit (``body``/``edited_at``) and a
soft delete (``deleted_at``): deliberately more precise than the issues precedent (which
uses a single ``app_can_write_issues`` check for all of summary/priority/status/assignee
edits *and* delete, trusting the service layer alone for the member-vs-admin distinction
on delete). For comments the business rule is more specific -- an author may act on their
*own* comment only while still holding a non-viewer role; losing project access or being
demoted to viewer removes that path even though the row still exists -- so the RLS policy
encodes it directly as a backstop, not just the service layer. The service layer still
owns the exact action-level distinction (edit is author-only, always; delete is
author-or-admin) and additionally scopes its own UPDATE statements narrowly by id/author,
so RLS being unable to tell "a body edit" apart from "a soft delete" within one UPDATE
command is not a gap in practice.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)
TABLES = ("comments",)
NOT_DELETED = sa.text("deleted_at IS NULL")


def _fk(
    name: str, cols: list[str], table: str, refcols: list[str], **kw: object
) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(cols, [f"{table}.{c}" for c in refcols], name=name, **kw)  # type: ignore[arg-type]


def _ts(name: str, nullable: bool = False) -> sa.Column[object]:
    default = None if nullable else sa.text("now()")
    return sa.Column(name, sa.DateTime(timezone=True), server_default=default, nullable=nullable)


def _tables() -> None:
    op.create_table(
        "comments",
        sa.Column("id", UUID, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("org_id", UUID, nullable=False),
        sa.Column("issue_id", UUID, nullable=False),
        sa.Column("author_id", UUID, nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        _ts("edited_at", nullable=True),
        _ts("created_at"),
        _ts("updated_at"),
        _ts("deleted_at", nullable=True),
        sa.CheckConstraint(
            "body = btrim(body) AND char_length(body) BETWEEN 1 AND 32000",
            name="ck_comments_body_valid",
        ),
        _fk(
            "fk_comments_org_id_issues",
            ["org_id", "issue_id"],
            "issues",
            ["org_id", "id"],
            ondelete="RESTRICT",
        ),
        _fk(
            "fk_comments_org_id_author_id_org_memberships",
            ["org_id", "author_id"],
            "org_memberships",
            ["org_id", "user_id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_comments"),
        sa.UniqueConstraint("org_id", "id", name="uq_comments_org_id_id"),
        implicit_returning=False,
    )
    op.create_index(
        "ix_comments_issue_id_created_at",
        "comments",
        ["issue_id", "created_at", "id"],
        postgresql_where=NOT_DELETED,
    )


def _policies() -> None:
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    scoped = "org_id = app_current_org() AND "
    op.execute(
        "CREATE POLICY comments_select ON comments FOR SELECT TO app_rw "
        f"USING ({scoped}EXISTS (SELECT 1 FROM issues i WHERE i.id = issue_id))"
    )
    op.execute(
        "CREATE POLICY comments_insert ON comments FOR INSERT TO app_rw WITH CHECK "
        f"({scoped}author_id = app_current_user() AND EXISTS (SELECT 1 FROM issues i "
        "WHERE i.id = issue_id AND app_can_write_issues(i.project_id)))"
    )
    op.execute(
        "CREATE POLICY comments_update ON comments FOR UPDATE TO app_rw "
        f"USING ({scoped}EXISTS (SELECT 1 FROM issues i WHERE i.id = issue_id AND "
        "(app_can_manage_project(i.project_id) OR (author_id = app_current_user() "
        "AND app_can_write_issues(i.project_id))))) "
        "WITH CHECK (org_id = app_current_org())"
    )


def _grants() -> None:
    for table in TABLES:
        op.execute(f"REVOKE ALL ON {table} FROM PUBLIC, app_rw, app_worker")
        op.execute(f"GRANT SELECT, INSERT ON {table} TO app_rw")
    op.execute("GRANT UPDATE (body, edited_at, updated_at, deleted_at) ON comments TO app_rw")


def upgrade() -> None:
    _tables()
    _policies()
    _grants()


def downgrade() -> None:
    op.execute("REVOKE UPDATE (body, edited_at, updated_at, deleted_at) ON comments FROM app_rw")
    for table in reversed(TABLES):
        op.drop_table(table)  # policies, indexes and constraints go with the table
