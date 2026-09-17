# Security

## Reporting a vulnerability

Please do not open a public issue. Email the maintainers with a description,
reproduction steps, and the impact you believe it has. You will get an
acknowledgement within a few days, and credit in the release notes if you would
like it.

## A written analysis

[`docs/security-analysis.html`](docs/security-analysis.html) reviews the whole
design against the code — data at rest, authentication, sessions and CSRF, the
API surface, the public scan page and privacy — and lists nine findings with
recommendations. It is deliberately explicit about what was not examined.

## What this project protects, and from whom

The threat this product exists to address is a mundane one: a luggage tag with
your name, number and home address on it, readable by every stranger who walks
past your bag. Everything below follows from trying to remove that exposure
without making the tag useless.

| Adversary | What they can reach | What stops them |
|---|---|---|
| A stranger who scans a tag | The public scan page | Marked safe, the page contains no personal data at all. Marked lost, it contains only the fields the owner opted into — never the address. |
| Someone who steals a database dump | Every table | Personal fields are AES-256-GCM ciphertext under per-user data keys, which are themselves sealed by a key that lives only in the environment. Session, scan and relay tokens are stored as HMACs, so none of them can be replayed. |
| Scripts creating accounts, stuffing credentials or spamming owners | Sign-up, sign-in, reset, resend, finder messages | Per-client rate limits everywhere; Cloudflare Turnstile on these actions when configured, with each token single-use and bound to its action. Viewing a scan page is never gated. |
| Someone guessing scan URLs | The scan endpoint | Tokens are 256 bits of CSPRNG output. Endpoints are rate-limited per hashed client. |
| Someone trying to learn who has an account | Registration, sign-in, password reset | All three answer identically for known and unknown addresses, and the fast paths burn an equivalent Argon2 verification so response timing does not answer the question either. |
| A malicious website the owner visits | The owner's session | Session cookies are `HttpOnly`, `Secure`, `SameSite=Strict` and `__Host-` prefixed, plus an Origin check and a double-submit CSRF token. |
| Someone who finds a bag and wants the owner's number | The relay | Messages are relayed. Neither side ever receives the other's address or phone number. |
| A curious operator of the service | The database | Reads of decrypted personal data are written to an append-only audit log. Deleting an account destroys the key, not just the rows. |

## Design decisions worth knowing about

**Envelope encryption, not column encryption.** Each account has its own
256-bit data key. Personal fields are encrypted with it; the data key is stored
wrapped by a key-encryption key (KEK) held only in the process environment.
Every ciphertext is bound to its own row and column with AES-GCM associated
data, so a ciphertext cannot be moved from one row to another and decrypted.

**Account deletion is crypto-shredding.** Deleting an account overwrites the
wrapped data key before removing the rows. Any ciphertext that survives in a
replica or a backup has no path back to a plaintext, because the only key that
could open it is gone.

**Sessions are server-side, not JWTs.** A signed token the server does not
track cannot be revoked before it expires, which makes "sign out everywhere",
"sign out after a password change" and "this device was stolen" impossible to
honour. Here the cookie is an opaque random string and authority lives in a row
that can be deleted.

**Client addresses are never stored.** Rate limiting and scan deduplication use
an HMAC of the address truncated to a /24 or /48 and salted with the UTC date.
That correlates for about a day and is inert afterwards. The scan log holds no
address column at all.

**Reading a scan page has no side effects.** Recording a scan is a separate
`POST` the page makes after it renders, so link-preview bots and browser
prefetches never reach the owner's history or inbox.

**Retention is enforced, not promised.** Every scan event, relay thread and
audit row carries an `expires_at` set when it is written. `make purge` deletes
what has passed it. Run it on a schedule.

## Key management

`DLT_KEK_V<n>` wraps every data key. Losing it makes every encrypted column
permanently unreadable — that is the design, not a bug.

To rotate:

1. Generate a new key and set `DLT_KEK_V2` alongside the existing `DLT_KEK_V1`.
2. Set `DLT_KEK_ACTIVE_VERSION=2` and restart. New accounts use v2; existing
   rows still open with v1.
3. Run `flask rewrap-keys` to move every data key onto v2. Only the wrapped
   keys change, so this is fast regardless of how much data exists.
4. Once it reports zero remaining, remove `DLT_KEK_V1`.

`DLT_BLIND_INDEX_KEY` cannot be rotated without re-deriving every index, and
`DLT_TOKEN_PEPPER` cannot be rotated without invalidating every printed tag.
Treat both as permanent for a deployment.

## Production checklist

- [ ] `DLT_ENV=production` — the app refuses to start with insecure settings
- [ ] `DLT_COOKIE_SECURE=true` and the site served only over HTTPS
- [ ] `DATABASE_URL` with `sslmode=verify-full` and a real CA
- [ ] `DLT_KEK_V1`, `DLT_BLIND_INDEX_KEY`, `DLT_TOKEN_PEPPER` from a secret
      manager, never a file in the repository
- [ ] `DLT_TRUSTED_PROXY_HOPS` set to the number of proxies you actually run —
      leaving it at 0 behind a load balancer makes rate limiting useless, and
      setting it too high lets clients spoof their own address
- [ ] `DLT_RATELIMIT_STORAGE_URI` pointing at Redis, so limits are shared
      across processes rather than per-worker
- [ ] `DLT_MAIL_PROVIDER=smtp` with STARTTLS
- [ ] `make purge` on a schedule
- [ ] Run `make check` and read what it reports

## Known limitations

- Scan tokens are bearer credentials. Anyone who photographs a tag can open its
  page; that is inherent to a printed QR code. Rotate the code if a tag is
  compromised — `Issue a new code` on the tag page.
- The default `header` geolocation provider trusts headers set by an edge
  proxy. It is only safe when something upstream strips those headers from
  client requests.
- Email is not end-to-end encrypted. Notifications are deliberately vague for
  that reason — they say a tag was scanned, never which bag or what was said.
- Rate limiting defaults to in-process memory, which is per-worker. Set
  `DLT_RATELIMIT_STORAGE_URI` in any multi-process deployment.
