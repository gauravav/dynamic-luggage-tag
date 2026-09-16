#!/usr/bin/env bash
# Runs the API and the web dev server together, and stops both on Ctrl-C.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

need_container_cli
container_running || { log "Starting the database..."; "$INFRA/scripts/db-up.sh"; }

[[ -f "$ROOT/api/.env" ]] || die "api/.env is missing. Run: make db-up"
[[ -x "$ROOT/api/.venv/bin/python" ]] || die "The Python venv is missing. Run: make deps"

pids=()
cleanup() {
    trap - INT TERM EXIT
    for pid in "${pids[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

( cd "$ROOT/api" && exec ./.venv/bin/python -m flask --app app:create_app run --port 5001 ) &
pids+=($!)

( cd "$ROOT/web" && exec npm run dev -- --host 127.0.0.1 ) &
pids+=($!)

# Wait for the web server before printing, so the address is the last thing on
# screen rather than being buried under both servers' start-up output.
for _ in $(seq 1 30); do
    curl -fsS --max-time 1 http://127.0.0.1:5173/ >/dev/null 2>&1 && break
    sleep 1
done

printf '\n'
printf '\033[0;32m  ┌────────────────────────────────────────────┐\033[0m\n'
printf '\033[0;32m  │\033[0m  Open  \033[1mhttp://localhost:5173\033[0m                │\033[0;32m\n'
printf '  │\033[0m  The API on :5001 serves JSON, not the app. \033[0;32m│\033[0m\n'
printf '\033[0;32m  └────────────────────────────────────────────┘\033[0m\n'
printf '\n'

# macOS ships bash 3.2, which has no `wait -n`. Poll instead, so that if
# either process exits the trap tears the other one down with it.
while true; do
    for pid in "${pids[@]}"; do
        kill -0 "$pid" 2>/dev/null || {
            warn "A process exited; shutting the other one down."
            exit 1
        }
    done
    sleep 1
done
