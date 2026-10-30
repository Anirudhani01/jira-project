# Continuous integration

GitHub Actions runs [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) on pull requests and on pushes to `main`. All steps use the standard free `ubuntu-24.04` runner (no paid services).

## UX state standards (PR authors)

User-facing changes should follow the [Global UX State System](../ux/global-ux-state-system.md). Use the [implementation checklist](../ux/implementation-checklist.md) for per-PR UX items and milestone scope when working on that program.

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

## Documentation-only pull requests

A PR is **documentation-only** when:

1. At least one changed file matches the **`documentation`** filter, and  
2. **No** changed file matches the **`code`** filter.

### Allowed documentation paths (explicit allowlist)

These are the only paths treated as documentation-only. Other `.md` files (for example under `backend/**`) are **not** documentation-only.

| Path | Notes |
|------|--------|
| `docs/**` | Architecture, ADRs, runbooks, UI plans, screenshots under `docs/` |
| `README.md` | Repository root |
| `DEPLOYMENT.md` | Deployment guide |
| `PLAN.md` | Product/architecture plan at repo root |

### Fail-safe → full CI

Full **`make ci`** runs when:

- Any **`code`** path changes (see below), including mixed doc + code PRs  
- The PR changes files **outside** the documentation allowlist (e.g. `notes.txt`, `.editorconfig`) even if no `code` filter matched in edge cases — workflow condition: `documentation != 'true'`  
- **`workflow_dispatch`** or **push to `main`** (always full CI on `main`)

### Documentation-only job

Runs **`make ci-docs`** only:

- Gitleaks via **`ci-secrets-scan`** (worktree scan on PRs)

Does **not** run: Docker/Postgres/Redis, backend or frontend tests, lint, typecheck, OpenAPI drift, frontend build, migration roundtrip, `make images`, or **`make ci`**.

There is **no** markdown linter in this repository; none was added for docs-only PRs.

## Code paths (full CI)

The **`code`** filter includes (non-exhaustive): `backend/**`, `frontend/**`, `infra/**`, `Makefile`, `.github/**`, lockfiles, `.nvmrc`, `.editorconfig`, `render.yaml`, `.env.example`, `.gitleaks.toml`, `.gitignore`.

Any match forces the full **`make ci`** job on pull requests.

## Pull request required check

Job **`CI`** (`ci-required`) always runs on pull requests and passes if either **`make ci`** or **Docs only (secrets scan)** succeeded. Use **`CI`** as the branch protection required check (not the skipped **`make ci`** job alone).

## Path filter tests

Logic mirrored in [`.github/scripts/classify_pr_paths.py`](../.github/scripts/classify_pr_paths.py):

```bash
make test-ci-path-classify
```

The PR **`CI`** job runs this test before reporting success.

## Other PR scoping (full CI job)

- **`make images`**: runs on `main` or when Dockerfiles / `infra/docker-compose.yml` change.  
- **Migration round-trip**: runs on `main` or when `backend/migrations/**` changes.

## Test parallelism (full CI)

| Target | What runs |
|--------|-----------|
| `make test` | `backend-test` ∥ `frontend-test` (two processes) |
| `make test-parallel` | `backend-test-unit` ∥ `backend-test-integration` ∥ `frontend-test` (three processes; **`make ci` uses this**) |

## Performance (free tier)

Inside the full CI job, `make ci` runs **`test-parallel`** and parallel install/lint/typecheck/audit where the Makefile allows. Dependency caches: **pnpm** (Node setup) and **uv** (`enable-cache` on `setup-uv`). Image builds use BuildKit when the images step runs.

Feature branches should use **pull requests**; **`push` triggers CI only on `main`** to avoid duplicate runs.
