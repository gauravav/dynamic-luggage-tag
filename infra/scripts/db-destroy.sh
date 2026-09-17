#!/usr/bin/env bash
# Erases the database volume and all data in it. Requires explicit confirmation.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

if [[ "$EXTERNAL_DB" == "1" ]]; then
    [[ -n "$DB_SUPERUSER_PASSWORD" ]] || die "DLT_DB_SUPERUSER_PASSWORD is required when DLT_DB_EXTERNAL=1"
    warn "This permanently drops the $DB_NAME and ${DB_NAME}_test databases (and the $DB_APP_USER role) on the external server. The server itself is left running."
    read -r -p "Type the database name ($DB_NAME) to confirm: " reply
    [[ "$reply" == "$DB_NAME" ]] || die "Aborted."

    psql_super -d postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\"" >/dev/null
    psql_super -d postgres -c "DROP DATABASE IF EXISTS \"${DB_NAME}_test\"" >/dev/null
    psql_super -d postgres -c "DROP ROLE IF EXISTS \"$DB_APP_USER\"" >/dev/null
    log "Databases dropped."
    exit 0
fi

need_container_cli

warn "This permanently deletes the dlt-pgdata volume and every row in it."
read -r -p "Type the database name ($DB_NAME) to confirm: " reply
[[ "$reply" == "$DB_NAME" ]] || die "Aborted."

container_running && container stop "$DB_CONTAINER" >/dev/null || true
container_exists && container rm "$DB_CONTAINER" >/dev/null || true
container volume delete dlt-pgdata >/dev/null 2>&1 || true
log "Volume deleted."
