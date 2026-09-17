# Dynamic Luggage Tag

Encrypted, privacy-first digital luggage tags. Every traveler gets one unique visual design and a QR code — the QR stays private by default and only reveals contact info once the owner marks a bag as lost.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPLv3-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-working%20build-brightgreen.svg)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## What it does

- Generates one unique pattern + QR code per user, used across all their luggage
- The pattern covers the whole tag, so a bag is recognisable down the length of a carousel
- Each tag can carry a bag icon — suitcase, carry-on, duffel, backpack and so on — in a colour of its own
- Public scan page — no login required for the person who finds a bag
- Owner controls disclosure: nothing personal is shown until the bag is reported **Lost**, and
  even then the name is released into one conversation rather than published to whoever holds the link
- One-time, city-level location capture on scan (opt-in for the finder)
- Owner gets notified by email/push whenever their tag is scanned
- Masked contact relay — finders can message the owner without ever seeing a raw phone number or email
- All personal data encrypted at rest and in transit

## Why

Standard luggage tags force a bad trade-off: either they're blank and useless for identifying your bag, or they permanently expose your name, number, and address to anyone who glances at them. This flips that — the tag is only ever "on" when you've told it something is actually wrong.

## How it works

1. **Sign up** — enter your name, phone, email (address stays internal, used only for shipping physical tags if ordered)
2. **Get your design** — a unique pattern and QR code, generated once, reused across every bag you own
3. **Someone scans it** — they land on a public status page; if you haven't reported the bag lost, they see nothing personal
4. **You decide** — flip the bag to "Lost" in the app, and a finder can message you. Reply, and
   your name is released to that conversation. Someone who saved the link earlier and has been
   waiting for the status to change gets no more than "this bag is reported lost"

## Self-hosted vs. managed

This project follows an **open-core** model — the core logic is open source; hosting and a few premium integrations are how the project sustains itself.

| | Self-hosted (this repo) | Managed (hosted by us) |
|---|---|---|
| Setup | Clone, configure, deploy | Sign up and go |
| Data control | You hold your own keys and database | We manage it, still encrypted |
| Contact relay | Bring your own SMS/email provider | Built in |
| Physical tags | Print your own | Order directly |
| Cost | Free — your own infrastructure | Subscription or per-tag fee |

Everything that differs between the two modes is controlled through configuration, not code forks — see [`docs/self-hosting.md`](docs/self-hosting.md).

## Architecture

- `api/` — Flask + SQLAlchemy. The open-source core lives in `api/app/core/`
  (design generator, QR encoding, print layout); the security primitives live
  in `api/app/security/` (envelope encryption, sessions, CSRF, audit, privacy).
- `web/` — React + Vite + TypeScript. Owner dashboard, public scan page, and
  the finder's side of the message relay.
- `infra/` — PostgreSQL 16 in an [Apple container](https://github.com/apple/container),
  TLS-only, with a private CA and an unprivileged application role.

Plugin points are intentional — mail provider, geolocation provider and design
generator are each swappable through configuration rather than a fork. See
[`docs/self-hosting.md`](docs/self-hosting.md).

## Getting started

```bash
make setup    # venv, dependencies, database container, migrations
make dev      # API on :5001, web app on :5173
```

`make setup` generates every secret into `.secrets/`, builds a PostgreSQL image
with its own CA, starts it, and writes `api/.env`. Open http://localhost:5173
and register — the default mail provider prints the verification link to the
API's output rather than sending it.

`make help` lists everything else.

## Printing

Every tag exports as a print-ready PDF at the standard personalised luggage tag
size — 108.40 × 74.10 mm at the bleed, trimming to 104.40 × 70.10 mm, with a
99.40 × 65.10 mm safety area. All four PDF boxes are declared, fonts are
embedded, and the artwork runs to the bleed edge. Add `?guides=1` to proof the
trim and safety lines on screen.

Both faces print. The motif runs edge to edge on each of them, with plates of
plain colour only where something has to be read — the name plate, the strap
punch, and, on the back, a marked circle for a 25 mm round NFC sticker. The
app previews both faces, so what goes on the bag is what was on screen.

## NFC

A tag's link can be written to an NFC sticker (NTAG213/215/216) so a phone
opens it with a tap. Writing from the browser needs Web NFC, which only Chrome
on Android implements; an iPhone writes the same sticker from an app such as
NFC Tools or NXP's TagWriter, and the app copies the link out for you and takes
the chip's serial back afterwards so the sticker stays claimed to your account.

Holding a written sticker against the phone from the tag list answers the
question the tag exists for — which bag is this? — by scrolling to it and
setting it swinging.

## Security & privacy

- QR codes encode a random 256-bit token — never a name, a number, or anything else
- Every account has its own data key; personal fields are AES-256-GCM sealed with it,
  and the data key is itself sealed by a key held only in the environment
- Each ciphertext is bound to its own row and column, so one cannot be moved and decrypted
- A saved scan link is worth nothing later: the name is released per conversation, and a replaced
  code never releases it at all — so rotating a code costs nothing and does not need a reprint
- Deleting an account destroys that key, so anything left in a backup can never be read
- The address is never shown to a finder, at any setting
- Scanner IP addresses are never stored — only a day-salted hash of a truncated subnet
- Registration, sign-in and password reset are enumeration-resistant in body and in timing
- Sessions are server-side and revocable: `HttpOnly`, `Secure`, `SameSite=Strict`, `__Host-`
- Optional TOTP two-factor with single-use recovery codes
- Scan history, conversations and audit rows expire and are hard-deleted
- Authentication, account changes and profile reads are written to an append-only audit log

Threat model, key rotation and the production checklist:
[`SECURITY.md`](SECURITY.md). A full written review of the above — including
what it does *not* cover, and nine findings with recommendations — is in
[`docs/security-analysis.html`](docs/security-analysis.html).

Found a security issue? Please do not open a public issue — see `SECURITY.md`
for disclosure.

## Contributing

Contributions are welcome — new design generators, contact-relay integrations (WhatsApp, Signal, etc.), regional compliance modules, or bug fixes. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, coding conventions, and the PR process.

## License

Core logic is licensed under **AGPL-3.0** — see [`LICENSE`](LICENSE). This means if you run a modified version of this project as a network service, you're required to make your changes available too. Hosted/managed-service components (physical tag fulfillment, our own contact-relay infrastructure) are separate and not covered by this repo.

## Topics

`luggage-tag` `qr-code` `travel` `lost-and-found` `privacy` `open-source` `agpl` `self-hosted` `pwa`
