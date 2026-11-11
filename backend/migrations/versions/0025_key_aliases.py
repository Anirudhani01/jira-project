"""Project key aliases and issue key aliases (project key rename, issue relocation).

``project_key_aliases`` keeps every key a project has had, so old URLs keep resolving and a
retired key can never be reused by another project. ``issue_key_aliases`` does the same for
an issue moved to another project (its old ``KEY-n``).

``projects.key`` and ``issues.project_id/workflow_id/seq`` stay immutable for ad-hoc
``UPDATE`` by the runtime role (no column grant, as before). The only way to change them is
through two narrow SECURITY DEFINER functions that authorize the caller themselves:

- ``app_rename_project_key(project, key)``: org owner/admin only;
- ``app_relocate_issue(...)``: write access to both the source and the target project, same
  organization, optimistic ``version`` check, and clears the project-scoped fields.

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)
DEFINER = "SECURITY DEFINER SET search_path = public, pg_temp"
MANAGERS = "ARRAY['owner', 'admin']"
KEY_PATTERN = "^[A-Z][A-Z0-9]{1,9}$"
TABLES = ("project_key_aliases", "issue_key_aliases")


def _fk(name: str, cols: list[str], table: str, refcols: list[str], ondelete: str | None = None):
    return sa.ForeignKeyConstraint(
        cols, [f"{table}.{c}" for c in refcols], name=name, ondelete=ondelete
    )


def _tables() -> None:
    op.create_table(
        "project_key_aliases",
        sa.Column("org_id", UUID, nullable=False),
        sa.Column("key", sa.String(10), nullable=False),
        sa.Column("project_id", UUID, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(f"key ~ '{KEY_PATTERN}'", name="ck_project_key_aliases_key_format"),
        _fk(
            "fk_project_key_aliases_org_id_projects",
            ["org_id", "project_id"],
            "projects",
            ["org_id", "id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("org_id", "key", name="pk_project_key_aliases"),
        implicit_returning=False,
    )
    op.create_index("ix_project_key_aliases_project_id", "project_key_aliases", ["project_id"])
    op.create_table(
        "issue_key_aliases",
        sa.Column("org_id", UUID, nullable=False),
        sa.Column("project_key", sa.String(10), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("issue_id", UUID, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            f"project_key ~ '{KEY_PATTERN}'", name="ck_issue_key_aliases_project_key_format"
        ),
        sa.CheckConstraint("seq > 0", name="ck_issue_key_aliases_seq_positive"),
        _fk(
            "fk_issue_key_aliases_org_id_issues",
            ["org_id", "issue_id"],
            "issues",
            ["org_id", "id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("org_id", "project_key", "seq", name="pk_issue_key_aliases"),
        implicit_returning=False,
    )
    op.create_index("ix_issue_key_aliases_issue_id", "issue_key_aliases", ["issue_id"])


def _policies() -> None:
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    scoped = "org_id = app_current_org() AND "
    # Visibility is decided by the project / issue the alias resolves to (checked in the
    # service, as for every project route); the alias row itself carries no secret.
    op.execute(
        "CREATE POLICY project_key_aliases_select ON project_key_aliases FOR SELECT TO app_rw "
        "USING (org_id = app_current_org())"
    )
    op.execute(
        "CREATE POLICY project_key_aliases_insert ON project_key_aliases FOR INSERT TO app_rw "
        f"WITH CHECK ({scoped}app_can_manage_project(project_id))"
    )
    op.execute(
        "CREATE POLICY issue_key_aliases_select ON issue_key_aliases FOR SELECT TO app_rw "
        "USING (org_id = app_current_org())"
    )
    op.execute(
        "CREATE POLICY issue_key_aliases_insert ON issue_key_aliases FOR INSERT TO app_rw "
        f"WITH CHECK ({scoped}EXISTS (SELECT 1 FROM issues i "
        "WHERE i.id = issue_id AND app_can_write_issues(i.project_id)))"
    )


def _functions() -> None:
    # Definer-run DML is still subject to FORCE ROW LEVEL SECURITY as the table owner, so the
    # owner needs an UPDATE policy; it is only reachable through the functions below, which
    # carry the authorization checks (app_rw cannot use a policy that targets app_owner).
    op.execute("CREATE POLICY projects_key_rename ON projects FOR UPDATE TO app_owner USING (true)")
    op.execute("CREATE POLICY issues_relocate_read ON issues FOR SELECT TO app_owner USING (true)")
    op.execute("CREATE POLICY issues_relocate ON issues FOR UPDATE TO app_owner USING (true)")
    op.execute(
        f"""
        CREATE FUNCTION app_rename_project_key(p_project uuid, p_key text) RETURNS boolean
        LANGUAGE plpgsql {DEFINER} AS $$
        DECLARE v_org uuid;
        BEGIN
          SELECT org_id INTO v_org FROM projects
           WHERE id = p_project AND org_id = app_current_org();
          IF v_org IS NULL OR NOT app_has_org_role(v_org, {MANAGERS}) THEN
            RETURN false;
          END IF;
          UPDATE projects SET key = p_key, updated_at = now()
           WHERE id = p_project AND org_id = v_org;
          RETURN FOUND;
        END
        $$
        """
    )
    op.execute(
        f"""
        CREATE FUNCTION app_relocate_issue(
          p_issue uuid, p_version integer, p_project uuid, p_workflow uuid, p_seq integer,
          p_status uuid, p_rank text, p_done_at timestamptz
        ) RETURNS integer LANGUAGE plpgsql {DEFINER} AS $$
        DECLARE v_old uuid; v_version integer;
        BEGIN
          SELECT project_id INTO v_old FROM issues
           WHERE id = p_issue AND org_id = app_current_org() AND deleted_at IS NULL;
          IF v_old IS NULL OR v_old = p_project
             OR NOT app_can_write_issues(v_old) OR NOT app_can_write_issues(p_project)
             OR NOT EXISTS (SELECT 1 FROM projects
                             WHERE id = p_project AND org_id = app_current_org()
                               AND workflow_id = p_workflow) THEN
            RETURN NULL;
          END IF;
          UPDATE issues SET project_id = p_project, workflow_id = p_workflow, seq = p_seq,
                 status_id = p_status, rank = p_rank, sprint_id = NULL, fix_version_id = NULL,
                 parent_id = NULL, done_at = p_done_at, version = version + 1,
                 updated_at = now()
           WHERE id = p_issue AND org_id = app_current_org() AND version = p_version
             AND deleted_at IS NULL
          RETURNING version INTO v_version;
          RETURN v_version;
        END
        $$
        """
    )
    for signature in (
        "app_rename_project_key(uuid, text)",
        "app_relocate_issue(uuid, integer, uuid, uuid, integer, uuid, text, timestamptz)",
    ):
        op.execute(f"REVOKE ALL ON FUNCTION {signature} FROM PUBLIC")
        op.execute(f"GRANT EXECUTE ON FUNCTION {signature} TO app_rw")


def _grants() -> None:
    for table in TABLES:
        op.execute(f"REVOKE ALL ON {table} FROM PUBLIC, app_rw, app_worker")
        op.execute(f"GRANT SELECT, INSERT ON {table} TO app_rw")


def upgrade() -> None:
    _tables()
    _policies()
    _grants()
    _functions()


def downgrade() -> None:
    op.execute(
        "DROP FUNCTION app_relocate_issue(uuid, integer, uuid, uuid, integer, uuid, text, "
        "timestamptz)"
    )
    op.execute("DROP FUNCTION app_rename_project_key(uuid, text)")
    op.execute("DROP POLICY issues_relocate ON issues")
    op.execute("DROP POLICY issues_relocate_read ON issues")
    op.execute("DROP POLICY projects_key_rename ON projects")
    for table in reversed(TABLES):
        op.drop_table(table)  # policies, indexes and constraints go with the tables
