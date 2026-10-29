"""Fractional ranks (plan §3, M9): base-62 strings over ``0-9A-Za-z`` (ASCII order, which
matches ``COLLATE "C"``). ``between`` is a pure function; ranks are read as fractions
``0.d1d2d3...`` so there is always room between two distinct ranks."""

ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
BASE = len(ALPHABET)
_INDEX = {char: index for index, char in enumerate(ALPHABET)}
REBALANCE_LENGTH = 64
_WIDTH = 6


def is_valid(rank: str) -> bool:
    return bool(rank) and all(char in _INDEX for char in rank) and not rank.endswith("0")


def between(before: str | None, after: str | None) -> str:
    """A rank strictly between ``before`` and ``after`` (``None`` = no bound). Never ends
    in ``0``, so a lower neighbour always exists."""
    if before is not None and after is not None and before >= after:
        raise ValueError("before must sort strictly below after")
    low = before or ""
    high = after
    result: list[str] = []
    position = 0
    while True:
        low_digit = _INDEX[low[position]] if position < len(low) else 0
        high_digit = _INDEX[high[position]] if high is not None and position < len(high) else BASE
        if high_digit - low_digit > 1:
            result.append(ALPHABET[(low_digit + high_digit) // 2])
            return "".join(result)
        result.append(ALPHABET[low_digit])
        if high_digit > low_digit:
            high = None  # already below `after`: only `before` constrains from here on
        position += 1


def needs_rebalance(rank: str) -> bool:
    return len(rank) > REBALANCE_LENGTH


def spread(count: int) -> list[str]:
    """``count`` evenly spaced, strictly increasing ranks (used to rebalance a scope)."""
    if count < 0:
        raise ValueError("count must not be negative")
    if count == 0:
        return []
    step = BASE**_WIDTH // (count + 1)
    if step < 1:
        raise ValueError("too many ranks to spread")
    ranks = []
    for number in range(1, count + 1):
        value, digits = number * step, []
        for _ in range(_WIDTH):
            value, remainder = divmod(value, BASE)
            digits.append(ALPHABET[remainder])
        ranks.append("".join(reversed(digits)).rstrip("0") or ALPHABET[1])
    return ranks
