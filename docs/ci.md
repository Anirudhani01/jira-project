# Continuous integration

GitHub Actions runs [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) on pull requests and on pushes to `main`. All steps use the standard free `ubuntu-24.04` runner (no paid services).

## Local vs CI

Locally, **`make ci`** always runs the full gate (including migration round-trip and full gitleaks history).

CI runs **`make ci`** with optional scoping via environment variables, then **`make images`** when Docker-related paths change or on `main`.

| Variable | CI typical value | Effect |
|----------|------------------|--------|
| `SKIP_MIGRATE_ROUNDTRIP=1` | PRs without `backend/migrations/**` changes | Skips Alembic up/down/up on the test DB |
| `CI_GITLEAKS_FULL_HISTORY=0` | Pull requests | `secrets-scan-worktree` only (no full git history scan) |
| `CI_GITLEAKS_FULL_HISTORY=1` | `main`, `workflow_dispatch` | Full `secrets-scan` (git + working tree) |

Simulate a scoped PR locally:

```bash
SKIP_MIGRATE_ROUNDTRIP=1 CI_GITLEAKS_FULL_HISTORY=0 make ci
```

## Path filters (pull requests)

- **Docs/markdown only** (no paths in the `code` filter — e.g. `docs/**`, `*.md` only): **`make ci-docs`** (gitleaks worktree scan); no backend/frontend tests, Docker, lint, or build.
- **`make ci`**: runs when backend, frontend, infra, `Makefile`, `.github/**`, etc. change.
- **`make images`**: runs on `main` or when Dockerfiles / `infra/docker-compose.yml` change.
- **Migration round-trip**: runs on `main` or when `backend/migrations/**` changes.

## Test parallelism

| Target | What runs |
|--------|-----------|
| `make test` | `backend-test` ∥ `frontend-test` (two processes) |
| `make test-parallel` | `backend-test-unit` ∥ `backend-test-integration` ∥ `frontend-test` (three processes; **`make ci` uses this**) |

Backend unit and integration suites are separate pytest invocations so they can overlap safely; only integration uses the test database.

## Performance (free tier)

Inside a single job, `make ci` runs **`test-parallel`** and parallel install/lint/typecheck/audit where the Makefile allows. Dependency caches: **pnpm** (Node setup) and **uv** (`enable-cache` on `setup-uv`). Image builds use BuildKit when the images step runs.

Feature branches should use **pull requests**; **`push` triggers CI only on `main`** to avoid duplicate runs.
