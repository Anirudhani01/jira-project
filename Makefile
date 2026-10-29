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

install: backend-install frontend-install ## Install backend and frontend dependencies from lockfiles

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

migrate-roundtrip: ## Upgrade -> downgrade base -> upgrade on the test database
	$(UV) run env MIGRATION_DATABASE_URL="$(TEST_MIGRATION_DATABASE_URL)" alembic upgrade head
	$(UV) run env MIGRATION_DATABASE_URL="$(TEST_MIGRATION_DATABASE_URL)" alembic downgrade base
	$(UV) run env MIGRATION_DATABASE_URL="$(TEST_MIGRATION_DATABASE_URL)" alembic upgrade head

# -------------------------------------------------------------------------- quality
.PHONY: lint backend-lint frontend-lint typecheck fmt
lint: backend-lint frontend-lint ## Lint and check formatting

backend-lint:
	$(UV) run ruff check .
	$(UV) run ruff format --check .

frontend-lint: node-version-check
	$(PNPM) lint
	$(PNPM) format:check

typecheck: node-version-check ## Static type checks (mypy, tsc)
	$(UV) run mypy
	$(PNPM) typecheck

fmt: node-version-check ## Auto-format backend and frontend
	$(UV) run ruff format .
	$(UV) run ruff check --fix .
	$(PNPM) format

.PHONY: test backend-test backend-test-unit frontend-test
test: backend-test frontend-test ## All tests (backend integration tests require infra-up)

backend-test:
	$(UV) run env REQUIRE_INTEGRATION=1 pytest

backend-test-unit:
	$(UV) run pytest tests/unit

frontend-test: node-version-check
	$(PNPM) test

.PHONY: e2e
e2e: node-version-check ## Playwright journeys against a running stack (make dev: API, worker, UI, Mailpit)
	$(PNPM) e2e

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
	$(COMPOSE) --profile app build backend frontend

# ------------------------------------------------------------------------- security
.PHONY: audit backend-audit frontend-audit secrets-scan
audit: backend-audit frontend-audit ## Dependency vulnerability audit

backend-audit:
	@mkdir -p $(TMP_DIR)
	$(UV) export --frozen --format requirements-txt --no-emit-project -o $(TMP_DIR)/requirements.txt > /dev/null
	$(UV) run pip-audit --strict --disable-pip -r $(TMP_DIR)/requirements.txt

frontend-audit:
	$(PNPM) audit --audit-level high

secrets-scan: ## Scan git history and the working tree for secrets (gitleaks)
	docker run --rm -v "$(CURDIR):/repo:ro" $(GITLEAKS_IMAGE) git /repo --no-banner --redact --config /repo/.gitleaks.toml
	docker run --rm -v "$(CURDIR):/repo:ro" $(GITLEAKS_IMAGE) dir /repo --no-banner --redact --config /repo/.gitleaks.toml

# ------------------------------------------------------------------------------- CI
.PHONY: ci
ci: install infra-up lint typecheck test migrate-roundtrip openapi-check build audit secrets-scan ## Everything CI runs
	@echo "make ci: all checks passed"
