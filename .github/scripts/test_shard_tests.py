#!/usr/bin/env python3
"""Tests for shard_tests (run: make test-ci-scripts)."""

import unittest

from shard_tests import discover, load_weights, parse_spec, plan

FILES = [f"tests/integration/test_{n}.py" for n in "abcdefghij"]
WEIGHTS = {f: w for f, w in zip(FILES, [50, 40, 30, 20, 10, 9, 8, 7, 6, 5], strict=True)}


class PlanTests(unittest.TestCase):
    def test_every_file_lands_in_exactly_one_shard(self) -> None:
        shards = plan(FILES, WEIGHTS, 3)
        flat = [f for shard in shards for f in shard]
        self.assertEqual(sorted(flat), sorted(FILES))
        self.assertEqual(len(flat), len(set(flat)))

    def test_is_deterministic(self) -> None:
        self.assertEqual(plan(FILES, WEIGHTS, 3), plan(list(reversed(FILES)), WEIGHTS, 3))

    def test_is_balanced(self) -> None:
        shards = plan(FILES, WEIGHTS, 3)
        loads = [sum(WEIGHTS[f] for f in shard) for shard in shards]
        self.assertLessEqual(max(loads) - min(loads), max(WEIGHTS.values()))

    def test_one_shard_holds_everything(self) -> None:
        self.assertEqual(plan(FILES, WEIGHTS, 1), [sorted(FILES)])

    def test_unweighted_files_get_the_average_and_are_still_placed(self) -> None:
        extra = FILES + ["tests/integration/test_new.py"]
        flat = [f for shard in plan(extra, WEIGHTS, 3) for f in shard]
        self.assertIn("tests/integration/test_new.py", flat)
        self.assertEqual(len(flat), len(extra))

    def test_no_weights_at_all_still_splits_evenly_by_count(self) -> None:
        sizes = sorted(len(s) for s in plan(FILES, {}, 3))
        self.assertEqual(sizes, [3, 3, 4])

    def test_rejects_zero_shards(self) -> None:
        with self.assertRaises(ValueError):
            plan(FILES, WEIGHTS, 0)


class SpecTests(unittest.TestCase):
    def test_parses_index_and_total(self) -> None:
        self.assertEqual(parse_spec("2/3"), (2, 3))

    def test_rejects_bad_specs(self) -> None:
        for spec in ("0/3", "4/3", "1/0", "x", "1-3", "1/3/5", ""):
            with self.subTest(spec=spec), self.assertRaises(ValueError):
                parse_spec(spec)


class RepositoryTests(unittest.TestCase):
    """The real test tree: nothing is dropped or duplicated for the shard count CI uses."""

    def test_the_real_tree_is_fully_covered_for_three_shards(self) -> None:
        files = discover()
        self.assertGreater(len(files), 20)
        shards = plan(files, load_weights(), 3)
        flat = [f for shard in shards for f in shard]
        self.assertEqual(sorted(flat), files)
        self.assertEqual(len(flat), len(set(flat)))
        self.assertTrue(all(shards), "no shard may be empty")

    def test_weights_only_name_files_that_exist(self) -> None:
        stale = sorted(set(load_weights()) - set(discover()))
        self.assertEqual(stale, [], "shard_weights.json lists files that no longer exist")


if __name__ == "__main__":
    unittest.main()
