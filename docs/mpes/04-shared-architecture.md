# MPES 4 — Shared architecture

> **In plain words**
> Many parts of mix n match are not really about music: signing in with an email link, locking away other apps' keys, doing long jobs in small steps, free vs. paid plans, deleting old data, and the installable app frame.
> A new MixNMatch product should **reuse** those parts instead of building them again. This page lists them, where they live today, and where they would live in a shared "platform" repo later.
> **Do not move any files yet.** Pull a part out only when a second product actually needs it (rule `ARC-01`).

## 4.1 Reference architecture (exists ✅)

```
Phone / browser (PWA: React + Vite, service worker never answers /api/*)
        │  same origin, cookie session, X-Requested-With header
        ▼
Vercel: static dist/  +  one function  api/[...path].ts  ──►  src/index.ts (router)
        │                                   │
        │                                   ├─ auth/        magic link, sessions
        │                                   ├─ connections  encrypted third-party tokens
        │                                   ├─ adapters/    one contract, one file per service
        │                                   ├─ routes/      jobs, fix, syncs, billing
        │                                   └─ jobs/        engine (steps) + runner (lease)
        ▼                                   ▼
Vercel Cron (every minute) ──► /api/cron/tick        Turso / libSQL (SQLite)
                                                     Stripe · Resend · music APIs
```

## 4.2 Reusable building blocks

| Block | What it gives a product | Where it lives today | Future package (📝) | Music-specific? |
|---|---|---|---|---|
| **Passwordless auth** | Magic links (hashed, 15 min, single use, 5/hour), hashed 30-day sessions, `requireUser` | `src/auth/` | `packages/authentication` | No |
| **Request guard** | Same-origin + `X-Requested-With` check, JSON body limit, error → JSON mapping | `src/web.ts`, `errorResponse()` in `src/index.ts` | `packages/authentication` (guard) + `packages/api-client` | No |
| **Crypto helpers** | AES-256-GCM with row-bound context, PKCE, random tokens, SHA-256 | `src/crypto.ts` | `packages/authentication` | No |
| **Third-party connections** | Encrypted token store, refresh-before-expiry, retry once on 401 | `src/connections.ts` | `packages/connections` | No |
| **Resilient HTTP** | Backoff, `Retry-After`, typed `RateLimitError` / `QuotaError` / `AuthError` / `ApiError` | `src/http.ts` | `packages/api-client` (server side) | No |
| **Adapter contract** | One interface per external service; registry decides which are switched on from env vars | `src/adapters/types.ts`, `registry.ts` | stays per product; the **pattern** is the standard | Contract yes, pattern no |
| **Job runner** | Lease-based claim, small resumable steps, pause/resume on limits, max-error stop | `src/jobs/runner.ts` | `packages/jobs` | No (the engine's steps are) |
| **Plans + billing** | One limits table; Stripe Checkout/Portal by `fetch`; signed, idempotent webhook | `src/plans.ts`, `src/routes/billing.ts` | `packages/billing` | No |
| **Privacy clean-up** | Retention windows in one function, run daily | `cleanup()` in `src/index.ts` | `packages/privacy` | Table names only |
| **Audit log** | Who did what, IP removed after 30 days | `audit()` in `src/web.ts` | `packages/analytics` (server events) | No |
| **DB access + migrations** | D1-style API over libSQL; numbered SQL files applied on build | `src/db.ts`, `scripts/migrate.mjs` | `packages/database` | No |
| **App shell** | Layouts, tab bar, offline bar, toasts, install card, error boundary | `app/src/components/` | `packages/shared-components` | No |
| **Design tokens** | Colours as CSS variables (`R G B`), radii, shadows; Tailwind reads them | `app/src/index.css`, `app/tailwind.config.js` | `packages/design-system` | No (values are brand) |
| **API client** | One `api()` with header, offline message, 401 → login, paging helper | `app/src/lib/api.ts` | `packages/api-client` | No |
| **Validation** | `str()`, `cleanFileTracks()`, `normalizeEmail()`, ISRC pattern | `src/routes/jobs.ts`, `src/auth/magic-link.ts` | `packages/validation` | Partly |
| **Deploy checks** | Tests that read `vercel.json` and fail CI on bad config | `test/deploy-config.test.ts`, `test/mpes.test.ts` | `standards/` checks reused by each app | No |

## 4.3 Shared conventions (every product MUST follow)

### API (`API-*`)

| ID | Rule | mix n match |
|---|---|---|
| API-01 | All server routes live under `/api/`. Everything else is the app | ✅ `vercel.json` rewrite |
| API-02 | JSON in, JSON out, `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store` | ✅ `json()` in `src/web.ts` |
| API-03 | Errors are `{ "error": "<sentence a user can read>" }` with the right status: 400 bad input, 401 not signed in, 403 blocked, 404 not found **or not yours**, 409 conflict/limit, 413 too big, 429 too many, 502/503 outside service trouble, 500 our fault | ✅ (`AUD-08` is the exception) |
| API-04 | Changing requests need `X-Requested-With: <product>` and a matching `Origin` | ✅ `requireSameOrigin` |
| API-05 | Lists use `{ items, next }` cursor paging; the client passes `next` back as `cursor` | ✅ `Page<T>` |
| API-06 | IDs are UUID v4 strings (or the outside service's own id); times are integers, **milliseconds since 1970, UTC** | ✅ |
| API-07 | Calls from outside services (Stripe, cron) are checked by signature or secret, never by cookie | ✅ |

### Data (`DATA-*`)

| ID | Rule |
|---|---|
| DATA-01 | Schema changes only through numbered, forward-only files in `migrations/` (`NNNN_name.sql`, no gaps). Never edit an applied file |
| DATA-02 | Every user-owned table has `user_id` (or reaches one through a parent) and every query filters on it |
| DATA-03 | Secrets from outside services are stored encrypted (`ENC-*` in [05](05-engineering-standards.md)); one-time tokens and session ids are stored only as hashes |
| DATA-04 | Each table that holds personal data has a retention window written in `cleanup()` and in the privacy page |
| DATA-05 | Status columns use UPPER_CASE words listed in a comment in the migration (`QUEUED, RUNNING, …`) |
| DATA-06 | Database rules the code relies on (foreign keys, cascades) are switched on the same way in tests and production |

## 4.4 Proposed platform repo (📝 later, not now)

The structure proposed in the MPES brief, with what would move into each folder from mix n match:

```
mixnmatch-platform/
├── apps/
│   ├── mixnmatch/                 ← today's app/, src/routes, src/adapters, src/matcher, src/jobs/engine.ts
│   ├── product-two/
│   └── product-three/
├── packages/
│   ├── design-system/             ← app/src/index.css tokens, tailwind.config.js, ui.tsx primitives
│   ├── authentication/            ← src/auth/, src/crypto.ts, requireSameOrigin
│   ├── shared-components/         ← app/src/components/{chrome,InstallCard,ErrorBoundary}.tsx
│   ├── api-client/                ← app/src/lib/api.ts, src/http.ts
│   ├── validation/                ← str(), normalizeEmail(), body limits
│   └── analytics/                 ← audit(), Vercel Analytics wrapper (privateUrl filter)
│   (also: connections/, jobs/, billing/, database/, privacy/ — see 4.2)
├── infrastructure/
│   ├── deployment/                ← vercel.json template, scripts/migrate.mjs
│   ├── monitoring/                ← 📝 alerts (R-07)
│   └── security/                  ← CSP + header template, secret list
├── standards/                     ← this folder (docs/mpes) + test/mpes.test.ts
└── documentation/
    ├── product-specifications/    ← docs/01–11 per product
    ├── api-documentation/         ← 📝 generated from the router
    └── release-process/           ← 📝 R-13
```

**When to start (`ARC-01`):** the day a second product is approved. Until then, packages would have one user and only slow changes down. Use npm workspaces (no new tool) when it happens.
