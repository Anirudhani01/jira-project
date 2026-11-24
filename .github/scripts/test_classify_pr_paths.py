#!/usr/bin/env python3
"""Tests for classify_pr_paths (run: python3 .github/scripts/classify_pr_paths.py)."""

import unittest

from classify_pr_paths import classify_ci_scope, classify_pr_changes


class ClassifyPrPathsTests(unittest.TestCase):
    def test_docs_only_under_docs(self) -> None:
        self.assertEqual(
            classify_pr_changes(["docs/ci.md", "docs/adr/0001-modular-monolith.md"]),
            "docs_only",
        )

    def test_readme_only(self) -> None:
        self.assertEqual(classify_pr_changes(["README.md"]), "docs_only")

    def test_deployment_only(self) -> None:
        self.assertEqual(classify_pr_changes(["DEPLOYMENT.md"]), "docs_only")

    def test_plan_only(self) -> None:
        self.assertEqual(classify_pr_changes(["PLAN.md"]), "docs_only")

    def test_backend_source(self) -> None:
        self.assertEqual(
            classify_pr_changes(["backend/app/main.py"]),
            "full_ci",
        )

    def test_backend_readme_is_code(self) -> None:
        self.assertEqual(
            classify_pr_changes(["backend/app/modules/identity/data/README.md"]),
            "full_ci",
        )

    def test_frontend_source(self) -> None:
        self.assertEqual(classify_pr_changes(["frontend/src/main.tsx"]), "full_ci")

    def test_tests_change(self) -> None:
        self.assertEqual(
            classify_pr_changes(["backend/tests/unit/test_config.py"]),
            "full_ci",
        )

    def test_lockfile(self) -> None:
        self.assertEqual(classify_pr_changes(["backend/uv.lock"]), "full_ci")

    def test_pnpm_lock(self) -> None:
        self.assertEqual(classify_pr_changes(["frontend/pnpm-lock.yaml"]), "full_ci")

    def test_workflow_change(self) -> None:
        self.assertEqual(
            classify_pr_changes([".github/workflows/ci.yml"]),
            "full_ci",
        )

    def test_mixed_docs_and_code(self) -> None:
        self.assertEqual(
            classify_pr_changes(["docs/ci.md", "backend/app/main.py"]),
            "full_ci",
        )

    def test_editorconfig_is_code(self) -> None:
        self.assertEqual(classify_pr_changes([".editorconfig"]), "full_ci")

    def test_unknown_root_file_fail_safe(self) -> None:
        self.assertEqual(classify_pr_changes(["notes.txt"]), "full_ci_fail_safe")

    def test_render_yaml_fail_safe_via_code_prefix(self) -> None:
        self.assertEqual(classify_pr_changes(["render.yaml"]), "full_ci")

    def test_empty_list_fail_safe(self) -> None:
        self.assertEqual(classify_pr_changes([]), "full_ci_fail_safe")

    def test_ui_redesign_png_under_docs(self) -> None:
        self.assertEqual(
            classify_pr_changes(["docs/ui-redesign/after/design-light.png"]),
            "docs_only",
        )


class ClassifyCiScopeTests(unittest.TestCase):
    def test_frontend_source_is_frontend_scope(self) -> None:
        self.assertEqual(classify_ci_scope(["frontend/src/main.tsx"]), "frontend")

    def test_frontend_e2e_and_lockfile_are_frontend_scope(self) -> None:
        self.assertEqual(
            classify_ci_scope(["frontend/e2e/suites/mvp/scenarios.ts", "frontend/pnpm-lock.yaml"]),
            "frontend",
        )

    def test_frontend_plus_docs_is_frontend_scope(self) -> None:
        self.assertEqual(
            classify_ci_scope(["frontend/src/a.tsx", "docs/ui-redesign/evidence/x.png", "README.md"]),
            "frontend",
        )

    def test_backend_change_is_backend_scope(self) -> None:
        self.assertEqual(classify_ci_scope(["backend/app/main.py"]), "backend")

    def test_backend_migrations_lock_and_openapi_are_backend_scope(self) -> None:
        self.assertEqual(
            classify_ci_scope(
                [
                    "backend/migrations/versions/0028_x.py",
                    "backend/uv.lock",
                    "backend/openapi.json",
                    "docs/ci.md",
                ]
            ),
            "backend",
        )

    def test_frontend_plus_backend_is_full(self) -> None:
        self.assertEqual(
            classify_ci_scope(["frontend/src/a.tsx", "backend/openapi.json"]), "full"
        )

    def test_shared_files_are_full(self) -> None:
        for path in (
            "Makefile",
            ".github/workflows/ci.yml",
            "infra/docker-compose.yml",
            ".env.example",
            ".gitleaks.toml",
            ".nvmrc",
            "render.yaml",
        ):
            with self.subTest(path=path):
                self.assertEqual(classify_ci_scope(["frontend/src/a.tsx", path]), "full")
                self.assertEqual(classify_ci_scope(["backend/app/main.py", path]), "full")

    def test_docs_only_is_full_for_this_job(self) -> None:
        # Docs-only PRs are handled by their own job; this classifier never narrows them.
        self.assertEqual(classify_ci_scope(["docs/ci.md"]), "full")

    def test_unknown_path_fails_safe_to_full(self) -> None:
        self.assertEqual(classify_ci_scope(["frontend/src/a.tsx", "notes.txt"]), "full")
        self.assertEqual(classify_ci_scope(["backend/app/main.py", "notes.txt"]), "full")

    def test_empty_is_full(self) -> None:
        self.assertEqual(classify_ci_scope([]), "full")

    def test_path_that_only_looks_like_frontend_or_backend_is_full(self) -> None:
        self.assertEqual(classify_ci_scope(["frontend-old/a.ts"]), "full")
        self.assertEqual(classify_ci_scope(["backend-tools/a.py"]), "full")


if __name__ == "__main__":
    unittest.main()
