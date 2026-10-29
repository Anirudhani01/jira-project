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

- **Docs/markdown only** (`docs/**`, no backend/frontend/infra/Makefile): lightweight job only; full CI skipped.
- **`make images`**: runs on `main` or when Dockerfiles / `infra/docker-compose.yml` change.
- **Migration round-trip**: runs on `main` or when `backend/migrations/**` changes.

## Performance (free tier)

Inside a single job, `make ci` runs independent steps in parallel where safe (install, lint, typecheck, test, audit). Dependency caches: **pnpm** (Node setup) and **uv** (`enable-cache` on `setup-uv`). Image builds use BuildKit when the images step runs.

Feature branches should use **pull requests**; **`push` triggers CI only on `main`** to avoid duplicate runs.
