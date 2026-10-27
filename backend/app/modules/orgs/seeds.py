"""Default per-org configuration, cloned into every new organization (plan §FR-CFG)."""

from typing import Final

ISSUE_TYPES: Final = (
    ("Epic", "epic"),
    ("Story", "standard"),
    ("Task", "standard"),
    ("Bug", "standard"),
    ("Sub-task", "subtask"),
)
PRIORITIES: Final = (
    ("Highest", "#b91c1c"),
    ("High", "#ea580c"),
    ("Medium", "#ca8a04"),
    ("Low", "#2563eb"),
    ("Lowest", "#64748b"),
)
