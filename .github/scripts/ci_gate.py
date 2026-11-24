#!/usr/bin/env python3
"""Decide the pull-request CI gate from the results of the jobs it depends on.

Reads the ``needs`` context (as JSON) from NEEDS_JSON and the CI scope from SCOPE
(``frontend`` | ``backend`` | ``full``). Exits non-zero, with the reasons, when the gate fails.

Rules:
- any job that failed or was cancelled fails the gate;
- a docs-only pull request passes when the docs-only job succeeded (the code jobs are
  skipped then);
- otherwise every code job must have succeeded, except that a job may be skipped when the
  scope excludes it (backend jobs for ``frontend``, the frontend job for ``backend``) or,
  for the image build, when it was not needed.
"""

from __future__ import annotations

import json
import os
import sys

# Code jobs that must succeed on a pull request that changes code.
REQUIRED = (
    "changes",
    "backend",
    "backend-integration",
    "frontend",
    "contract",
    "secrets",
    "e2e-workflow-a4b",
)
# Jobs that scope may legitimately skip.
SKIPPABLE_BY_SCOPE = {
    "backend": "frontend",
    "backend-integration": "frontend",
    "frontend": "backend",
}
OPTIONAL = ("images",)
CODE_JOBS = tuple(job for job in REQUIRED if job != "changes") + OPTIONAL


def evaluate(results: dict[str, str], scope: str) -> list[str]:
    """Return the reasons the gate fails (empty list = pass)."""
    problems = [
        f"{job}: {result}"
        for job, result in sorted(results.items())
        if result in ("failure", "cancelled")
    ]
    if problems:
        return problems
    if results.get("changes") != "success":
        return [f"changes: {results.get('changes', 'missing')}"]
    code_skipped = all(results.get(job, "skipped") == "skipped" for job in CODE_JOBS)
    if results.get("docs-only") == "success" and code_skipped:
        return []
    for job in REQUIRED:
        result = results.get(job, "missing")
        if result == "success":
            continue
        if result == "skipped" and SKIPPABLE_BY_SCOPE.get(job) == scope:
            continue
        problems.append(f"{job}: {result} (scope {scope})")
    for job in OPTIONAL:
        if results.get(job, "skipped") not in ("success", "skipped"):
            problems.append(f"{job}: {results[job]}")
    return problems


def main() -> None:
    needs = json.loads(os.environ["NEEDS_JSON"])
    results = {job: info["result"] for job, info in needs.items()}
    scope = os.environ.get("SCOPE", "full")
    problems = evaluate(results, scope)
    if problems:
        print("CI gate failed:", file=sys.stderr)
        for line in problems:
            print(f"  - {line}", file=sys.stderr)
        sys.exit(1)
    print(f"CI gate passed (scope {scope}).")


if __name__ == "__main__":
    main()
