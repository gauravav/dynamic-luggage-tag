#!/usr/bin/env bash
# Shared settings for the infra scripts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA="$ROOT/infra"
CERTS="$INFRA/container/certs"

DB_CONTAINER="${DLT_DB_CONTAINER:-dlt-postgres}"
DB_IMAGE="${DLT_DB_IMAGE:-dlt/postgres:16}"
DB_NAME="${DLT_DB_NAME:-dlt}"
DB_APP_USER="${DLT_DB_APP_USER:-dlt_app}"
DB_HOST_PORT="${DLT_DB_HOST_PORT:-5432}"
DB_DATA="${DLT_DB_DATA:-$ROOT/.container-data/postgres}"
SECRETS="$ROOT/.secrets"

log()  { printf '\033[0;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[0;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

need_container_cli() {
    command -v container >/dev/null 2>&1 \
        || die "Apple's 'container' CLI is not installed. See https://github.com/apple/container"
    if ! container system status >/dev/null 2>&1; then
        log "Starting the container apiserver..."
        container system start >/dev/null
    fi
}

# Reads a secret file, creating it with a fresh random value if absent.
# Secrets live outside the repo tree's tracked files and are mode 0600.
secret() {
    local name="$1" generator="${2:-openssl rand -base64 32}"
    local path="$SECRETS/$name"
    if [[ ! -f "$path" ]]; then
        mkdir -p "$SECRETS"; chmod 0700 "$SECRETS"
        ( umask 077; eval "$generator" | tr -d '\n' > "$path" )
    fi
    cat "$path"
}

container_exists() { container ls --all --format json 2>/dev/null | grep -q "\"$DB_CONTAINER\""; }
container_running() { container ls --format json 2>/dev/null | grep -q "\"$DB_CONTAINER\""; }
