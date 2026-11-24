#!/usr/bin/env python3
"""Split the backend integration test files into balanced shards for parallel CI jobs.

Usage:  shard_tests.py <index>/<total>     e.g. shard_tests.py 2/3
Prints the test files of that shard (1-based), relative to ``backend/``, separated by spaces,
ready for ``pytest``. Files are packed greedily, heaviest first, into the currently lightest
shard, so the result is deterministic and needs no test collection or database.

Weights are seconds per file from a timing run (``shard_weights.json``). A file without a
weight (a new test file) gets the average weight, so new files are still placed sensibly.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TEST_ROOT = REPO / "backend" / "tests" / "integration"
WEIGHTS_FILE = Path(__file__).resolve().parent / "shard_weights.json"


def discover(root: Path = TEST_ROOT) -> list[str]:
    """Integration test files, relative to ``backend/``, in a stable order."""
    base = root.parents[1]
    return sorted(str(path.relative_to(base)) for path in root.rglob("test_*.py"))


def load_weights(path: Path = WEIGHTS_FILE) -> dict[str, float]:
    if not path.exists():
        return {}
    return {k: float(v) for k, v in json.loads(path.read_text()).items()}


def plan(files: list[str], weights: dict[str, float], total: int) -> list[list[str]]:
    """Greedy longest-processing-time packing into ``total`` shards."""
    if total < 1:
        raise ValueError("total must be at least 1")
    known = [weights[f] for f in files if f in weights]
    default = sum(known) / len(known) if known else 1.0
    ordered = sorted(files, key=lambda f: (-weights.get(f, default), f))
    shards: list[list[str]] = [[] for _ in range(total)]
    loads = [0.0] * total
    for name in ordered:
        lightest = min(range(total), key=lambda i: (loads[i], i))
        shards[lightest].append(name)
        loads[lightest] += weights.get(name, default)
    return [sorted(shard) for shard in shards]


def parse_spec(spec: str) -> tuple[int, int]:
    try:
        index_text, total_text = spec.split("/")
        index, total = int(index_text), int(total_text)
    except ValueError as error:
        raise ValueError(f"expected <index>/<total>, got {spec!r}") from error
    if total < 1 or not 1 <= index <= total:
        raise ValueError(f"shard {spec!r} is out of range")
    return index, total


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: shard_tests.py <index>/<total>")
    try:
        index, total = parse_spec(sys.argv[1])
    except ValueError as error:
        sys.exit(str(error))
    shards = plan(discover(), load_weights(), total)
    print(" ".join(shards[index - 1]))


if __name__ == "__main__":
    main()
