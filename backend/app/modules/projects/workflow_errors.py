"""Workflow editing HTTP errors (A4b.2)."""

from app.core.errors import AppError


def workflow_revision_conflict() -> AppError:
    return AppError(
        412,
        "workflow_revision_conflict",
        "The workflow was changed by someone else. Reload and retry.",
    )


def precondition_required() -> AppError:
    return AppError(
        428,
        "precondition_required",
        'Send If-Match with the workflow ETag ("w<revision>").',
    )


def status_in_use(message: str = "Provide status_remaps for statuses that still have issues.") -> AppError:
    return AppError(422, "status_in_use", message)


def status_name_taken(name: str) -> AppError:
    return AppError(
        422,
        "status_name_taken",
        f'A status named "{name}" already exists in this workflow.',
        errors=[{"field": "body.statuses", "message": "name already taken"}],
    )


def invalid_workflow(message: str, field: str = "body") -> AppError:
    return AppError(
        422,
        "invalid_workflow",
        message,
        errors=[{"field": field, "message": message}],
    )
