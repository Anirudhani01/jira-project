"""Default workflow and board, cloned into every new project (plan §2.3, FR-CFG)."""

from typing import Final

# (name, category). The first status is the initial one; any status can move to any other.
STATUSES: Final = (
    ("To Do", "todo"),
    ("In Progress", "in_progress"),
    ("In Review", "in_progress"),
    ("Done", "done"),
)
WORKFLOW_NAME: Final = "Default workflow"
