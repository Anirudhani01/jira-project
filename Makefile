# Single entry point for local development and CI. CI runs `make ci`, so the same
# commands run locally and in GitHub Actions.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
MAKEFLAGS += --no-print-directory

# Use .env when present, otherwise the committed placeholder file (local-only values).
ENV_FILE ?= $(if $(wildcard .env),.env,.env.example)
include $(ENV_FILE)
export

# Prefer standalone docker-compose when `docker compose` is unavailable (some Colima setups).
COMPOSE := $(shell if docker compose version >/dev/null 2>&1; then echo 'docker compose'; else echo docker-compose; fi) -f infra/docker-compose.yml --env-file $(ENV_FILE)
GITLEAKS_IMAGE := zricethezav/gitleaks:v8.28.0
TMP_DIR := $(CURDIR)/.tmp
# Ignore a stale VIRTUAL_ENV from another repo; uv installs into backend/venv (UV_PROJECT_ENVIRONMENT).
UV := cd backend && env -u VIRTUAL_ENV UV_PROJECT_ENVIRONMENT=venv uv
PNPM := cd frontend && pnpm
# `$(file < …)` needs GNU Make 4.x; macOS ships 3.81, so read .nvmrc via the shell.
NODE_PIN := $(strip $(shell tr -d ' \n\r' < .nvmrc))

.PHONY: help
help: ## List targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------- setup
.PHONY: node-version-check install backend-install frontend-install
node-version-check: ## Fail unless the active Node.js major matches .nvmrc
	@actual="$$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo none)"; \
	if [ "$$actual" != "$(NODE_PIN)" ]; then \
	  echo "Node.js $(NODE_PIN).x required (.nvmrc), found: $$(node -v 2>/dev/null || echo none)." >&2; \
	  echo "Use e.g. 'nvm use' or 'fnm use' in the repository root." >&2; exit 1; \
	fi

install: ## Install backend and frontend dependencies from lockfiles
	$(MAKE) -j2 backend-install frontend-install

backend-install:
	$(UV) sync --frozen

frontend-install: node-version-check
	$(PNPM) install --frozen-lockfile

# ---------------------------------------------------------------------- local stack
.PHONY: infra-up down reset-db up dev backend-dev worker-dev frontend-dev
infra-up: ## Start PostgreSQL, Redis and Mailpit (waits until healthy)
	$(COMPOSE) up -d --wait postgres redis mailpit

down: ## Stop all containers (keeps data)
	$(COMPOSE) --profile app down

reset-db: ## DESTRUCTIVE: stop containers and delete the local database volume
	$(COMPOSE) --profile app down --volumes

up: ## Build and run the full stack in containers (http://localhost:8080)
	$(COMPOSE) --profile app up -d --build --wait

dev: infra-up migrate ## Run infra in containers + backend/worker/frontend locally
	$(MAKE) -j3 backend-dev worker-dev frontend-dev

backend-dev:
	$(UV) run uvicorn app.main:create_app --factory --reload --no-access-log --host 127.0.0.1 --port 8000

worker-dev: ## Run the outbox worker (emails go to Mailpit: http://localhost:8025)
	$(UV) run python -m app.worker

frontend-dev: node-version-check
	$(PNPM) dev

# ----------------------------------------------------------------------- migrations
.PHONY: migrate migrate-roundtrip
migrate: ## Apply migrations to the dev database (as app_owner)
	$(UV) run alembic upgrade head

.PHONY: seed-demo
seed-demo: infra-up ## Demo org/issues for local UI (API on :8000; see app/scripts/seed_demo.py)
	$(UV) run python -m app.scripts.seed_demo

migrate-roundtrip: ## Upgrade -> downgrade base -> upgrade on the test database
	$(UV) run env MIGRATION_DATABASE_URL="$(TEST_MIGRATION_DATABASE_URL)" alembic upgrade head
	$(UV) run env MIGRATION_DATABASE_URL="$(TEST_MIGRATION_DATABASE_URL)" alembic downgrade base
	$(UV) run env MIGRATION_DATABASE_URL="$(TEST_MIGRATION_DATABASE_URL)" alembic upgrade head

# -------------------------------------------------------------------------- quality
.PHONY: lint backend-lint frontend-lint typecheck backend-typecheck frontend-typecheck fmt
lint: ## Lint and check formatting
	$(MAKE) -j2 backend-lint frontend-lint

backend-lint:
	$(UV) run ruff check .
	$(UV) run ruff format --check .

frontend-lint: node-version-check
	$(PNPM) lint
	$(PNPM) format:check

backend-typecheck:
	$(UV) run mypy

frontend-typecheck: node-version-check
	$(PNPM) typecheck

typecheck: ## Static type checks (mypy, tsc)
	$(MAKE) -j2 backend-typecheck frontend-typecheck

fmt: node-version-check ## Auto-format backend and frontend
	$(UV) run ruff format .
	$(UV) run ruff check --fix .
	$(PNPM) format

.PHONY: test test-parallel backend-test backend-test-parallel backend-test-unit backend-test-integration frontend-test
test: ## All tests (backend integration tests require infra-up)
	$(MAKE) -j2 backend-test frontend-test

# Unit tests use fake DB/Redis URLs; integration needs infra-up + TEST_* (see tests/integration/conftest.py).
# Safe in parallel: separate pytest processes; only integration uses Postgres/Redis/Mailpit.
test-parallel: ## Backend unit + integration + frontend concurrently (used by make ci)
	$(MAKE) -j3 backend-test-unit backend-test-integration frontend-test

backend-test:
	$(UV) run env REQUIRE_INTEGRATION=1 pytest

backend-test-parallel:
	$(MAKE) -j2 backend-test-unit backend-test-integration

backend-test-unit:
	$(UV) run pytest tests/unit

backend-test-integration:
	$(UV) run env REQUIRE_INTEGRATION=1 pytest tests/integration

frontend-test: node-version-check
	$(PNPM) test

.PHONY: e2e
e2e: node-version-check ## Playwright journeys against a running stack (make dev: API, worker, UI, Mailpit)
	$(PNPM) e2e

.PHONY: e2e-journeys
e2e-journeys: node-version-check ## PLAN §1.2 MVP suite only (requires make dev)
	$(PNPM) e2e:journeys

.PHONY: e2e-journeys-smoke
e2e-journeys-smoke: node-version-check ## MVP smoke scenarios (@mvp-smoke; requires make dev)
	$(PNPM) e2e:journeys:smoke

.PHONY: e2e-pr3
e2e-pr3: node-version-check ## Axe + light/dark screenshots for PR 3 routes (requires make dev)
	$(PNPM) exec playwright test \
		e2e/login.spec.ts e2e/signup.spec.ts e2e/org-home.spec.ts \
		e2e/template-overview.spec.ts e2e/create-project.spec.ts e2e/account.spec.ts

.PHONY: e2e-pr4
e2e-pr4: node-version-check ## Axe + light/dark screenshots for PR 4 board (requires make dev)
	$(PNPM) exec playwright test e2e/board.spec.ts

.PHONY: e2e-pr8
e2e-pr8: node-version-check ## Axe + light/dark screenshots for issue list (requires make dev)
	$(PNPM) exec playwright test e2e/issue-list.spec.ts

.PHONY: e2e-pr10-settings
e2e-pr10-settings: node-version-check ## Axe + light/dark screenshots for project settings (requires make dev)
	$(PNPM) exec playwright test e2e/project-settings.spec.ts

.PHONY: openapi openapi-check
openapi: node-version-check ## Regenerate backend/openapi.json and frontend API types
	$(UV) run python -m app.scripts.export_openapi
	$(PNPM) gen:api

openapi-check: node-version-check ## Fail if openapi.json or the generated TS types are stale
	@mkdir -p $(TMP_DIR)
	$(UV) run python -m app.scripts.export_openapi $(TMP_DIR)/openapi.json
	diff -u backend/openapi.json $(TMP_DIR)/openapi.json
	$(PNPM) check:api

.PHONY: build frontend-build images
build: frontend-build ## Production frontend build

frontend-build: node-version-check
	$(PNPM) build

images: ## Build backend and frontend container images locally (never pushed)
	DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 $(COMPOSE) --profile app build backend frontend

# ------------------------------------------------------------------------- security
.PHONY: audit backend-audit frontend-audit secrets-scan secrets-scan-worktree ci-secrets-scan ci-migrate-roundtrip
audit: ## Dependency vulnerability audit
	$(MAKE) -j2 backend-audit frontend-audit

backend-audit:
	@mkdir -p $(TMP_DIR)
	$(UV) export --frozen --format requirements-txt --no-emit-project -o $(TMP_DIR)/requirements.txt > /dev/null
	$(UV) run pip-audit --strict --disable-pip -r $(TMP_DIR)/requirements.txt

frontend-audit:
	$(PNPM) audit --audit-level high

secrets-scan: ## Scan git history and the working tree for secrets (gitleaks)
	docker run --rm -v "$(CURDIR):/repo:ro" $(GITLEAKS_IMAGE) git /repo --no-banner --redact --config /repo/.gitleaks.toml
	docker run --rm -v "$(CURDIR):/repo:ro" $(GITLEAKS_IMAGE) dir /repo --no-banner --redact --config /repo/.gitleaks.toml

secrets-scan-worktree: ## Scan the working tree only (PR CI; no full git history)
	docker run --rm -v "$(CURDIR):/repo:ro" $(GITLEAKS_IMAGE) dir /repo --no-banner --redact --config /repo/.gitleaks.toml

ci-migrate-roundtrip: ## migrate-roundtrip unless SKIP_MIGRATE_ROUNDTRIP=1 (PR path scoping)
	@if [ "$(SKIP_MIGRATE_ROUNDTRIP)" = "1" ]; then \
	  echo "Skipping migrate-roundtrip (SKIP_MIGRATE_ROUNDTRIP=1)"; \
	else \
	  $(MAKE) migrate-roundtrip; \
	fi

ci-secrets-scan: ## Full history on main; worktree-only on PRs (CI_GITLEAKS_FULL_HISTORY=1)
	@if [ "$(CI_GITLEAKS_FULL_HISTORY)" = "1" ]; then \
	  $(MAKE) secrets-scan; \
	else \
	  $(MAKE) secrets-scan-worktree; \
	fi

# ------------------------------------------------------------------------------- CI
.PHONY: test-ci-path-classify ci ci-docs
test-ci-path-classify: ## Unit tests for PR path classification (.github/scripts)
	python3 .github/scripts/classify_pr_paths.py

ci: install infra-up lint typecheck test-parallel ci-migrate-roundtrip openapi-check build audit ci-secrets-scan ## Everything CI runs
	@echo "make ci: all checks passed"

ci-docs: ## Docs-only PRs: gitleaks (respects CI_GITLEAKS_FULL_HISTORY); no app tests or Docker
	$(MAKE) ci-secrets-scan
	@echo "make ci-docs: docs-only checks passed"
