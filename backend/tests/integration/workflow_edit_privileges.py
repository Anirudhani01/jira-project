"""Catalog snapshots for A4b.1 workflow graph privileges (``app_rw``)."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

ROLE = "app_rw"

# Privileges introduced by migration 0020 (must be absent at revision 0019 and after downgrade).
ACL_0020_CHECKS: tuple[tuple[str, str], ...] = (
    ("workflows_col_update_name", f"has_column_privilege('{ROLE}', 'workflows', 'name', 'UPDATE')"),
    (
        "workflows_col_update_initial_status_id",
        f"has_column_privilege('{ROLE}', 'workflows', 'initial_status_id', 'UPDATE')",
    ),
    (
        "workflows_col_update_revision",
        f"has_column_privilege('{ROLE}', 'workflows', 'revision', 'UPDATE')",
    ),
    (
        "workflow_statuses_table_delete",
        f"has_table_privilege('{ROLE}', 'workflow_statuses', 'DELETE')",
    ),
    (
        "workflow_statuses_col_update_name",
        f"has_column_privilege('{ROLE}', 'workflow_statuses', 'name', 'UPDATE')",
    ),
    (
        "workflow_statuses_col_update_category",
        f"has_column_privilege('{ROLE}', 'workflow_statuses', 'category', 'UPDATE')",
    ),
    (
        "workflow_statuses_col_update_position",
        f"has_column_privilege('{ROLE}', 'workflow_statuses', 'position', 'UPDATE')",
    ),
    (
        "workflow_transitions_table_delete",
        f"has_table_privilege('{ROLE}', 'workflow_transitions', 'DELETE')",
    ),
    (
        "workflow_transitions_col_update_name",
        f"has_column_privilege('{ROLE}', 'workflow_transitions', 'name', 'UPDATE')",
    ),
    (
        "workflow_transitions_col_update_from_status_id",
        f"has_column_privilege('{ROLE}', 'workflow_transitions', 'from_status_id', 'UPDATE')",
    ),
    (
        "workflow_transitions_col_update_to_status_id",
        f"has_column_privilege('{ROLE}', 'workflow_transitions', 'to_status_id', 'UPDATE')",
    ),
)

# M5 baseline: retained across 0020 downgrade (must stay true).
M5_INSERT_CHECKS: tuple[tuple[str, str], ...] = (
    ("workflows_insert", f"has_table_privilege('{ROLE}', 'workflows', 'INSERT')"),
    (
        "workflow_statuses_insert",
        f"has_table_privilege('{ROLE}', 'workflow_statuses', 'INSERT')",
    ),
    (
        "workflow_transitions_insert",
        f"has_table_privilege('{ROLE}', 'workflow_transitions', 'INSERT')",
    ),
    ("workflows_select", f"has_table_privilege('{ROLE}', 'workflows', 'SELECT')"),
    (
        "workflow_statuses_select",
        f"has_table_privilege('{ROLE}', 'workflow_statuses', 'SELECT')",
    ),
    (
        "workflow_transitions_select",
        f"has_table_privilege('{ROLE}', 'workflow_transitions', 'SELECT')",
    ),
)

NEVER_GRANTED_CHECKS: tuple[tuple[str, str], ...] = (
    ("workflows_table_delete", f"has_table_privilege('{ROLE}', 'workflows', 'DELETE')"),
)

WORKFLOW_EDIT_POLICY_NAMES = (
    "workflows_update",
    "workflow_statuses_update",
    "workflow_statuses_delete",
    "workflow_transitions_update",
    "workflow_transitions_delete",
)

REVISION_COLUMN_EXISTS = text(
    """
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'workflows' AND column_name = 'revision'
    )
    """
)

WORKFLOW_EDIT_POLICIES_SQL = text(
    """
    SELECT pol.polname
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('workflows', 'workflow_statuses', 'workflow_transitions')
      AND pol.polname = ANY(:names)
    ORDER BY pol.polname
    """
)


@dataclass(frozen=True, slots=True)
class WorkflowGraphAclSnapshot:
    flags: dict[str, bool]
    edit_policies: tuple[str, ...]

    def flags_subset(self, keys: tuple[tuple[str, str], ...]) -> dict[str, bool]:
        return {name: self.flags[name] for name, _ in keys}

    def all_true(self, keys: tuple[tuple[str, str], ...]) -> bool:
        return all(self.flags[name] for name, _ in keys)

    def all_false(self, keys: tuple[tuple[str, str], ...]) -> bool:
        return all(not self.flags[name] for name, _ in keys)


async def snapshot_workflow_graph_acl(engine: AsyncEngine) -> WorkflowGraphAclSnapshot:
    checks = (
        *M5_INSERT_CHECKS,
        *ACL_0020_CHECKS,
        *NEVER_GRANTED_CHECKS,
    )
    flags: dict[str, bool] = {}
    async with engine.connect() as conn:
        revision_column = bool((await conn.execute(REVISION_COLUMN_EXISTS)).scalar_one())
        for name, expr in checks:
            if name == "workflows_col_update_revision" and not revision_column:
                flags[name] = False
                continue
            flags[name] = bool((await conn.execute(text(f"SELECT {expr}"))).scalar_one())
        policy_rows = (
            await conn.execute(
                WORKFLOW_EDIT_POLICIES_SQL,
                {"names": list(WORKFLOW_EDIT_POLICY_NAMES)},
            )
        ).scalars().all()
    return WorkflowGraphAclSnapshot(flags=flags, edit_policies=tuple(policy_rows))


def assert_0019_baseline(snapshot: WorkflowGraphAclSnapshot) -> None:
    assert snapshot.all_true(M5_INSERT_CHECKS)
    assert snapshot.all_false(ACL_0020_CHECKS)
    assert snapshot.all_false(NEVER_GRANTED_CHECKS)
    assert snapshot.edit_policies == ()


def assert_0020_grants(snapshot: WorkflowGraphAclSnapshot) -> None:
    assert snapshot.all_true(M5_INSERT_CHECKS)
    assert snapshot.all_true(ACL_0020_CHECKS)
    assert snapshot.all_false(NEVER_GRANTED_CHECKS)
    assert set(snapshot.edit_policies) == set(WORKFLOW_EDIT_POLICY_NAMES)


def assert_snapshots_equal(a: WorkflowGraphAclSnapshot, b: WorkflowGraphAclSnapshot) -> None:
    assert a.flags == b.flags
    assert set(a.edit_policies) == set(b.edit_policies)
