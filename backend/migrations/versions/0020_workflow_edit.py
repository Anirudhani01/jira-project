"""Workflow graph edit foundation (A4b.1).

M5 granted ``SELECT, INSERT`` on workflow graph tables. A4b editing updates statuses,
transitions, and workflow metadata in place, so ``app_rw`` additionally receives narrowly
scoped ``UPDATE``/``DELETE`` on ``workflow_statuses`` and ``workflow_transitions``, and
``UPDATE (name, initial_status_id, revision)`` on ``workflows``. Whole-row ``DELETE`` on
``workflows`` is intentionally omitted — projects own workflows 1:1 and A4b does not delete
workflows. Every new policy reuses ``app_can_edit_workflow`` (M5/0006: org owner/admin or
project admin for the attached project). Adds ``workflows.revision`` for optimistic
concurrency (increment logic deferred to A4b.2).

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCOPED_GRAPH = "org_id = app_current_org() AND app_can_edit_workflow(workflow_id)"
SCOPED_WORKFLOW = "org_id = app_current_org() AND app_can_edit_workflow(id)"


def upgrade() -> None:
    op.add_column(
        "workflows",
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_check_constraint("workflows_revision_positive", "workflows", "revision >= 1")

    op.execute("GRANT UPDATE (name, initial_status_id, revision) ON workflows TO app_rw")
    op.execute("GRANT UPDATE (name, category, position), DELETE ON workflow_statuses TO app_rw")
    op.execute(
        "GRANT UPDATE (name, from_status_id, to_status_id), DELETE ON workflow_transitions "
        "TO app_rw"
    )

    op.execute(
        "CREATE POLICY workflows_update ON workflows FOR UPDATE TO app_rw "
        f"USING ({SCOPED_WORKFLOW}) WITH CHECK (org_id = app_current_org())"
    )
    op.execute(
        f"CREATE POLICY workflow_statuses_update ON workflow_statuses FOR UPDATE TO app_rw "
        f"USING ({SCOPED_GRAPH}) WITH CHECK (org_id = app_current_org())"
    )
    op.execute(
        f"CREATE POLICY workflow_statuses_delete ON workflow_statuses FOR DELETE TO app_rw "
        f"USING ({SCOPED_GRAPH})"
    )
    op.execute(
        f"CREATE POLICY workflow_transitions_update ON workflow_transitions FOR UPDATE TO app_rw "
        f"USING ({SCOPED_GRAPH}) WITH CHECK (org_id = app_current_org())"
    )
    op.execute(
        f"CREATE POLICY workflow_transitions_delete ON workflow_transitions FOR DELETE TO app_rw "
        f"USING ({SCOPED_GRAPH})"
    )


def downgrade() -> None:
    op.execute("DROP POLICY workflow_transitions_delete ON workflow_transitions")
    op.execute("DROP POLICY workflow_transitions_update ON workflow_transitions")
    op.execute("DROP POLICY workflow_statuses_delete ON workflow_statuses")
    op.execute("DROP POLICY workflow_statuses_update ON workflow_statuses")
    op.execute("DROP POLICY workflows_update ON workflows")

    op.execute("REVOKE UPDATE (name, from_status_id, to_status_id), DELETE ON workflow_transitions FROM app_rw")
    op.execute("REVOKE UPDATE (name, category, position), DELETE ON workflow_statuses FROM app_rw")
    op.execute("REVOKE UPDATE (name, initial_status_id, revision) ON workflows FROM app_rw")

    op.drop_constraint("workflows_revision_positive", "workflows", type_="check")
    op.drop_column("workflows", "revision")
