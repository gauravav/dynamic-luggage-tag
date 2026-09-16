#!/usr/bin/env bash
# Erases the database volume and all data in it. Requires explicit confirmation.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
need_container_cli

warn "This permanently deletes the dlt-pgdata volume and every row in it."
read -r -p "Type the database name ($DB_NAME) to confirm: " reply
[[ "$reply" == "$DB_NAME" ]] || die "Aborted."

container_running && container stop "$DB_CONTAINER" >/dev/null || true
container_exists && container rm "$DB_CONTAINER" >/dev/null || true
container volume delete dlt-pgdata >/dev/null 2>&1 || true
log "Volume deleted."
