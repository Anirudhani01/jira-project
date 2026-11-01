"""Map workflow graph IntegrityError values to API errors (A4b.2)."""

from __future__ import annotations

import re

from sqlalchemy.exc import IntegrityError

WORKFLOW_STATUS_NAME_UNIQUE = "uq_workflow_statuses_workflow_id_name"
_DUPLICATE_NAME = re.compile(
    r"Key \(workflow_id, name\)=\([^,]+,\s*(?P<name>[^)]+)\)\s+already exists",
    re.IGNORECASE,
)


def is_workflow_status_name_conflict(error: IntegrityError) -> bool:
    orig = error.orig
    if orig is None:
        return False
    constraint = getattr(orig, "constraint_name", None)
    if constraint == WORKFLOW_STATUS_NAME_UNIQUE:
        return True
    message = str(orig)
    return WORKFLOW_STATUS_NAME_UNIQUE in message


def conflicting_status_name(error: IntegrityError, fallback: str) -> str:
    orig = error.orig
    if orig is not None:
        detail = getattr(orig, "detail", None) or str(orig)
        match = _DUPLICATE_NAME.search(detail)
        if match:
            return match.group("name")
    return fallback
