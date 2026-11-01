"""Workflow graph validation and diff helpers (A4b.2)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, cast

from app.modules.projects.schemas import (
    ReplaceWorkflowRequest,
    StatusInput,
    TransitionInput,
)
from app.modules.projects.workflow_errors import (
    invalid_workflow,
    status_in_use,
    status_name_taken,
)


@dataclass(frozen=True, slots=True)
class StatusSpec:
    id: uuid.UUID
    name: str
    category: str
    position: int


@dataclass(frozen=True, slots=True)
class TransitionSpec:
    id: uuid.UUID
    name: str
    from_status_id: uuid.UUID | None
    to_status_id: uuid.UUID


@dataclass
class WorkflowGraphState:
    name: str
    initial_status_id: uuid.UUID
    revision: int
    statuses: dict[uuid.UUID, StatusSpec]
    transitions: dict[uuid.UUID, TransitionSpec]


def _assign_status_ids(statuses: list[StatusInput]) -> list[StatusSpec]:
    seen_names: set[str] = set()
    specs: list[StatusSpec] = []
    for item in statuses:
        name_key = item.name.casefold()
        if name_key in seen_names:
            raise status_name_taken(item.name)
        seen_names.add(name_key)
        status_id = item.id if item.id is not None else uuid.uuid4()
        specs.append(
            StatusSpec(id=status_id, name=item.name, category=item.category, position=item.position)
        )
    return specs


def _assign_transition_ids(transitions: list[TransitionInput]) -> list[TransitionSpec]:
    specs: list[TransitionSpec] = []
    for item in transitions:
        transition_id = item.id if item.id is not None else uuid.uuid4()
        specs.append(
            TransitionSpec(
                id=transition_id,
                name=item.name,
                from_status_id=item.from_status_id,
                to_status_id=item.to_status_id,
            )
        )
    return specs


def desired_graph(body: ReplaceWorkflowRequest) -> WorkflowGraphState:
    status_specs = _assign_status_ids(body.statuses)
    status_ids = {s.id for s in status_specs}
    if body.initial_status_id not in status_ids:
        raise invalid_workflow(
            "initial_status_id must refer to a status in the payload.",
            "body.initial_status_id",
        )
    transition_specs = _assign_transition_ids(body.transitions)
    for transition in transition_specs:
        if transition.from_status_id is not None and transition.from_status_id not in status_ids:
            raise invalid_workflow(
                "Transition from_status_id is not in statuses.",
                "body.transitions",
            )
        if transition.to_status_id not in status_ids:
            raise invalid_workflow(
                "Transition to_status_id is not in statuses.",
                "body.transitions",
            )
    return WorkflowGraphState(
        name=body.name,
        initial_status_id=body.initial_status_id,
        revision=0,
        statuses={s.id: s for s in status_specs},
        transitions={t.id: t for t in transition_specs},
    )


def removed_status_ids(current: WorkflowGraphState, desired: WorkflowGraphState) -> set[uuid.UUID]:
    return set(current.statuses) - set(desired.statuses)


def validate_remaps(
    removing: set[uuid.UUID],
    desired: WorkflowGraphState,
    issue_counts: dict[uuid.UUID, int],
    remaps: dict[uuid.UUID, uuid.UUID],
) -> None:
    for status_id in removing:
        count = issue_counts.get(status_id, 0)
        if count == 0:
            continue
        target = remaps.get(status_id)
        if target is None:
            raise status_in_use()
        if target == status_id:
            raise invalid_workflow(
                "status_remaps cannot map a status to itself.",
                "body.status_remaps",
            )
        if target not in desired.statuses:
            raise invalid_workflow(
                "Replacement status must remain in the workflow.",
                "body.status_remaps",
            )
    for from_id, _to_id in remaps.items():
        if from_id not in removing:
            raise invalid_workflow(
                "status_remaps entry refers to a status that is not being removed.",
                "body.status_remaps",
            )


def remap_lookup(body: ReplaceWorkflowRequest) -> dict[uuid.UUID, uuid.UUID]:
    return {entry.from_status_id: entry.to_status_id for entry in body.status_remaps}


def canonical_payload(state: WorkflowGraphState, columns: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "name": state.name,
        "initial_status_id": str(state.initial_status_id),
        "statuses": sorted(
            [
                {
                    "id": str(s.id),
                    "name": s.name,
                    "category": s.category,
                    "position": s.position,
                }
                for s in state.statuses.values()
            ],
            key=lambda row: row["position"],
        ),
        "transitions": sorted(
            [
                {
                    "id": str(t.id),
                    "name": t.name,
                    "from": str(t.from_status_id) if t.from_status_id else None,
                    "to": str(t.to_status_id),
                }
                for t in state.transitions.values()
            ],
            key=lambda row: row["id"],
        ),
        "columns": sorted(columns, key=lambda c: c["position"]),
    }


@dataclass
class AuditDiff:
    metadata_fields: list[str] = field(default_factory=list)
    initial_from: uuid.UUID | None = None
    initial_to: uuid.UUID | None = None
    statuses_created: list[tuple[uuid.UUID, str]] = field(default_factory=list)
    statuses_updated: list[tuple[uuid.UUID, list[str]]] = field(default_factory=list)
    statuses_deleted: list[tuple[uuid.UUID, uuid.UUID | None, int]] = field(default_factory=list)
    transitions_created: list[tuple[uuid.UUID, str]] = field(default_factory=list)
    transitions_deleted: list[uuid.UUID] = field(default_factory=list)
    board_mapping_changed: bool = False


def diff_graph(
    current: WorkflowGraphState,
    desired: WorkflowGraphState,
    *,
    remaps: dict[uuid.UUID, uuid.UUID],
    issue_counts: dict[uuid.UUID, int],
    columns_changed: bool,
) -> AuditDiff:
    out = AuditDiff(board_mapping_changed=columns_changed)
    if current.name != desired.name:
        out.metadata_fields.append("name")
    if current.initial_status_id != desired.initial_status_id:
        out.initial_from = current.initial_status_id
        out.initial_to = desired.initial_status_id
    removing = removed_status_ids(current, desired)
    for status_id, status_spec in desired.statuses.items():
        if status_id not in current.statuses:
            out.statuses_created.append((status_id, status_spec.name))
            continue
        old = current.statuses[status_id]
        fields: list[str] = []
        if old.name != status_spec.name:
            fields.append("name")
        if old.category != status_spec.category:
            fields.append("category")
        if old.position != status_spec.position:
            fields.append("position")
        if fields:
            out.statuses_updated.append((status_id, fields))
    for status_id in removing:
        replacement = remaps.get(status_id)
        out.statuses_deleted.append((status_id, replacement, issue_counts.get(status_id, 0)))
    for transition_id, transition_spec in desired.transitions.items():
        if transition_id not in current.transitions:
            out.transitions_created.append((transition_id, transition_spec.name))
    for transition_id in set(current.transitions) - set(desired.transitions):
        out.transitions_deleted.append(transition_id)
    return out


def graph_from_view(view: dict[str, Any], revision: int) -> WorkflowGraphState:
    status_rows = cast(list[Any], view["statuses"])
    transition_rows = cast(list[Any], view["transitions"])
    statuses = {
        s.id: StatusSpec(id=s.id, name=s.name, category=s.category, position=s.position)
        for s in status_rows
    }
    transitions = {
        t.id: TransitionSpec(
            id=t.id, name=t.name, from_status_id=t.from_status_id, to_status_id=t.to_status_id
        )
        for t in transition_rows
    }
    return WorkflowGraphState(
        name=view["name"],
        initial_status_id=view["initial_status_id"],
        revision=revision,
        statuses=statuses,
        transitions=transitions,
    )
