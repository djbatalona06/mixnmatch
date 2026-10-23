# 07 — Legal, Privacy & Security

*Not legal advice. Have a qualified lawyer review before a public launch.*

## Privacy by design (GDPR / CCPA principles)
| Principle | How mix n match does it |
|---|---|
| Data minimisation | Email + encrypted access keys + song metadata only. Only playlist/library scopes are requested — no listening history, no email from the services. |
| Purpose limitation | Data is used only to move the user's own music lists. |
| Storage limitation | Song lists deleted after 30 days; IPs removed from logs after 30 days; sign-in links/sessions purged when expired. |
| Right to erasure | *Delete my account* removes user, connections, jobs, songs, sessions, sign-in links and un-links log entries. |
| Control | *Disconnect* deletes a service's keys immediately. |

## Copyright
mix n match never hosts, streams, downloads or copies audio. It only reads and writes **lists of song metadata** through each service's official API, within each service's developer terms. No unofficial or reverse-engineered APIs are used (YouTube uses the official Data API).

## Threat model
**Main risk:** someone stealing music-service access keys.

| Defence | Where |
|---|---|
| Keys encrypted with AES-256-GCM; key in a Worker secret, never in the database; ciphertext bound to `user:service` so it can't be swapped between rows | `src/crypto.ts`, `src/connections.ts` |
| OAuth Authorization Code + **PKCE** + one-time `state` (10 min) | `src/index.ts` |
| No passwords anywhere; magic-link tokens and session ids stored only as SHA-256 hashes | `src/auth/` |
| Session cookie `HttpOnly; Secure; SameSite=Lax` | `src/auth/session.ts` |
| CSRF: changing requests need `X-Requested-With` + same `Origin` | `src/web.ts` |
| Sign-in email rate limit: 5/hour per email or IP | `src/auth/magic-link.ts` |
| Strict Content-Security-Policy, no inline scripts/styles, `frame-ancestors 'none'` | `public/_headers` |
| All page text inserted as text, never as HTML (XSS-safe) | `public/js/ui.js` → `el()` |
| Pagination cursors only followed when they point at the service's own API (and Deezer cursors are stripped of tokens) | adapters |
| Upload validation: size, song count (5,000), field lengths, ISRC format | `src/routes/jobs.ts` |
| CSV export guards against spreadsheet formula injection | `public/js/formats.js` |
| Audit log of sign-ins, connections, transfers, deletions | `audit_log` table |
| Every data query scoped to the signed-in user | routes |

## Open items before launch
- Privacy policy contact address and a data-request process.
- Spotify, Google and TIDAL app reviews may require a privacy policy URL and a demo video.
- Rotate `TOKEN_KEY` procedure (re-encrypt all rows) — not built yet.
