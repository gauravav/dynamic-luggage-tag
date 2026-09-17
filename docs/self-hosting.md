# Self-hosting

## What you need

- macOS with [Apple's `container`](https://github.com/apple/container) 1.0 or
  later, for the PostgreSQL container. Any other PostgreSQL 16 works too —
  point `DATABASE_URL` at it and skip the `db-*` targets.
- Python 3.11 or later
- Node 20 or later

## From a clean checkout

```bash
make setup    # venv, dependencies, database container, migrations
make dev      # API on :5001, web app on :5173
```

`make setup` generates every secret it needs into `.secrets/` (mode 0600, and
git-ignored), builds a PostgreSQL image with a private CA and a server
certificate, starts it, and writes `api/.env`.

Open http://localhost:5173, register, and watch the API's output for the
verification link — the default mail provider prints messages instead of
sending them.

## The database container

`infra/scripts/db-up.sh` builds and runs PostgreSQL 16 with:

- **TLS required.** `pg_hba.conf` accepts `hostssl` with `scram-sha-256` and
  rejects `hostnossl` outright, so a misconfigured client fails loudly rather
  than connecting in the clear.
- **A private CA.** The API connects with `sslmode=verify-ca` against
  `infra/container/certs/ca.crt`, so a leaked connection string cannot be
  replayed against an impostor server.
- **An unprivileged role.** The app connects as `dlt_app`, which owns one
  schema and has no `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION` or
  RLS-bypass rights.
- **A managed volume.** The data directory needs POSIX ownership a macOS bind
  mount cannot provide, so the cluster lives on a `container volume` and one
  directory below the mount point (an ext4 volume root contains `lost+found`,
  which `initdb` refuses to use).

Useful targets:

```bash
make db-psql      # psql as the application role, over TLS
make db-logs      # follow the server log
make db-down      # stop the container, keep the data
make db-destroy   # delete the volume and everything in it
```

The certificates are development certificates. In production, use your
platform's managed PostgreSQL and `sslmode=verify-full` with a real CA.

## Configuration

Everything is environment variables; `api/.env` is generated with sensible
development values. The ones that matter most:

| Variable | What it does |
|---|---|
| `DLT_KEK_V1` | Key-encryption key. Wraps every account's data key. **Lose it and every encrypted column is unreadable.** |
| `DLT_KEK_ACTIVE_VERSION` | Which KEK new wraps use. See rotation in [`SECURITY.md`](../SECURITY.md). |
| `DLT_BLIND_INDEX_KEY` | Keyed HMAC for the email lookup index. Not rotatable. |
| `DLT_TOKEN_PEPPER` | HMAC key for scan, session and relay tokens. Rotating it invalidates every printed tag. |
| `DATABASE_URL` | Include `sslmode=`; required in production. |
| `DLT_PUBLIC_BASE_URL` | Origin the QR codes point at. Must be `https://` in production. |
| `DLT_COOKIE_SECURE` | Must be true in production; the app refuses to start otherwise. |
| `DLT_TRUSTED_PROXY_HOPS` | How many proxies you actually run. Read the note below. |
| `DLT_SCAN_RETENTION_DAYS` | How long scan history is kept. Default 90. |
| `DLT_RELAY_RETENTION_DAYS` | How long a finder conversation stays open. Default 30. |
| `DLT_MAIL_PROVIDER` | `console` or `smtp`. |
| `DLT_GEO_PROVIDER` | `null` or `header`. |
| `DLT_TURNSTILE_SITE_KEY`, `DLT_TURNSTILE_SECRET_KEY` | Cloudflare Turnstile bot protection. Set both or neither. See below. |

### Trusted proxy hops

`X-Forwarded-For` is attacker-controlled on the left and proxy-appended on the
right, so the client address is read by counting entries from the right. Set
`DLT_TRUSTED_PROXY_HOPS` to the number of proxies you run:

- **0** (default) — the header is ignored entirely. Correct for a directly
  exposed app. Behind a load balancer it makes rate limiting useless, because
  every request appears to come from the balancer.
- **1** — one reverse proxy or CDN in front.
- **Too high** — lets a client spoof its own address by prepending entries.

### Bot protection (Cloudflare Turnstile)

Rate limits slow a script down; they don't tell a person from a script.
Turnstile does, usually without asking the visitor to do anything.

When both keys are set, the API requires a valid Turnstile token on:

- creating an account
- signing in (including the two-factor code step)
- requesting a password reset
- resending a confirmation link
- sending a message to a bag's owner

It is deliberately **not** required to view a scan page, record a scan, or
share a city. Those carry no free text to spam, and gating them would send
every stranger who scans a bag to Cloudflare before they've chosen to do
anything. The widget, and Cloudflare's script, only load on a page with one of
the forms above.

To turn it on:

1. In the Cloudflare dashboard, open **Turnstile** and add a widget. Add your
   site's hostname. **Managed** mode is the right default.
2. Set `DLT_TURNSTILE_SITE_KEY` and `DLT_TURNSTILE_SECRET_KEY` on the API and
   restart it. The frontend reads the site key from `GET /api/v1/config`, so
   there is nothing to rebuild.
3. Add `https://challenges.cloudflare.com` to `script-src` and `frame-src` in
   the Content-Security-Policy your web server sends (the snippet under
   *Security headers in production* already includes it). **Without this the
   widget is silently blocked and nobody can sign in.**

Behaviour worth knowing:

- Each token is single-use and tied to its form: a token solved on the sign-in
  page is rejected by registration.
- If Cloudflare can't be reached, the protected actions fail with "try again"
  rather than going through unchecked.
- The API does not send the visitor's IP address to Cloudflare when verifying.
- Cloudflare's test keys (site `1x00000000000000000000AA`, secret
  `1x0000000000000000000000000000000AA`) let you check the setup end to end;
  the widget shows a red "For testing only" strip while they're in use.

### Geolocation

`null` never resolves anything, and is the right default. `header` reads city
headers a CDN already computed — it sends nothing anywhere, but it is only safe
when your edge strips those headers from client requests. Otherwise a scanner
can claim to be anywhere.

Either way, the finder must opt in before anything is stored, and nothing finer
than a city is accepted.

## Plugin points

Swap these through configuration rather than a fork:

- **Mail** — subclass `Mailer` in `api/app/services/mailer.py` and add it to
  `build_mailer`.
- **Geolocation** — subclass `GeoProvider` in `api/app/services/geo.py`.
- **Design generation** — `api/app/core/design.py` is pure and deterministic.
  Changing it changes future designs only; stored designs keep rendering as
  printed.
- **Motif geometry** — `api/app/core/motif.py` works out every mark in a
  pattern, and the print PDF draws exactly those shapes. The browser preview
  runs a port of the same code, `web/src/lib/motif.ts`. Change Python first,
  port the change, then run `make test`: `test_motif_parity.py` runs both
  versions and fails if any coordinate differs. It needs Node 22.6 or later,
  and is skipped if Node isn't available.

## Printing tags

`GET /api/v1/tags/<id>/print.pdf` returns a print-ready PDF at the standard
personalised luggage tag size:

|  | height | width |
|---|---|---|
| Bleed | 108.40 mm (4.27 in) | 74.10 mm (2.92 in) |
| Trim | 104.40 mm (4.11 in) | 70.10 mm (2.76 in) |
| Safety | 99.40 mm (3.91 in) | 65.10 mm (2.56 in) |

That is 2.00 mm of bleed outside the trim on every edge and a further 2.50 mm
of safety margin inside it. The file declares all four PDF boxes — MediaBox and
BleedBox at the bleed size, TrimBox at the trim size, ArtBox at the safety size
— so a prepress workflow knows where the cut line falls. Fonts are embedded.
Artwork runs to the bleed edge; text and the QR symbol stay inside the safety
box.

Query parameters:

- `?sides=1` — front only. The default is front and back.
- `?guides=1` — overlays the trim and safety rectangles for proofing on
  screen. Those lines are drawn into the artwork, so never send a guided PDF to
  print.

The strap hole is drawn at 5.50 mm diameter, centred 8.50 mm below the trim
edge. If your supplier punches differently, change `HOLE_DIAMETER_MM` and
`HOLE_CENTRE_FROM_TRIM_TOP_MM` in `api/app/core/print_layout.py`.

## Running it for real

Build the frontend and serve `web/dist` from any static host or CDN. Run the
API under a WSGI server:

```bash
gunicorn --chdir api --workers 4 --bind 127.0.0.1:5001 wsgi:app
```

Then:

- Terminate TLS in front of it, and set `DLT_TRUSTED_PROXY_HOPS` to match.
- Set `DLT_RATELIMIT_STORAGE_URI` to a Redis URL. The in-memory default is
  per-worker, so four workers means four times your configured limit.
- Schedule `make purge` (or `flask purge`) daily.
- Work through the production checklist in [`SECURITY.md`](../SECURITY.md), and
  run `make check` to see what the running configuration actually reports.

## Security headers in production

The dev and preview servers set the Content-Security-Policy themselves (see
`csp()` in `web/vite.config.ts`). When you serve `web/dist` from your own
static host, that plugin is not in the path — send the header yourself:

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
```

Two notes on that policy:

- It must be a **header**, not a `<meta>` tag. A meta policy silently ignores
  `frame-ancestors`, so the clickjacking rule would not apply at all.
- `style-src` allows `'unsafe-inline'` because React writes inline style
  attributes and the tag artwork computes its own fills. `script-src` does
  not, and does not need to: the production build emits no inline script.

If the API is served from a different origin than the app, add that origin to
`connect-src` and set `DLT_FRONTEND_ORIGIN` to match.

## Troubleshooting

**The page is blank.** Open the browser console. A `Refused to execute inline
script` error means a Content-Security-Policy is blocking the app — check that
nothing in front of the dev server (a proxy, a browser extension, a corporate
filter) is injecting its own policy.

**The browser will not connect at all.** If you have previously run an HTTPS
project on `localhost`, the browser may have cached an HSTS entry that forces
`https://localhost:5173`, which the dev server does not speak. Clear it at
`chrome://net-internals/#hsts` (Chrome) by deleting the `localhost` domain.

**Mail is not arriving.** Run `flask send-test-email you@example.com` from
`api/`. It prints the provider and server it is about to use before sending, so
a message that quietly went to stdout is not mistaken for one that was
delivered. With Gmail, a `535 BadCredentials` means the app password is wrong
or has spaces left in it; `DLT_SMTP_USERNAME` and `DLT_MAIL_FROM` must both be
the same full Gmail address.

**`http://127.0.0.1:5001` shows JSON.** That is the API, and it is meant to.
The app is on **http://localhost:5173**.

**`make dev` exits immediately.** It stops both processes if either one dies,
so the real error is in the first few lines of output — usually a missing
`api/.env` (run `make db-up`) or port 5001/5173 already in use.

## Operational commands

```bash
make check              # report the running security posture
make purge              # delete data past its retention window
make test               # the Python test suite
make lint               # ruff + tsc
make secrets-check      # verify no secret is tracked by git
cd api && ../api/.venv/bin/flask --app app:create_app rewrap-keys --dry-run
```
