# MPES 5 — Engineering standards

> **In plain words**
> These are the quality rules. They cover keeping people's data safe, making the app usable for everyone (including people who use screen readers or bigger text), keeping it fast, testing it, and running it.
> Each rule has an ID, says **MUST** or **SHOULD**, shows whether mix n match meets it today, and says how it is checked. "Auto" means `npm test` checks it on every pull request.

Status: ✅ meets · 🟡 partly · ❌ not yet · Check: **Auto** (in CI) · **Review** (pull-request review) · **Release** (release checklist in [06](06-product-specifications.md))

---

## 5.1 Security (`SEC-*`)

| ID | Level | Rule | mix n match | Check |
|---|---|---|---|---|
| SEC-01 | MUST | No passwords. Sign-in by magic link or OAuth only | ✅ | Review |
| SEC-02 | MUST | Every OAuth flow uses Authorization Code + **PKCE** + a one-time `state` that expires (≤ 10 min) and is bound to the user | ✅ `src/index.ts` ("Connecting music services", `finishConnect`) | Auto for PKCE (`test/security.test.ts`); Review for `state` expiry and binding (no test yet → R-08) |
| SEC-03 | MUST | Session cookie: `HttpOnly; Secure; SameSite=Lax` or stricter; database stores only a hash of the session id | ✅ `src/auth/session.ts` | Auto |
| SEC-04 | MUST | Strict CSP: `default-src 'self'`, no `unsafe-inline` / `unsafe-eval`, `frame-ancestors 'none'`; plus `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY` | ✅ `vercel.json` | Auto (`test/deploy-config.test.ts`) |
| SEC-05 | MUST | No `dangerouslySetInnerHTML`, `eval` or `new Function` in app or server code | ✅ | **Auto** (`test/mpes.test.ts`) |
| SEC-06 | MUST | No secrets or local databases in git: `.env*` (except `.env.example`), `.dev.vars`, `.wrangler/`, `.data/`, `*.db`, `*.sqlite` | ✅ since this change (`AUD-03`) | **Auto** (`test/mpes.test.ts`) |
| SEC-07 | MUST | Test-only switches (`DEV_MODE`, `ENABLE_MOCK`) cannot take effect in production, **enforced in code**, not only in docs | ❌ `AUD-01` | Auto after R-01 |
| SEC-08 | MUST | Changing requests need `X-Requested-With` + same `Origin` (CSRF) | ✅ `src/web.ts` | Auto |
| SEC-09 | MUST | Rate limits on anything that sends email, costs money or searches outside services | ✅ 5 sign-in emails/hour, 30 fix searches/min | Auto |
| SEC-10 | MUST | Outside callbacks (Stripe, cron) verified by HMAC signature or secret with constant-time compare; webhooks idempotent | ✅ `src/routes/billing.ts`, `isFromVercelCron` | Auto |
| SEC-11 | MUST | Links the server sends (emails, OAuth redirect, payment returns) use a **configured** site address (`APP_ORIGIN`), never the request's `Host` | ❌ `AUD-04` | Auto after R-05 |
| SEC-12 | MUST | Another user's record answers **404**, never 403 (do not confirm it exists) | ✅ | Auto (`test/fix.test.ts`) |
| SEC-13 | SHOULD | Paging cursors and outside URLs are followed only when they point at the expected host | ✅ adapters (`startsWith(API)`) | Review |
| SEC-14 | MUST | Any request body has a byte limit at or below the host's limit (Vercel: 4.5 MB) | 🟡 `AUD-11` | Auto after R-10 |

### Encryption (`ENC-*`)

| ID | Level | Rule | mix n match |
|---|---|---|---|
| ENC-01 | MUST | Outside-service tokens encrypted with AES-256-GCM, random 96-bit IV per write, additional data binding the row (`user:service`) | ✅ `src/crypto.ts` |
| ENC-02 | MUST | The key lives only in the host's secret store; its shape is checked at start (32 bytes) | ✅ |
| ENC-03 | SHOULD | Key rotation: a `kid` per row, re-encrypt in the background, old key removable | ❌ `AUD-09` → R-09 |

### Privacy (`PRIV-*`)

| ID | Level | Rule | mix n match |
|---|---|---|---|
| PRIV-01 | MUST | Ask outside services for the smallest scopes that do the job | ✅ |
| PRIV-02 | MUST | Retention windows in code match the privacy page (song lists 30 days, IPs 30 days, audit log 1 year) | ✅ `cleanup()` |
| PRIV-03 | MUST | "Delete my account" removes every row about the person, cancels any payment first, and is tested | ✅ (`job_runs` gap, `AUD-06`) |
| PRIV-04 | MUST | Analytics without cookies, never on pages whose address holds a secret | ✅ `chrome.tsx` |
| PRIV-05 | MUST | Never copy, host or stream copyrighted media; official APIs only | ✅ |

---

## 5.2 Accessibility (`A11Y-*`) — target **WCAG 2.2 AA**

| ID | Level | Rule | mix n match | Check |
|---|---|---|---|---|
| A11Y-01 | MUST | Text contrast ≥ 4.5:1 (≥ 3:1 for large text and icons that carry meaning) in every theme | ✅ fg/bg and muted/bg pass | Review |
| A11Y-02 | MUST | Everything works with a keyboard; focus is always visible | 🟡 focus style in `index.css`; no automatic test | Auto after R-11 |
| A11Y-03 | MUST | Touch targets ≥ 44 × 44 px | ✅ measured by `npm run layout:check` | Auto (layout) |
| A11Y-04 | MUST | Every input has a label; icon-only buttons have `aria-label`; decorative icons `aria-hidden` | 🟡 mostly | Auto after R-11 |
| A11Y-05 | MUST | No horizontal scroll at 320 px; text can grow to 200% | ✅ layout check at 3 widths | Auto (layout) |
| A11Y-06 | MUST | Honour `prefers-reduced-motion` | ✅ `app/src/index.css:141` | Review |
| A11Y-07 | MUST | Live progress and toasts are announced (`aria-live`) | 🟡 check in R-11 | Auto after R-11 |
| A11Y-08 | SHOULD | Plain language (school-age reading level); error messages say what to do next | ✅ house style | Review |

---

## 5.3 Performance (`PERF-*`)

| ID | Level | Rule | mix n match (measured 2 Nov 2026) |
|---|---|---|---|
| PERF-01 | MUST | First-load JavaScript ≤ **120 kB gzip**; CSS ≤ 20 kB gzip | ✅ 84.9 kB JS, 6.6 kB CSS |
| PERF-02 | MUST | Core Web Vitals at the 75th percentile on phones: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 (Vercel Speed Insights) | ⏳ needs live data |
| PERF-03 | MUST | Hashed assets cached 1 year `immutable`; `index.html`, `sw.js`, manifest `no-cache` | ✅ `vercel.json`, Auto |
| PERF-04 | MUST | Long work runs as small resumable steps, never in one request | ✅ job runner |
| PERF-05 | SHOULD | A database step uses a bounded number of queries (bulk `json_each` inserts) | ✅ tests assert per-step query counts |
| PERF-06 | SHOULD | A 1,000-song transfer finishes in < 5 min when services are not limiting (PRD) | ✅ smoke test moves 1,060 demo songs |
| PERF-07 | SHOULD | Split screens into separate files once JS passes 100 kB gzip | n/a yet |

---

## 5.4 Reliability (`REL-*`)

| ID | Level | Rule | mix n match |
|---|---|---|---|
| REL-01 | MUST | Obey 429 + `Retry-After`; pause long waits instead of holding a request | ✅ `src/http.ts`, runner |
| REL-02 | MUST | Jobs are claimed with a lease so two workers never run the same step | ✅ `claimDueRun` |
| REL-03 | MUST | Writes are idempotent: retrying never duplicates (songs, webhooks, migrations) | ✅ songs, webhooks · 🟡 migrations (`AUD-05`) |
| REL-04 | MUST | A job stops after a fixed number of errors in a row, with a message the user understands | ✅ `MAX_ERRORS = 5` |
| REL-05 | MUST | Preview deployments can never change production data | ❌ `AUD-02` → R-02 |

---

## 5.5 Testing (`TEST-*`)

| ID | Level | Rule | mix n match |
|---|---|---|---|
| TEST-01 | MUST | CI on every pull request runs: types (server + app), unit tests, app build. Red CI = no merge | ✅ `.github/workflows/ci.yml` |
| TEST-02 | MUST | Every outside service adapter has fake-reply tests for paging, errors, 401 refresh and 429 | ✅ `test/adapters.test.ts` |
| TEST-03 | MUST | Security rules have tests (CSRF, ownership, PKCE state, token hashing, webhook signature) | ✅ `test/security.test.ts`, `test/billing.test.ts` |
| TEST-04 | MUST | Deploy config and MPES rules are tests (`test/deploy-config.test.ts`, `test/mpes.test.ts`) | ✅ |
| TEST-05 | MUST | A browser smoke test walks the main path end to end against a local server | ✅ `npm run smoke` (manual today) |
| TEST-06 | MUST | A read-only smoke test runs against every successful deploy | ✅ `.github/workflows/smoke-deploy.yml` |
| TEST-07 | SHOULD | Layout check on every screen × 3 widths runs in CI | 🟡 exists, not in CI → R-11 |
| TEST-08 | SHOULD | Each real adapter verified once with a real account before launch, and the date recorded | ❌ owner task (docs/06 2.6) |
| TEST-09 | MUST | Never skip, delete or weaken a test to make CI green | Review |

---

## 5.6 Operations (`OPS-*`)

| ID | Level | Rule | mix n match |
|---|---|---|---|
| OPS-01 | MUST | Every env var the code reads is listed in `.env.example` with a comment | ✅ since this change (`EMAIL_FROM` added) · **Auto** |
| OPS-02 | MUST | Alerts reach a person for: 5xx spike, cron not run for 10 min, webhook failures, job failure rate > 5% | ❌ `AUD-07` → R-07 |
| OPS-03 | MUST | Logs never contain tokens, sign-in links or full emails in production | 🟡 dev link logged only in `DEV_MODE` (`magic-link.ts:44`) |
| OPS-04 | SHOULD | A written release checklist and rollback step (Vercel "Promote" previous deploy) | ❌ → R-13 |

## 5.7 Dependencies (`DEP-*`)

| ID | Level | Rule | mix n match |
|---|---|---|---|
| DEP-01 | MUST | Runtime dependencies stay ≤ **12**. Adding one needs a reason in the PR; prefer `fetch` + Web Crypto over SDKs | ✅ 9 · **Auto** |
| DEP-02 | MUST | `npm audit --omit=dev` has no high or critical findings at release | ✅ 0 |
| DEP-03 | SHOULD | Dev-tool advisories reviewed monthly | 🟡 50 open in dev tools |
| DEP-04 | MUST | `package-lock.json` committed; CI uses `npm ci` | ✅ |

## 5.8 Code and docs (`ARC-*`, `DOC-*`)

| ID | Level | Rule |
|---|---|---|
| ARC-01 | MUST | Extract a shared package only when a second product needs it |
| ARC-02 | MUST | Outside services sit behind one adapter contract; product code never calls a service directly |
| ARC-03 | MUST | All limits and prices in one file (`src/plans.ts`) |
| ARC-04 | MUST | Background work is a saved state machine (`spec` + `state` JSON), not in-memory |
| ARC-05 | SHOULD | Known shortcuts are marked in code with `ponytail:` and what would make them worth fixing |
| DOC-01 | MUST | Every spec and standard starts with an "In plain words" box · **Auto** for `docs/mpes/` |
| DOC-02 | MUST | Docs are updated in the same PR as the code they describe |
| DOC-03 | MUST | Every new feature has the six docs: PRD, TRD, App flow, UI/UX brief, Backend schema, Implementation plan (as in `docs/08`–`11`) |
| DOC-04 | MUST | Competitor and price facts carry a link and a "read on" date before they are used |
