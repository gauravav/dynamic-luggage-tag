#!/usr/bin/env bash
# Runs the browser tests against a real stack.
#
# Starts its own API and web server rather than reusing `make dev`, with two
# settings the tests need and a developer would not want by default:
#
#   DLT_MAIL_PROVIDER=console   the verification link is printed, so the suite
#                               can complete a sign-up without a mailbox
#   Turnstile unset             no human challenge in front of sign-in
#
# Everything else — the database, the keys, the rate limits — is the real
# thing. Extra arguments are passed through to Playwright.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

need_container_cli
container_running || { log "Starting the database..."; "$INFRA/scripts/db-up.sh"; }

[[ -f "$ROOT/api/.env" ]] || die "api/.env is missing. Run: make db-up"
[[ -x "$ROOT/api/.venv/bin/python" ]] || die "The Python venv is missing. Run: make deps"

API_LOG="$(mktemp -t dlt-e2e-api)"
pids=()
cleanup() {
    trap - INT TERM EXIT
    for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
    wait 2>/dev/null || true
    rm -f "$API_LOG"
}
trap cleanup INT TERM EXIT

log "Starting the API..."
# DLT_ADMIN_EMAIL is set from the account global setup registers, so the
# operator surface exists for the suite to drive. See tests/e2e/global-setup.ts.
ADMIN_EMAIL="$(cd "$ROOT/web" && node -e '
try { process.stdout.write(JSON.parse(require("fs").readFileSync("tests/e2e/.auth/account.json","utf8")).email) } catch { process.stdout.write("") }
')"

( cd "$ROOT/api" && DLT_MAIL_PROVIDER=console DLT_TURNSTILE_SITE_KEY= DLT_TURNSTILE_SECRET_KEY= \
    DLT_ADMIN_EMAIL="$ADMIN_EMAIL" \
    exec ./.venv/bin/python -m flask --app app:create_app run --port 5001 >"$API_LOG" 2>&1 ) &
pids+=($!)

log "Starting the web app..."
( cd "$ROOT/web" && exec npm run dev -- --host >/dev/null 2>&1 ) &
pids+=($!)

for _ in $(seq 1 40); do
    curl -fsS --max-time 1 http://localhost:5173/api/v1/health >/dev/null 2>&1 && break
    sleep 1
done

# localhost, not 127.0.0.1: DLT_FRONTEND_ORIGIN names that exact origin and the
# API's CSRF check compares it literally.
( cd "$ROOT/web" && DLT_API_LOG="$API_LOG" npx playwright test "$@" )
