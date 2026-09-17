#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

if [[ "$EXTERNAL_DB" == "1" ]]; then
    die "DLT_DB_EXTERNAL=1: this script does not manage that server's container. Use 'docker logs <name>' directly."
fi

need_container_cli
container logs "${1:---follow}" "$DB_CONTAINER"
