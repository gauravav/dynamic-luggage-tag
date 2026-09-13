# Dynamic Luggage Tag

Encrypted, privacy-first digital luggage tags. Every traveler gets one unique visual design and a QR code — the QR stays private by default and only reveals contact info once the owner marks a bag as lost.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPLv3-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-concept-lightgrey.svg)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## What it does

- Generates one unique pattern + QR code per user, used across all their luggage
- Public scan page — no login required for the person who finds a bag
- Owner controls disclosure: contact info is hidden until the bag is reported **Lost**
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
4. **You decide** — flip the bag to "Lost" in the app, and the scan page now shows your name and a masked contact option

## Self-hosted vs. managed

This project follows an **open-core** model — the core logic is open source; hosting and a few premium integrations are how the project sustains itself.

| | Self-hosted (this repo) | Managed (hosted by us) |
|---|---|---|
| Setup | Clone, configure, deploy | Sign up and go |
| Data control | You hold your own keys and database | We manage it, still encrypted |
| Contact relay | Bring your own SMS/email provider | Built in |
| Physical tags | Print your own | Order directly |
| Cost | Free — your own infrastructure | Subscription or per-tag fee |

Everything that differs between the two modes is controlled through configuration, not code forks — see [`config.example.yaml`](config.example.yaml).

## Architecture

- `core/` — design generator, QR/token logic, lost/safe state machine (the open-source heart of the project)
- `api/` — REST/GraphQL backend, auth, encrypted storage layer
- `web/` — public scan page + owner dashboard (web)
- `mobile/` — owner app (iOS/Android)
- `plugins/` — swappable providers: notification channels, contact-relay backends, storage backends, design generators

Plugin points are intentional — you can swap in your own SMS provider, storage backend, or even design-generation algorithm without touching core logic.

## Getting started (self-hosted)

```bash
git clone https://github.com/<your-org>/dynamic-luggage-tag.git
cd dynamic-luggage-tag
cp config.example.yaml config.yaml
# fill in your database, notification provider, and contact-relay settings
docker compose up
```

Full setup docs live in [`/docs/self-hosting.md`](docs/self-hosting.md).

## Security & privacy

- QR codes encode a random token, never raw personal data
- All PII (name, address, phone, email) encrypted at rest (AES-256) and in transit (TLS)
- Address is never shown to finders, even when a bag is marked lost
- Contact is always relayed through the app — raw numbers/emails are never exposed
- Scan and location logs auto-expire (default: 90 days, configurable)
- Access to decrypted PII is logged for audit

Found a security issue? Please don't open a public issue — see [`SECURITY.md`](SECURITY.md) for responsible disclosure.

## Contributing

Contributions are welcome — new design generators, contact-relay integrations (WhatsApp, Signal, etc.), regional compliance modules, or bug fixes. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, coding conventions, and the PR process.

## License

Core logic is licensed under **AGPL-3.0** — see [`LICENSE`](LICENSE). This means if you run a modified version of this project as a network service, you're required to make your changes available too. Hosted/managed-service components (physical tag fulfillment, our own contact-relay infrastructure) are separate and not covered by this repo.

## Topics

`luggage-tag` `qr-code` `travel` `lost-and-found` `privacy` `open-source` `agpl` `self-hosted` `pwa`
