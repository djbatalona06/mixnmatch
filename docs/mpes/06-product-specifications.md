# MPES 6 — Product specifications (what every MixNMatch product must have)

> **In plain words**
> Before any MixNMatch product goes live, it must tick every box on this page.
> The list is short on purpose: sign-in, keeping data safe, deleting data, working on phones and with screen readers, being fast, being tested, and being watched so problems are spotted.
> The right-hand column shows how mix n match does today, so you can see the gaps at a glance.

## 6.1 Baseline requirements

| ID | Requirement | Done when | Rules | mix n match |
|---|---|---|---|---|
| PS-01 | **Passwordless sign-in** with emailed one-time links, sent from the product's own domain | A new email address can sign in in < 1 minute; link works once, expires in 15 min | SEC-01, SEC-03, SEC-09 | ✅ (domain: owner) |
| PS-02 | **Test switches off in production** | Setting `DEV_MODE=1` or `ENABLE_MOCK=1` on production has no effect, proven by a test | SEC-07 | ❌ R-01 |
| PS-03 | **Outside accounts by OAuth + PKCE**; tokens encrypted; disconnect deletes them at once | Security tests pass; disconnect removes the row | SEC-02, ENC-01 | ✅ |
| PS-04 | **One configured site address** for every link the server creates | `APP_ORIGIN` set; tests prove a wrong `Host` cannot change links | SEC-11 | ❌ R-05 |
| PS-05 | **Plans in one place**; payments hosted by Stripe; webhook signed and idempotent; cancelling is self-serve | Billing tests pass; Customer Portal reachable from Account | ARC-03, SEC-10 | ✅ (Stripe account: owner) |
| PS-06 | **Privacy**: retention windows enforced daily; account deletion complete and tested; privacy page matches code | `cleanup()` and deletion tests pass; privacy page lists every processor | PRIV-01…05 | ✅ (`job_runs` gap R-06) |
| PS-07 | **Installable app**: manifest, icons (incl. maskable), service worker that never answers `/api/*`, opens offline | Smoke test checks all four | PERF-03 | ✅ |
| PS-08 | **Accessible** to WCAG 2.2 AA | Automatic accessibility check has 0 serious/critical issues on every screen; keyboard walk-through done | A11Y-01…08 | 🟡 R-11 |
| PS-09 | **Phone-first layout**, no sideways scroll from 320 px, 44 px targets | `npm run layout:check` passes | A11Y-03, A11Y-05 | ✅ |
| PS-10 | **Fast**: within the JS/CSS budget; Web Vitals green on phones | Build sizes under budget; Speed Insights green for 28 days | PERF-01, PERF-02 | ✅ / ⏳ |
| PS-11 | **Long work resumes**: background jobs survive restarts, rate limits and quotas | Cancel/retry and runner tests pass | PERF-04, REL-01…04 | ✅ |
| PS-12 | **Safe deploys**: previews cannot touch production data; migrations all-or-nothing | Preview uses its own database or skips migrations; failed migration leaves no change | REL-03, REL-05 | ❌ R-02, R-06 |
| PS-13 | **Tested**: CI green (types, unit, deploy + MPES checks, build); live smoke test after each deploy | Both workflows green on `main` | TEST-01…06 | ✅ |
| PS-14 | **Watched**: alerts for errors, stuck cron, webhook failures | A broken cron pages someone within 15 minutes | OPS-02 | ❌ R-07 |
| PS-15 | **Clear words**: every screen and error in plain language; every doc starts "In plain words" | Review + `test/mpes.test.ts` | A11Y-08, DOC-01 | ✅ |
| PS-16 | **Six planning docs** for each product and each feature version | Docs 01–06 exist and match the code | DOC-02, DOC-03 | ✅ (drift fixed in this change) |
| PS-17 | **Legal**: terms, privacy policy with a contact, lawyer review before charging money | Contact address on both pages; review recorded | — | ❌ owner (docs/07 open items) |

## 6.2 Release checklist (copy into each release PR)

```
Release checklist — <product> <version>
[ ] CI green on the release commit (types, tests, build)
[ ] npm audit --omit=dev: no high/critical
[ ] New migrations tested on a copy of production (or preview database)
[ ] Production env: DEV_MODE and ENABLE_MOCK unset; APP_ORIGIN set
[ ] Privacy page updated if data, processors or retention changed
[ ] Layout check + accessibility check pass
[ ] After deploy: smoke:deploy green; alerts quiet for 30 minutes
[ ] Rollback plan: previous deployment id noted (Vercel → Deployments → Promote)
```

## 6.3 Product-specific additions for mix n match

| ID | Requirement | Status |
|---|---|---|
| MM-01 | Match rate > 95% on mainstream songs; every song gets Matched / Need a look / Not found | ✅ matcher tests; real-world rate to be measured after launch |
| MM-02 | Each real adapter verified with a real account, date recorded in `docs/02-trd.md` | ❌ owner (TEST-08) |
| MM-03 | YouTube quota guarded (9,000 / day budget) and explained to users | ✅ |
| MM-04 | Spotify extended quota requested before public launch (5-user limit) | ❌ owner |
