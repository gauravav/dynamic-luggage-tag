# Dynamic Luggage Tag — development tasks.
#
# `make setup` then `make dev` is the whole path from a clean checkout to a
# running stack.

SHELL := /bin/bash
PY    := api/.venv/bin/python
PIP   := api/.venv/bin/pip
FLASK := api/.venv/bin/flask
ALEMBIC := api/.venv/bin/alembic

.DEFAULT_GOAL := help
.PHONY: help setup venv deps db-up db-down db-destroy db-psql db-logs migrate \
        migration dev api web test lint check purge secrets-check clean deploy

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-16s\033[0m %s\n", $$1, $$2}'

setup: venv deps db-up migrate ## Full first-time setup
	@echo ""
	@echo "Ready. Run 'make dev' to start the API and the web app."

venv: ## Create the Python virtualenv
	@test -d api/.venv || python3 -m venv api/.venv
	@$(PIP) install --quiet --upgrade pip

deps: venv ## Install Python and Node dependencies
	@$(PIP) install --quiet -r api/requirements-dev.txt
	@cd web && npm install --silent

db-up: ## Build and start PostgreSQL in an Apple container
	@./infra/scripts/db-up.sh

db-down: ## Stop the database (data is kept)
	@./infra/scripts/db-down.sh

db-destroy: ## Delete the database volume and every row in it
	@./infra/scripts/db-destroy.sh

db-psql: ## Open a psql shell as the application role
	@./infra/scripts/db-psql.sh

db-logs: ## Follow the database logs
	@./infra/scripts/db-logs.sh

migrate: ## Apply database migrations
	@cd api && ../$(ALEMBIC) upgrade head

migration: ## Generate a migration: make migration m="add x"
	@cd api && ../$(ALEMBIC) revision --autogenerate -m "$(m)"

dev: ## Run the API and the web app together
	@./infra/scripts/dev.sh

api: ## Run the API only, on :5001
	@cd api && ./.venv/bin/python -m flask --app app:create_app run --port 5001 --debug

web: ## Run the web app only, on :5173
	@cd web && npm run dev

test: ## Run the Python test suite
	@cd api && ./.venv/bin/python -m pytest -q

lint: ## Lint Python and typecheck TypeScript
	@cd api && ./.venv/bin/ruff check . && ./.venv/bin/ruff format --check .
	@cd web && npx tsc -b --noEmit

check: ## Report the running security configuration
	@cd api && ./.venv/bin/python -m flask --app app:create_app check-config

purge: ## Delete data past its retention window
	@cd api && ./.venv/bin/python -m flask --app app:create_app purge

secrets-check: ## Verify no secret is tracked by git
	@! git ls-files --error-unmatch .secrets api/.env api/.env.prod infra/container/certs 2>/dev/null \
		&& echo "No secrets are tracked by git." || (echo "A secret is tracked!"; exit 1)

clean: ## Remove build artefacts (keeps data and secrets)
	@rm -rf web/dist api/.pytest_cache api/.ruff_cache
	@find api -name __pycache__ -type d -prune -exec rm -rf {} +

deploy: ## Deploy: pull, install deps, migrate, build web, restart the service
	@./infra/scripts/deploy.sh
