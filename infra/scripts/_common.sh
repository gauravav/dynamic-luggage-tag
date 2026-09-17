#!/usr/bin/env bash
# Shared settings for the infra scripts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA="$ROOT/infra"
CERTS="$INFRA/container/certs"

# Local machine overrides (DLT_DB_EXTERNAL and friends), so `make dev`/`make
# db-up` don't need those exported by hand every time. Matches the .env.*
# pattern .gitignore already excludes; holds a superuser password, so keep it
# out of version control same as .secrets/.
if [[ -f "$ROOT/.env.infra" ]]; then
    set -a
    source "$ROOT/.env.infra"
    set +a
fi

DB_CONTAINER="${DLT_DB_CONTAINER:-dlt-postgres}"
DB_IMAGE="${DLT_DB_IMAGE:-dlt/postgres:16}"
DB_NAME="${DLT_DB_NAME:-dlt}"
DB_APP_USER="${DLT_DB_APP_USER:-dlt_app}"
DB_HOST_PORT="${DLT_DB_HOST_PORT:-5432}"
DB_DATA="${DLT_DB_DATA:-$ROOT/.container-data/postgres}"
SECRETS="$ROOT/.secrets"

# Set DLT_DB_EXTERNAL=1 to point these scripts at a PostgreSQL server they do
# not manage (e.g. a container someone else started) instead of the hardened
# Apple-container image. DLT_DB_SUPERUSER_PASSWORD is required in that mode;
# DLT_DB_SSLMODE defaults to "disable" since an external server was not
# necessarily set up with the certs infra/scripts/gen-certs.sh generates.
EXTERNAL_DB="${DLT_DB_EXTERNAL:-0}"
DB_SUPERUSER="${DLT_DB_SUPERUSER:-postgres}"
DB_SUPERUSER_PASSWORD="${DLT_DB_SUPERUSER_PASSWORD:-}"
DB_SSLMODE="${DLT_DB_SSLMODE:-$([[ "$EXTERNAL_DB" == "1" ]] && echo disable || echo verify-ca)}"

log()  { printf '\033[0;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[0;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

need_container_cli() {
    [[ "$EXTERNAL_DB" == "1" ]] && return 0
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

# Runs psql as the external server's superuser. Only meaningful when
# EXTERNAL_DB=1 — the managed Apple-container flow never connects this way.
psql_super() {
    PGPASSWORD="$DB_SUPERUSER_PASSWORD" psql -h 127.0.0.1 -p "$DB_HOST_PORT" -U "$DB_SUPERUSER" \
        --quiet --no-psqlrc -v ON_ERROR_STOP=1 "$@"
}

container_exists() {
    [[ "$EXTERNAL_DB" == "1" ]] && return 0
    container ls --all --format json 2>/dev/null | grep -q "\"$DB_CONTAINER\""
}
container_running() {
    if [[ "$EXTERNAL_DB" == "1" ]]; then
        pg_isready -h 127.0.0.1 -p "$DB_HOST_PORT" >/dev/null 2>&1
        return $?
    fi
    container ls --format json 2>/dev/null | grep -q "\"$DB_CONTAINER\""
}
