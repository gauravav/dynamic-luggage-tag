#!/usr/bin/env bash
# Deploys the app to this host: pulls the latest commit, installs
# dependencies, runs migrations, builds the frontend for its mounted path,
# and restarts the service.
#
# Reads production configuration from api/.env.prod (hand-maintained,
# gitignored — see api/.env.example for what belongs in it). Everything
# below is overridable so a differently-set-up host can reuse this script:
#
#   DLT_DEPLOY_SERVICE   systemd unit to restart              (default: dynamic-luggage-tag-api)
#   DLT_DEPLOY_BASE_PATH the path the app is mounted at        (default: /dynamic-luggage-tag/)
#   DLT_DEPLOY_BRANCH    branch to pull before deploying       (default: main)
#   DLT_DEPLOY_RELOAD_NGINX  1 to reload nginx after building  (default: 1)
#   DLT_DEPLOY_SKIP_PULL     1 to deploy the current checkout as-is, no git pull
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

ENV_FILE="$ROOT/api/.env.prod"
SERVICE="${DLT_DEPLOY_SERVICE:-dynamic-luggage-tag-api}"
BASE_PATH="${DLT_DEPLOY_BASE_PATH:-/dynamic-luggage-tag/}"
BRANCH="${DLT_DEPLOY_BRANCH:-main}"
RELOAD_NGINX="${DLT_DEPLOY_RELOAD_NGINX:-1}"
SKIP_PULL="${DLT_DEPLOY_SKIP_PULL:-0}"

[[ -f "$ENV_FILE" ]] || die "$ENV_FILE is missing. Copy api/.env.example to api/.env.prod and fill in production values."
[[ -x "$ROOT/api/.venv/bin/python" ]] || die "api/.venv is missing. Run: make venv"

cd "$ROOT"

if [[ "$SKIP_PULL" != "1" ]]; then
    [[ -z "$(git status --porcelain)" ]] || die "Working tree is dirty. Commit or stash before deploying."
    log "Pulling $BRANCH..."
    git fetch origin "$BRANCH"
    git checkout "$BRANCH" >/dev/null 2>&1 || true
    git merge --ff-only "origin/$BRANCH"
fi

log "Installing API dependencies..."
"$ROOT/api/.venv/bin/pip" install --quiet -r "$ROOT/api/requirements.txt"

log "Running database migrations..."
( set -a; source "$ENV_FILE"; set +a
  cd "$ROOT/api" && "$ROOT/api/.venv/bin/alembic" upgrade head )

log "Building the web app for $BASE_PATH..."
( cd "$ROOT/web" && npm ci --silent && VITE_BASE_PATH="$BASE_PATH" npm run build )

log "Restarting $SERVICE..."
sudo systemctl restart "$SERVICE"
sudo systemctl --no-pager --full status "$SERVICE" | head -5

if [[ "$RELOAD_NGINX" == "1" ]]; then
    log "Reloading nginx..."
    sudo nginx -t && sudo systemctl reload nginx
fi

log "Deploy complete."
