#!/usr/bin/env bash
# Opens a psql shell as the unprivileged application role, over TLS.
#
# Prefers the host's psql, which verifies the server certificate against our CA
# (sslmode=verify-ca). Falls back to the client inside the container when the
# host has no psql installed; that path still requires TLS and SCRAM, but it
# cannot verify the certificate chain because the CA is not mounted there.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
need_container_cli
container_running || die "The database is not running. Run: make db-up"

PASSWORD="$(secret db_app_password)"

if command -v psql >/dev/null 2>&1; then
    if [[ "$DB_SSLMODE" == "verify-ca" ]]; then
        PGPASSWORD="$PASSWORD" \
        PGSSLMODE=verify-ca \
        PGSSLROOTCERT="$CERTS/ca.crt" \
            exec psql -h 127.0.0.1 -p "$DB_HOST_PORT" -U "$DB_APP_USER" -d "$DB_NAME" "$@"
    else
        PGPASSWORD="$PASSWORD" \
        PGSSLMODE="$DB_SSLMODE" \
            exec psql -h 127.0.0.1 -p "$DB_HOST_PORT" -U "$DB_APP_USER" -d "$DB_NAME" "$@"
    fi
fi

[[ "$EXTERNAL_DB" == "1" ]] && die "psql is required on the host to connect to an external database"

warn "No psql on the host; using the client inside the container (no CA verification)."
exec container exec --interactive --tty \
    --env PGPASSWORD="$PASSWORD" --env PGSSLMODE=require \
    "$DB_CONTAINER" \
    psql -h 127.0.0.1 -p 5432 -U "$DB_APP_USER" -d "$DB_NAME" "$@"
