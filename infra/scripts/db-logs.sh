#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
need_container_cli
container logs "${1:---follow}" "$DB_CONTAINER"
