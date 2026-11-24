#!/usr/bin/env python3
"""Tests for ci_gate (run: make test-ci-scripts)."""

import unittest

from ci_gate import evaluate

ALL_OK = {
    "changes": "success",
    "docs-only": "skipped",
    "backend": "success",
    "backend-integration": "success",
    "frontend": "success",
    "contract": "success",
    "secrets": "success",
    "images": "skipped",
    "e2e-workflow-a4b": "success",
}


def results(**overrides: str) -> dict[str, str]:
    return {**ALL_OK, **{k.replace("_", "-"): v for k, v in overrides.items()}}


class GateTests(unittest.TestCase):
    def test_full_scope_all_green_passes(self) -> None:
        self.assertEqual(evaluate(ALL_OK, "full"), [])

    def test_images_may_run_or_be_skipped(self) -> None:
        self.assertEqual(evaluate(results(images="success"), "full"), [])
        self.assertEqual(evaluate(results(images="skipped"), "full"), [])

    def test_any_failure_fails(self) -> None:
        for job in ("backend", "backend_integration", "frontend", "contract", "secrets", "images"):
            with self.subTest(job=job):
                self.assertTrue(evaluate(results(**{job: "failure"}), "full"))

    def test_cancelled_fails(self) -> None:
        self.assertTrue(evaluate(results(frontend="cancelled"), "full"))

    def test_frontend_scope_may_skip_the_backend_jobs(self) -> None:
        skipped = results(backend="skipped", backend_integration="skipped")
        self.assertEqual(evaluate(skipped, "frontend"), [])

    def test_backend_scope_may_skip_the_frontend_job(self) -> None:
        self.assertEqual(evaluate(results(frontend="skipped"), "backend"), [])

    def test_full_scope_may_not_skip_anything_required(self) -> None:
        for job in ("backend", "backend_integration", "frontend", "contract", "secrets"):
            with self.subTest(job=job):
                self.assertTrue(evaluate(results(**{job: "skipped"}), "full"))

    def test_frontend_scope_may_not_skip_the_frontend_job(self) -> None:
        self.assertTrue(evaluate(results(frontend="skipped"), "frontend"))

    def test_backend_scope_may_not_skip_the_backend_jobs(self) -> None:
        self.assertTrue(evaluate(results(backend="skipped"), "backend"))

    def test_contract_and_secrets_are_never_skippable(self) -> None:
        for scope in ("frontend", "backend", "full"):
            for job in ("contract", "secrets", "e2e_workflow_a4b"):
                with self.subTest(scope=scope, job=job):
                    self.assertTrue(evaluate(results(**{job: "skipped"}), scope))

    def test_docs_only_pull_request_passes(self) -> None:
        docs = {job: "skipped" for job in ALL_OK}
        docs.update({"changes": "success", "docs-only": "success"})
        self.assertEqual(evaluate(docs, "full"), [])

    def test_everything_skipped_without_docs_only_fails(self) -> None:
        nothing = {job: "skipped" for job in ALL_OK}
        nothing["changes"] = "success"
        self.assertTrue(evaluate(nothing, "full"))

    def test_docs_only_success_does_not_hide_a_failed_code_job(self) -> None:
        mixed = results(docs_only="success", backend="failure")
        self.assertTrue(evaluate(mixed, "full"))

    def test_changes_job_must_succeed(self) -> None:
        self.assertTrue(evaluate(results(changes="failure"), "full"))
        self.assertTrue(evaluate(results(changes="skipped"), "full"))


if __name__ == "__main__":
    unittest.main()
