#!/usr/bin/env bash
# Stops the database container. Data survives in the dlt-pgdata volume.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
need_container_cli

if container_running; then
    log "Stopping $DB_CONTAINER..."
    container stop "$DB_CONTAINER" >/dev/null
fi
if container_exists; then
    container rm "$DB_CONTAINER" >/dev/null
fi
log "Stopped. Volume dlt-pgdata retained — use db-destroy.sh to erase it."
