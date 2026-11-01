from sqlalchemy.exc import IntegrityError

from app.modules.projects.workflow_integrity import (
    WORKFLOW_STATUS_NAME_UNIQUE,
    conflicting_status_name,
    is_workflow_status_name_conflict,
)


class _Orig:
    def __init__(self, *, constraint_name: str | None = None, detail: str = "") -> None:
        self.constraint_name = constraint_name
        self.detail = detail

    def __str__(self) -> str:
        return self.detail or self.constraint_name or ""


def test_detects_status_name_unique_constraint() -> None:
    error = IntegrityError("", {}, _Orig(constraint_name=WORKFLOW_STATUS_NAME_UNIQUE))
    assert is_workflow_status_name_conflict(error)


def test_ignores_unrelated_integrity_errors() -> None:
    error = IntegrityError(
        "",
        {},
        _Orig(
            constraint_name="fk_workflow_transitions_org_id_workflow_statuses",
            detail="insert violates foreign key",
        ),
    )
    assert not is_workflow_status_name_conflict(error)


def test_extracts_duplicate_name_from_detail() -> None:
    error = IntegrityError(
        "",
        {},
        _Orig(
            detail='Key (workflow_id, name)=(x, QA) already exists.',
        ),
    )
    assert conflicting_status_name(error, "fallback") == "QA"
