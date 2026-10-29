#!/usr/bin/env python3
"""Classify changed file paths for CI (mirrors .github/workflows/ci.yml filters).

Fail-safe: if a path is not explicitly allowed as documentation-only, treat it as
requiring full CI when combined with PR docs-only gating.
"""

from __future__ import annotations

# Keep in sync with the `documentation` and `code` filters in ci.yml.
DOCUMENTATION_PATHS: tuple[str, ...] = (
    "docs/",
    "README.md",
    "DEPLOYMENT.md",
    "PLAN.md",
)

CODE_PREFIXES: tuple[str, ...] = (
    "backend/",
    "frontend/",
    "infra/",
    "Makefile",
    ".github/",
    ".env.example",
    ".gitleaks.toml",
    ".gitignore",
    "backend/uv.lock",
    "frontend/pnpm-lock.yaml",
    ".nvmrc",
    ".editorconfig",
    "render.yaml",
)

CODE_EXACT: frozenset[str] = frozenset({"Makefile", "render.yaml"})


def _norm(path: str) -> str:
    return path.strip().replace("\\", "/")


def is_documentation_path(path: str) -> bool:
    p = _norm(path)
    if not p or p.endswith("/"):
        return False
    for prefix in DOCUMENTATION_PATHS:
        if prefix.endswith("/"):
            if p.startswith(prefix) or p == prefix.rstrip("/"):
                return True
        elif p == prefix:
            return True
    return False


def is_code_path(path: str) -> bool:
    p = _norm(path)
    if not p:
        return False
    if p in CODE_EXACT:
        return True
    for prefix in CODE_PREFIXES:
        if prefix.endswith("/") and p.startswith(prefix):
            return True
        if not prefix.endswith("/") and p == prefix:
            return True
    return False


def classify_pr_changes(paths: list[str]) -> str:
    """Return 'docs_only', 'full_ci', or 'full_ci_fail_safe'."""
    normalized = [_norm(p) for p in paths if _norm(p)]
    if not normalized:
        return "full_ci_fail_safe"

    saw_doc = False
    for p in normalized:
        if is_code_path(p):
            return "full_ci"
        if is_documentation_path(p):
            saw_doc = True
        else:
            # Unknown path (e.g. random root file): fail-safe to full CI.
            return "full_ci_fail_safe"

    return "docs_only" if saw_doc else "full_ci_fail_safe"


def main() -> None:
    import sys
    import unittest
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    suite = unittest.defaultTestLoader.loadTestsFromName("test_classify_pr_paths")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)


if __name__ == "__main__":
    main()
