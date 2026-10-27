# ADR 0002 — Technology stack

- Status: Accepted (decision A1)
- Plan reference: §5.1, R6/V2.8 (toolchain pins)

## Decision
| Layer | Choice | Pin |
|---|---|---|
| Frontend | React + TypeScript + Vite, React Router, TanStack Query, Tailwind CSS | Node 24 LTS (`.nvmrc`), pnpm 10 (`packageManager`), `pnpm-lock.yaml` |
| Backend | Python + FastAPI, Pydantic v2, SQLAlchemy 2 (async) + asyncpg, Alembic | Python 3.13 (`backend/.python-version`), uv (`uv.lock`) |
| Database | PostgreSQL | 17 (`postgres:17.6-alpine` locally) |
| Cache / rate limiting | Redis | 7 (`redis:7.4.5-alpine` locally) |
| Quality | ruff, mypy (strict), pytest; ESLint (typescript-eslint strict), Prettier, tsc, Vitest | lockfiles |
| Supply chain | pip-audit, pnpm audit, gitleaks, Dependabot | `Makefile` |

## Notes
- TypeScript is held at `~6.0` because `typescript-eslint` 8.x supports `<6.1`. Revisit
  when typescript-eslint supports TypeScript 7.
- No additional UI component library in M0; Radix primitives arrive with the first
  interactive components (dialogs, menus).
- OpenAPI → TypeScript type generation (`openapi-typescript`) is deferred to M1, when the
  API gains typed endpoints.

## Consequences
One language per tier, typed contracts at the API boundary (OpenAPI committed and
drift-checked), reproducible installs from lockfiles.
