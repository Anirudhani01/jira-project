# ADR 0005 — Data-driven workflow configuration

- Status: Accepted (decision A5) — implemented from M5
- Plan reference: §2.3, R3.3 rows 4–10, 19–20

## Decision
Workflows, statuses, transitions, issue types and priorities are stored as data. A default
workflow defined in code is **cloned per project** at creation; issue types and priorities
are seeded per organization. The MVP has a read-only workflow view and editable board
columns; custom fields and a workflow editor are later features.

Issues carry `workflow_id`, and composite FKs `(workflow_id, status_id)` are designed to
ensure in the database that an issue's status belongs to its project's workflow (to be
verified by tests in M5–M7; nothing is implemented yet).

## Consequences
Adding workflow editing later is additive. Changing a project's workflow later will need a
status-mapping migration (as in Jira).
