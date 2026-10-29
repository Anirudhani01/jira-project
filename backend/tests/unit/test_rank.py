import random

import pytest

from app.modules.issues import rank


def test_between_unbounded_and_one_sided() -> None:
    first = rank.between(None, None)
    assert rank.is_valid(first)
    assert rank.between(first, None) > first
    assert rank.between(None, first) < first


def test_between_rejects_inverted_or_equal_bounds() -> None:
    with pytest.raises(ValueError, match="strictly below"):
        rank.between("b", "a")
    with pytest.raises(ValueError, match="strictly below"):
        rank.between("a", "a")


def test_between_adjacent_digits_extends() -> None:
    middle = rank.between("1", "2")
    assert "1" < middle < "2"


def test_between_handles_existing_padded_ranks() -> None:
    middle = rank.between("000001", "000002")
    assert "000001" < middle < "000002"
    assert rank.is_valid(middle)


@pytest.mark.parametrize("seed", range(20))
def test_random_insertions_stay_strictly_ordered(seed: int) -> None:
    generator = random.Random(seed)  # noqa: S311
    ranks = [rank.between(None, None)]
    for _ in range(300):
        slot = generator.randint(0, len(ranks))
        before = ranks[slot - 1] if slot > 0 else None
        after = ranks[slot] if slot < len(ranks) else None
        new = rank.between(before, after)
        assert rank.is_valid(new)
        ranks.insert(slot, new)
    assert ranks == sorted(set(ranks))


def test_repeated_insertion_at_an_end_grows_slowly_until_rebalance() -> None:
    head = tail = rank.between(None, None)
    for _ in range(100):
        head = rank.between(None, head)
        tail = rank.between(tail, None)
    assert max(len(head), len(tail)) < rank.REBALANCE_LENGTH
    for _ in range(400):
        head = rank.between(None, head)
    assert rank.needs_rebalance(head)


def test_spread_is_increasing_and_valid() -> None:
    for count in (0, 1, 2, 17, 500):
        ranks = rank.spread(count)
        assert len(ranks) == count
        assert ranks == sorted(set(ranks))
        assert all(rank.is_valid(item) for item in ranks)


def test_needs_rebalance_threshold() -> None:
    assert not rank.needs_rebalance("a" * 64)
    assert rank.needs_rebalance("a" * 65)
