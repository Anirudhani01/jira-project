#!/usr/bin/env python3
"""Tests for classify_pr_paths (run: python3 .github/scripts/classify_pr_paths.py)."""

import unittest

from classify_pr_paths import classify_pr_changes


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


if __name__ == "__main__":
    unittest.main()
