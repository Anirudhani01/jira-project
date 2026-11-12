"""Status choice when an issue moves to another project's workflow."""

import uuid
from dataclasses import dataclass

import pytest

from app.core.errors import AppError
from app.modules.issues.relocate import map_status


@dataclass
class Status:
    name: str
    category: str
    position: int
    id: uuid.UUID

    @classmethod
    def make(cls, name: str, category: str, position: int) -> "Status":
        return cls(name, category, position, uuid.uuid4())


TARGETS = [
    Status.make("Backlog", "todo", 0),
    Status.make("Doing", "in_progress", 1),
    Status.make("Shipped", "done", 2),
]
INITIAL = TARGETS[0].id


def test_same_name_wins_case_insensitively() -> None:
    source = Status.make("SHIPPED", "in_progress", 0)
    assert map_status(source, TARGETS, INITIAL, None) == TARGETS[2].id


def test_falls_back_to_the_first_status_of_the_same_category() -> None:
    source = Status.make("In Review", "in_progress", 2)
    assert map_status(source, TARGETS, INITIAL, None) == TARGETS[1].id


def test_falls_back_to_the_initial_status_without_a_category_match() -> None:
    targets = [Status.make("Open", "todo", 0)]
    source = Status.make("Done", "done", 3)
    assert map_status(source, targets, targets[0].id, None) == targets[0].id


def test_requested_status_overrides_the_mapping() -> None:
    source = Status.make("Backlog", "todo", 0)
    assert map_status(source, TARGETS, INITIAL, TARGETS[2].id) == TARGETS[2].id


def test_requested_status_must_belong_to_the_target() -> None:
    with pytest.raises(AppError) as error:
        map_status(Status.make("x", "todo", 0), TARGETS, INITIAL, uuid.uuid4())
    assert error.value.code == "invalid_status"
