# DayFlow QA — "Production Ready" Round: Coverage & Findings — 2026-09-17

Three commits landed on `main` since the last round (`967a679`, 2026-09-16), explicitly framed as
making the app production-ready: a large hardening push (Helmet, strict CORS, a decoupled
migration script, an HTTPS reverse-proxy config, graceful shutdown, error-message masking), plus a
new date-specific Daily Journal note sheet. This round analyzed all of it, added coverage
(including a dedicated environment to verify the parts that only activate in
`NODE_ENV=production`), ran a full regression, and additionally smoke-tested the actual production
Docker deployment path end-to-end rather than trusting it from source alone. **2 new findings** —
one a real data-loss race, the other a weak default secret in the shipped production template.

| | |
|---|---|
| **Prepared** | 2026-09-17 |
| **Commit tested** | `64741945092ab09bf39fc2ec9c7ae4fed32f3f6b` |
| **Previous pin** | `967a679a0851157c9049f85c7d7766ab5c155f74` |
| **Pin status** | Still a raw commit SHA — no tag past `v2.3.0` (sixth time this has come up, now with a "production ready" claim riding on an untagged commit) |
| **Environment** | `dayflow-qa`'s isolated stack (own Postgres/API/nginx, ports 5543/5100/8280), plus two opt-in `NODE_ENV=production` containers for this round only (see [Method](#method)) |

---

## Summary

**114 of 114 regular-suite checks passed** (90 API + 24 E2E), each run twice for stability, plus a
separate **6/6** on the dedicated production-mode verification (kept out of the main count — see
why in [Method](#method)). The actual `docker-compose.prod.yml` deployment path was also built and
run end-to-end outside of Vitest/Playwright entirely, as a genuine smoke test of the "production
ready" claim rather than a source-review-only judgment — it works.

| Layer | Passed | Total |
|---|---|---|
| API / integration (`api/`) | 90 | 90 |
| Web / Playwright (`e2e/`) | 24 | 24 |
| **Regular suite total** | **114** | **114** |
| Production-mode verification (opt-in, separate) | 6 | 6 |

---

## What changed since the last test, and what got covered

### 1. Production hardening (commit `1be7769`)
`server.ts` gained Helmet (security headers + CSP), stricter CORS (`credentials: true`, origin
allowlist), a 200kb request body limit, a structured 404 for unmatched `/api` routes, a real
`SELECT 1`-backed `/api/health` (503 + `database: "disconnected"` when the DB is down, not just
"the process is alive"), and graceful shutdown on `SIGTERM`/`SIGINT`. `utils/errorHandler.ts` is
new: it masks any 500-level error message behind a generic fallback when `NODE_ENV=production`
(400-level messages still pass through unmasked). Every route that used to silently fall back to
an in-memory store on a Postgres error now does `if (NODE_ENV==='production') throw e` instead.
Migrations moved out of `db.ts`'s import-time side effect into a standalone `db/migrate.ts`,
run explicitly (`docker-compose.prod.yml`'s `api` service: `node dist/db/migrate.js && node
dist/server.js`).

**What could be tested against the regular QA stack (NODE_ENV=test, unconditional behavior):** new
`api/14-production-hardening.spec.ts` (5 tests) — Helmet headers present on every response, the
richer health check, the 404 fallback's exact shape, the 200kb limit actually rejecting an
oversized body with 413, and the base info endpoint reflecting the new version and `/google`
endpoint.

**What needed a dedicated environment, and why:** error-masking and the removed memory-store
fallback only activate when `NODE_ENV=production` — the regular `api-qa` container deliberately
stays on `NODE_ENV=test` so the rest of this suite's assertions on *exact* error messages keep
working. Built two opt-in containers instead (`docker-compose.prodcheck.yml`): one with correct DB
credentials (happy-path smoke check under production mode) and one with a deliberately wrong DB
password (forces every DB-touching route to fail, to confirm the failure is masked, not leaked).
New `prodcheck/15-production-mode.spec.ts` (6 tests, run via `npm run test:prodmode` after `npm run
prodcheck:up`) confirmed: a broken DB gets a masked `"Internal server error"`/`"Database connection
unavailable"`, never the raw Postgres auth-failure text; a healthy DB behaves normally, including
400-level validation messages still reaching the client un-masked. Kept out of the regular
`test:api` count on purpose — see [Method](#method) for why.

**Beyond Vitest entirely:** built the new `server/Dockerfile` standalone and ran the *exact*
production command (`node dist/db/migrate.js && node dist/server.js`) against a real throwaway
Postgres container, then hit `/api/health` and registered a real user against it — full details in
[Method](#method). This is the first round where a DayFlow feature's "it should work in
production" claim was verified by actually deploying it that way, not only by reading the source
and the isolated-container checks above.

### 2. Daily Journal note sheet (commit `5330565`)
A 5th default note sheet, `daily_journal`, keyed per calendar day rather than per week — the same
tab shows different content depending on which day is currently selected, injected client-side
(the server's own `defaultSheets()` in `todoRoutes.ts` still returns the original 4 — see
[Also noticed](#also-noticed)). Switching to Day view auto-activates it; switching back to
Week/Month reverts to the regular Weekly Journal. Bundled in the same commit: a real bug fix to
Month view, which used to read every day cell's task count from whichever ONE week happened to
already be loaded, so any other week's days always showed "No tasks" regardless of reality.

**Covered:** new `e2e/daily-journal.spec.ts` (2 tests) — the Day-view auto-switch, and per-day
content isolation surviving a reload. New `e2e/month-view-data.spec.ts` (1 test) — creates tasks in
two different weeks of the same month and confirms Month view renders both correctly, the actual
scenario the fix addresses. `e2e/note-sheets.spec.ts`'s "default sheets" test updated for 5 tabs,
not 4.

---

## Finding 06 — Notes autosave can silently lose an edit if you navigate away fast enough

**Severity:** High · `src/js/app.js`'s `flushNotesToApi`, `src/js/notes.js`'s
`flushCurrentNoteEditor`

**How this was found:** while writing `e2e/daily-journal.spec.ts`, the reload-persistence case
intermittently (roughly 1 run in 3–6) came back with a previously-saved entry showing empty after
switching days twice more and reloading. Confirmed by direct source read rather than left as an
unexplained flake:

```js
// app.js — fires on the 600ms autosave debounce
const flushNotesToApi = () => {
  ...
  ApiClient.saveNotes(weekKey, weekData.notes, weekData.noteSheets);   // NOT awaited
  DOM.notesSavedStatus.textContent = 'Saved';                         // shown immediately regardless
};
```
```js
// notes.js — fires on textarea blur, and before every date/view navigation
export function flushCurrentNoteEditor() {
  ...
  ApiClient.saveNotes(weekKey, weekData.notes, weekData.noteSheets);   // also not awaited
}
```

Both call sites fire the save and immediately report success — nothing waits for the network
request to actually land. `flushCurrentNoteEditor()` is called right before every date/view change
specifically to avoid losing an edit, but if the *previous* save from a moment ago is still in
flight when the *next* one fires (or when a `GET` for the newly-selected week resolves first), the
two requests can complete out of order and the earlier edit's write is the one that gets
overwritten or never lands.

**Why the Daily Journal feature makes this much easier to hit:** switching *weeks* was the only
way to trigger this before, and that's a comparatively rare, slow action. Switching *days* within
the same session — exactly what the new Daily Journal invites — fires this same save-and-navigate
sequence far more often and far faster, in the course of completely ordinary use.

**Suggestion:** `await` the save before marking the UI "Saved", and have `flushCurrentNoteEditor`'s
callers (`navigateDate`, the view-mode button handler, the date-picker handler) wait for it to
settle before changing `STATE.selectedDate`/`currentWeekStart`.

---

## Finding 07 — The production Docker Compose template ships a known, hardcoded fallback JWT secret

**Severity:** Medium · `docker-compose.prod.yml`

```yaml
JWT_SECRET: ${JWT_SECRET:-dayflow_prod_secret_key_2026_94bec832_secure}
```

If an operator runs `docker compose -f docker-compose.prod.yml up` without setting `JWT_SECRET` in
their own `.env`, the container silently gets this exact string — committed in this public repo —
as its token-signing secret. `authMiddleware.ts` has a fail-fast guard specifically meant to catch
a missing secret in production:

```ts
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable must be set in production!');
}
```

but this compose file's fallback defeats that guard for exactly the deployment path it's meant to
protect — the environment variable *is* set (to the public default), so the check passes, and the
deployment boots with a secret anyone who has read this repository already knows. That's enough to
forge a valid session token for any user against a deployment that never customized `JWT_SECRET`.
`server/.env.example`'s own comment already gets this right ("Must be a secure random 64-char
string... Generate via: `openssl rand -hex 32`") — the compose file's fallback just quietly
undermines it.

**Suggestion:** drop the fallback and let Compose itself refuse to start instead:
```yaml
JWT_SECRET: ${JWT_SECRET:?JWT_SECRET must be set — see server/.env.example}
```

---

## Also noticed

**The server's own default note-sheet list is now out of sync with the client's, harmlessly.**
`todoRoutes.ts`'s `defaultSheets()` still returns the original 4 sheets; `daily_journal` is only
ever added by the frontend's `getWeekNoteSheets()`/`ensureSampleDataForCurrentWeek()`, which
back-fills it on every read (including for old weeks saved before this feature existed). Confirmed
this isn't a live bug — the backfill runs unconditionally on every render — just two lists that now
need to be read together to know the real default set. `api/09-note-sheets.spec.ts` (which asserts
on the raw API response) correctly did **not** need updating this round; only the e2e layer, which
sees the patched-in 5th tab, did.

**`apiClient.js`'s hostname-based API routing got narrower, and gained an explicit override.** The
old `localhost`/`127.0.0.1` → hardcoded `http://localhost:5000/api` branch — the entire reason this
repo uses `dayflow-qa.local` instead of `localhost` (see `docs/ARCHITECTURE.md` §4) — now also
requires port `8080` (dev's own default). A new `window.__DAYFLOW_API_URL__` override was added
alongside it. Neither changes anything for this suite today (`dayflow-qa.local:8280` never matched
the old branch either), but it's worth flagging as a real simplification opportunity: a future
round could plausibly drop the hosts-file requirement entirely via the new override, which would
also directly help the eventual mobile-webview testing layer this repo's architecture doc already
reserves space for. Not acted on this round — noted for `docs/TECHNICAL_PLAN.md` rather than
changed mid-feature-testing.

**CSP allows `'unsafe-inline'`** for `script-src` and `style-src` — needed for the current inline
handlers/styles, but it meaningfully narrows what Helmet's CSP actually protects against (inline
XSS payloads still execute). Not filed as a finding — likely a deliberate, pragmatic tradeoff given
the app's current structure — but worth knowing before calling CSP a completed hardening item.

**Month view's multi-week prefetch (new in `state.js`, backing the Month-view fix above) awaits
each week's slots and habits serially in a `for` loop**, not via `Promise.all`. For a month
spanning up to 6 calendar weeks that's up to 10 sequential round trips on every month-view render.
Not a correctness issue — confirmed the fix itself works ([e2e/month-view-data.spec.ts](../e2e/month-view-data.spec.ts)) — just a
latency observation worth a look if Month view ever feels slow to load.

**A transitive dependency (`google-logging-utils@2.0.1`, pulled in by `google-auth-library`) warns
it wants Node ≥22** during `npm ci`, while both the QA Dockerfile and the new production
`server/Dockerfile` use `node:20-alpine`. Advisory only — the build and the full production
smoke-test below both completed without error on Node 20 — but worth watching in case a future
transitive update turns this into a hard requirement.

**The e2e suite outgrew its own shared rate-limit budget.** Adding this round's 3 new files pushed
a clean `test:e2e` run's registration/login count (24 across 9 files) close enough to the same
50-attempts/15-min budget `api/13-proxy.spec.ts` deliberately exhausts that a run occasionally
tripped it purely from its own volume — confirmed with a direct 429 probe against nginx-qa
immediately after a run that failed several unrelated tests with the exact "registration never
completes" symptom that exhaustion has always produced. Not a DayFlow bug (the limiter did exactly
its job); fixed on the QA side by splitting `npm run test:e2e` into two batches with a
`stack:reset-api` between them — see [Method](#method).

**Still no tag past `v2.3.0`.** Flagged a sixth time, now specifically alongside a "production
ready" claim that has no corresponding release marker.

---

## Recommended next steps

| Suggestion | Addresses |
|---|---|
| `await` the notes save before reporting "Saved" and before navigating away | Finding 06 |
| Drop `docker-compose.prod.yml`'s `JWT_SECRET` fallback in favor of `${JWT_SECRET:?...}` | Finding 07 |
| Tag a release — especially now that "production ready" is the claim being made | Also noticed |

---

## Method

Same isolated `dayflow-qa` stack as prior reports, rebuilt fresh from `6474194`.

Commits analyzed:
```
6474194 chore(server): remove obsolete @types/helmet in favor of native helmet v8 types
5330565 feat(notes): add date-specific Daily Journal and unify ES module versioning
1be7769 feat: production hardening, HTTPS reverse proxy, database migration decoupling, and process resilience
```

**Why production-mode checks are kept separate from the regular count:** `prodcheck/` has its own
Vitest config and its own `npm run test:prodmode`, deliberately outside the `api/**/*.spec.ts` glob
`test:api` runs. Verifying `NODE_ENV=production` behavior needs two extra containers
(`docker-compose.prodcheck.yml`, brought up with `npm run prodcheck:up`) that neither the regular
stack nor CI-less local runs bring up by default — keeping it separate means the regular regression
count stays comparable across rounds regardless of whether a production-mode check happens to run
that round too.

<details>
<summary><strong>API/integration suite — full output (final run)</strong></summary>

```
✓ api/02-isolation.spec.ts (14 tests)
✓ api/12-todo-patch-fields.spec.ts (8 tests)
✓ api/07-date-bounds.spec.ts (22 tests)
✓ api/11-google-auth.spec.ts (5 tests)
✓ api/03-schedule.spec.ts (4 tests)
✓ api/09-note-sheets.spec.ts (5 tests)
✓ api/13-proxy.spec.ts (4 tests)
✓ api/06-restart-persistence.spec.ts (1 test)
✓ api/01-auth.spec.ts (8 tests)
✓ api/14-production-hardening.spec.ts (5 tests)
✓ api/05-todos.spec.ts (3 tests)
✓ api/04-habits.spec.ts (3 tests)
✓ api/08-todo-due-dates.spec.ts (8 tests)

Test Files  13 passed (13)
     Tests  90 passed (90)
```

(Run twice for stability — identical result both times.)

</details>

<details>
<summary><strong>Web (Playwright) suite — full output (final run, batched — see "also noticed")</strong></summary>

```
test:e2e:batch1 — 13 tests
  ok  daily-journal.spec.ts (2 tests)
  ok  login-gate.spec.ts (5 tests)
  ok  month-view-data.spec.ts (1 test)
  ok  note-sheets.spec.ts (3 tests)
  ok  time-lock.spec.ts (2 tests)
  13 passed (16.7s)

[stack:reset-api between batches]

test:e2e:batch2 — 11 tests
  ok  todo-due-date.spec.ts (4 tests)
  ok  todo-persistence.spec.ts (2 tests)
  ok  view-mode-persistence.spec.ts (2 tests)
  ok  view-modes.spec.ts (3 tests)
  11 passed (15.2s)
```

(Full batched run repeated twice for stability — identical result both times, zero retries needed
either time, versus the un-batched run's intermittent rate-limit-exhaustion failures documented in
"also noticed" above.)

</details>

<details>
<summary><strong>Production-mode verification — full output</strong></summary>

```
✓ prodcheck/15-production-mode.spec.ts (6 tests)
  ✓ Production mode — happy path against a healthy DB
    ✓ register/login/todo CRUD all work normally under NODE_ENV=production with a healthy DB
    ✓ a 400-level validation error is NOT masked in production
    ✓ GET /api/health reports a healthy, connected database
  ✓ Production mode — masking behavior with a broken DB connection
    ✓ GET /api/health reports degraded/disconnected, with the error masked to a generic message
    ✓ a DB-touching authenticated route throws and returns a masked 500
    ✓ registration itself fails loudly (masked 500) rather than silently succeeding

Test Files  1 passed (1)
     Tests  6 passed (6)
```

</details>

<details>
<summary><strong>Production Dockerfile — full end-to-end smoke test (outside Vitest entirely)</strong></summary>

Built `server/Dockerfile` standalone (`docker build -f Dockerfile -t dayflow-prod-smoketest .`),
confirmed both `dist/db/migrate.js` and `dist/server.js` exist in the built image, then ran the
*exact* command `docker-compose.prod.yml` uses against a real, freshly-started, otherwise-empty
`postgres:15-alpine` container on its own throwaway Docker network:

```
$ docker run ... dayflow-prod-smoketest:latest sh -c "node dist/db/migrate.js && node dist/server.js"
🔄 Running DayFlow PostgreSQL schema migrations...
✅ DayFlow schema migrations and indexes completed successfully!
🚀 DayFlow Express REST API running on http://localhost:5000
📚 Interactive Swagger API Documentation available at http://localhost:5000/docs
✅ Connected directly to PostgreSQL Database ('dayflow_db' on dayflow-prod-smoketest-pg:5432)!

$ curl http://localhost:5199/api/health
{"status":"online","database":"connected","service":"DayFlow API Server","version":"2.4.0",...}

$ curl -X POST http://localhost:5199/api/auth/register -d '{"email":"prod-smoketest@...", ...}'
{"message":"Registration successful","token":"eyJ...", "user": {...}}
```

Migrations ran clean against a database that had never seen DayFlow's schema before, the server
booted, and a real registration succeeded — the documented production deployment path is not just
plausible from reading `docker-compose.prod.yml`, it actually works. All smoke-test containers,
the throwaway network, and the built image were removed afterward; nothing was left running.

</details>

---

## Ground rules

Per the standing agreement between `dayflow-qa` and `DayFlow`: QA reports issues, it doesn't fix
them here or there. Nothing in `DayFlow` was modified to produce this report — the production
Dockerfile smoke test built and ran the dev repo's own unmodified `server/Dockerfile` against
throwaway, QA-owned containers, and everything was torn down afterward.
