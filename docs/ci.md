# Continuous integration

GitHub Actions runs [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) on pull requests and on pushes to `main`. All steps use the standard free `ubuntu-24.04` runner (no paid services).

## UX state standards (PR authors)

User-facing changes should follow the [Global UX State System](../ux/global-ux-state-system.md). Use the [implementation checklist](../ux/implementation-checklist.md) for per-PR UX items and milestone scope when working on that program.

## Local vs CI

Locally, **`make ci`** always runs the full gate (including migration round-trip and full gitleaks history).

| Variable | CI typical value | Effect |
|----------|------------------|--------|
| `SKIP_MIGRATE_ROUNDTRIP=1` | PRs without `backend/migrations/**` changes | Skips Alembic up/down/up on the test DB |
| `CI_GITLEAKS_FULL_HISTORY=0` | Pull requests | `secrets-scan-worktree` only (no full git history scan) |
| `CI_GITLEAKS_FULL_HISTORY=1` | `main`, `workflow_dispatch` | Full `secrets-scan` (git + working tree) |

Simulate a scoped PR locally (everything in one go, as before):

```bash
SKIP_MIGRATE_ROUNDTRIP=1 CI_GITLEAKS_FULL_HISTORY=0 make ci
```

`SKIP_MIGRATE_ROUNDTRIP` applies to the **Backend** job and `CI_GITLEAKS_FULL_HISTORY` to the **Secrets scan** job.

## CI jobs

CI does not run `make ci` as one job. The same checks run as **parallel jobs**, each calling a make target, so a pull request finishes in about as long as the slowest job (the backend integration tests, split in three):

| Job | Make target | What it checks |
|-----|-------------|----------------|
| **Backend** | `make ci-backend` | ruff, mypy, backend unit tests, migration round-trip, backend dependency audit |
| **Backend integration (shard 1/3, 2/3, 3/3)** | `make ci-backend-integration SHARD=i/3` | the integration tests (PostgreSQL, Redis, Mailpit), one balanced third each, in three parallel jobs with their own containers |
| **Frontend** | `make ci-frontend` | lint and format, typecheck, unit tests, production build, frontend dependency audit (no Python, database or Docker) |
| **API contract** | `make ci-contract` | `backend/openapi.json` and the generated TypeScript types match the backend (no database) |
| **Secrets scan** | `make ci-secrets-scan` | gitleaks |
| **Container images** | `make images` | image build, only on `main` or when Dockerfiles / `infra/docker-compose.yml` change |
| **Playwright workflow A4b (mocked)** | `make e2e-workflow-a4b` | mocked browser tests |
| **CI** | — | the single required check; see below |

The shards are planned by [`.github/scripts/shard_tests.py`](../.github/scripts/shard_tests.py): test files are packed, heaviest first, into the lightest shard using per-file timings in `.github/scripts/shard_weights.json` (a new file without a timing gets the average). To rebalance after the suite changes, re-time the integration tests (`pytest tests/integration --durations=0`) and update the weights file; the script's tests fail if a weight names a file that no longer exists.

Run one shard locally: `make backend-test-integration SHARD=2/3`.

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

Any match runs the code jobs above on pull requests (all of them, or only one side; see the next section).

## Frontend-only and backend-only pull requests

The scope is computed in the **Detect changed paths** job by `python3 .github/scripts/classify_pr_paths.py --scope` (changed paths on stdin) and logged as `CI scope: frontend|backend|full`:

| Scope | When | Jobs that run | Skipped |
|-------|------|---------------|---------|
| `frontend` | every changed file is under `frontend/` or is documentation, and at least one is under `frontend/` | Frontend, API contract, Secrets scan, mocked Playwright (+ Images when Dockerfiles change) | Backend, Backend integration |
| `backend` | every changed file is under `backend/` or is documentation, and at least one is under `backend/` | Backend, Backend integration, API contract, Secrets scan, mocked Playwright (+ Images) | Frontend |
| `full` | anything else: both sides, `infra/`, `Makefile`, `.github/`, `.env.example`, `.gitleaks.toml`, `.nvmrc`, `render.yaml`, any unknown path, every push to `main`, every manual run | all jobs | — |

The API contract job always runs, so a backend change that alters `openapi.json` is still checked against the generated frontend types. The classification is deliberately fail-safe: when in doubt, everything runs.

Simulate locally:

```bash
git diff --name-only origin/main...HEAD | python3 .github/scripts/classify_pr_paths.py --scope
make ci-frontend      # or: make ci-backend, make ci-contract
```

## Pull request required check

Job **`CI`** (`ci-required`) always runs on pull requests. It reads the results of every other job (`.github/scripts/ci_gate.py`) and passes when:

- no job failed or was cancelled, and
- either the **Docs only (secrets scan)** job succeeded (a documentation-only PR; the code jobs are skipped), or every code job succeeded, where a job may be *skipped* only if the scope excludes it (Backend and Backend integration for `frontend`; Frontend for `backend`) or, for Container images, when it was not needed.

Use **`CI`** as the branch protection required check: it does not depend on which jobs were skipped, and the individual job names can change without touching branch protection.

## CI script tests

The helper scripts in [`.github/scripts/`](../.github/scripts/) have their own tests: path classification (`classify_pr_paths.py`), test sharding (`shard_tests.py`, including a check that every integration test file lands in exactly one shard) and the gate (`ci_gate.py`):

```bash
make test-ci-scripts          # all of them
make test-ci-path-classify    # path classification only
```

The PR **`CI`** job runs them before reporting success.

## Other PR scoping

- **Container images**: run on `main` or when Dockerfiles / `infra/docker-compose.yml` change.  
- **Migration round-trip** (in the Backend job): runs on `main` or when `backend/migrations/**` changes.

## Test parallelism

| Where | What runs in parallel |
|-------|-----------------------|
| CI | the jobs in the table above; the integration tests are additionally split across three jobs |
| `make test` | `backend-test` ∥ `frontend-test` (two processes) |
| `make test-parallel` | `backend-test-unit` ∥ `backend-test-integration` ∥ `frontend-test` (three processes; **`make ci` uses this** locally) |

## Dependency updates (Dependabot)

[`.github/dependabot.yml`](../.github/dependabot.yml) keeps the pull requests Dependabot opens few and quiet, because every one of them runs the full CI:

- **Grouped:** routine (minor and patch) updates arrive as one pull request per ecosystem (Python, npm, GitHub Actions, Docker, Docker Compose), not one per package.
- **Limited:** at most 3 open pull requests per ecosystem.
- **Staggered:** each ecosystem has its own weekday (Monday to Friday), so their CI runs do not all start together. The CI uses about ten parallel jobs per run, and the free plan runs about 20 jobs at once, so a burst of runs queues.
- **Deliberate upgrades:** major versions of Node, Postgres and Redis, and major or minor versions of the Python image, are ignored. They are pinned by the project (`.nvmrc`, `backend/.python-version`, the database volume) and need a planned upgrade, not a bot PR.

To upgrade one of those on purpose, change the pin and the image together in a normal pull request.

## Performance (free tier)

Before the split, one job ran everything in about 7 minutes, of which the backend integration tests were about 5m50s. They now run as three parallel shards; the other jobs finish well inside that. Each job repeats checkout and tool setup, kept short by the dependency caches: **pnpm** (Node setup) and **uv** (`enable-cache` on `setup-uv`). Image builds use BuildKit when the images job runs.

Feature branches should use **pull requests**; **`push` triggers CI only on `main`** to avoid duplicate runs.
