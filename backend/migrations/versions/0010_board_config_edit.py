"""Board column configuration edits (M9).

M5 seeded boards with ``SELECT, INSERT`` only. ``PUT .../board/columns`` replaces the
column list, so ``app_rw`` additionally gets ``UPDATE (name, position, wip_limit)`` and
``DELETE`` on ``board_columns`` and ``DELETE`` on ``board_column_statuses`` (mappings are
rewritten wholesale). Every new policy reuses ``app_can_edit_board`` (M5/0006: org
owner/admin or project admin), the same helper the insert policies use, so the database
enforces ``board.manage`` independently of the service layer. Nothing else changes: the
issue ``rank`` column already exists (M6) and moves reuse the M7 status/rank grants.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-30
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCOPED = "org_id = app_current_org() AND app_can_edit_board(board_id)"


def upgrade() -> None:
    op.execute("GRANT UPDATE (name, position, wip_limit), DELETE ON board_columns TO app_rw")
    op.execute("GRANT DELETE ON board_column_statuses TO app_rw")
    op.execute(
        "CREATE POLICY board_columns_update ON board_columns FOR UPDATE TO app_rw "
        f"USING ({SCOPED}) WITH CHECK (org_id = app_current_org())"
    )
    op.execute(
        f"CREATE POLICY board_columns_delete ON board_columns FOR DELETE TO app_rw USING ({SCOPED})"
    )
    op.execute(
        "CREATE POLICY board_column_statuses_delete ON board_column_statuses "
        f"FOR DELETE TO app_rw USING ({SCOPED})"
    )


def downgrade() -> None:
    op.execute("DROP POLICY board_column_statuses_delete ON board_column_statuses")
    op.execute("DROP POLICY board_columns_delete ON board_columns")
    op.execute("DROP POLICY board_columns_update ON board_columns")
    op.execute("REVOKE DELETE ON board_column_statuses FROM app_rw")
    op.execute("REVOKE UPDATE (name, position, wip_limit), DELETE ON board_columns FROM app_rw")
