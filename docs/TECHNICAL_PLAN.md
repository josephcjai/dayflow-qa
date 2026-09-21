# Technical Plan

Companion to [ARCHITECTURE.md](ARCHITECTURE.md) (the *what/where*) — this is the *build order* and
*done criteria* for each phase.

## Phase 0 — Repo & environment scaffold (this commit)
- Repo structure, ground rules doc, pinned-ref mechanism, `docker-compose.test.yml` with isolated
  ports/DB/hostname (see ARCHITECTURE §4).
- **Done when:** `npm run stack:up && curl http://localhost:5100/api/health` succeeds from a clean
  clone with nothing manually configured beyond Docker + the one hosts-file entry.

**Pinned to a raw commit SHA as of 2026-09-20, not `v2.3.0`.** Fourteen feature/fix commits have
now landed on `main` after `v2.3.0` was tagged (`75e65e7`) — multi-sheet Markdown notes, todo due
dates, server-side date-range validation (1800–2200), the Finding 04 and 05 fixes, Google Sign-In,
an extensively-rewritten `PATCH /api/todos/:id`, several localStorage-only UI persistence features,
a large "production hardening" push (Helmet, CORS, a decoupled migration script, HTTPS reverse
proxy config, graceful shutdown, error-message masking), a new date-specific Daily Journal note
sheet, and as of this round the Finding 06/07 fixes plus a Month-view prefetch perf fix — with no
new tag cut for any of them yet, despite the dev team's own 2026-09-20 reply saying "Tag `v2.4.0`
is ready to be cut." `DAYFLOW_PINNED_REF` now holds the exact 40-char commit SHA (`8fbc404`);
`checkout-dev-ref.mjs` fetches an exact SHA directly (`git fetch --depth 1 origin <sha>`) since
`git clone --branch` doesn't accept one. **Resolved 2026-09-20:** after being asked nine times, the
dev team cut tag `v2.4.0` (= `91a595c`); `DAYFLOW_PINNED_REF` now holds `v2.4.0` and the SHA-fetch
path in `checkout-dev-ref.mjs` remains available for any future untagged pin.

**CI automation removed (2026-09-02) — run these by hand instead.** A GitHub Actions workflow
existed here (checkout pinned ref → stack up → `test:api`/`test:e2e` → teardown, plus
`docs-check`/`contract-check` jobs) but every run failed before a runner was ever assigned — 13/13
runs, on every trigger, since the very first push, confirmed to be an Actions
availability/billing issue on the account, not a real content or test failure (verified by diffing
the actual committed bytes directly — they matched). Removed rather than leave a red X that never
reflects anything real. Run `npm run test:api`, `npm run test:e2e`, `npm run contract:check`, and
`npm run docs:test-inventory` locally instead; re-add a workflow file if/when Actions is usable on
this account again — nothing else here depends on it existing.

## Phase 1 — API/integration suite (priority — build first)
Per the onboarding doc, nearly every real bug found in this app so far has been at this layer:
auth correctness, cross-user isolation, and persistence across a real restart. Files are numbered
and **must run in that order** — the API's auth rate limiter is one shared in-memory bucket per
container lifetime, and the last file deliberately exhausts it (see vitest.config.ts):
1. `api/01-auth.spec.ts` — checklist items 1, 2, 3.
2. `api/02-isolation.spec.ts` — checklist item 4. Highest-value file in the repo; every new
   endpoint the dev team ships gets an isolation case added here before anything else.
3. `api/03-schedule.spec.ts` — checklist items 10 (duplicate-safety/upsert) and 11
   (category/status round-trip + malformed-input handling). **Not** item 9 (time-lock) — confirmed
   against `scheduleRoutes.ts` that the lock is UI-only, never enforced server-side, so it belongs
   in `e2e/time-lock.spec.ts` instead.
4. `api/04-habits.spec.ts`, `api/05-todos.spec.ts` — checklist item 5, plus habit-log CRUD
   equivalents.
5. `api/06-restart-persistence.spec.ts` — checklist item 6. Deliberately restarts the QA
   Postgres container mid-suite (real restart, not a re-fetch) — this is the class of bug that
   only shows up against a freshly restarted real database, per the onboarding history.
6. `api/07-date-bounds.spec.ts` — added 2026-09-07 for the new `isValidDateRange` checks
   (`server/src/utils/dateValidation.ts`) added across `schedule`/`habits`/`todos` GET/POST/DELETE
   routes: out-of-range (before 1800 / after 2200), malformed, and boundary-exact dates.
7. `api/08-todo-due-dates.spec.ts` — added 2026-09-07 for the new `dueDate` field on todos: create,
   validate, patch, clear (`null`), cross-user isolation — plus a confirmed-live regression this
   file exists specifically to catch (see the findings note below).
8. `api/09-note-sheets.spec.ts` — added 2026-09-07 for the new multiple-categorized-note-sheets
   feature (`schedule_weeks.note_sheets` JSONB): default-sheet synthesis for a brand-new week,
   custom sheet save/fetch round-trip, the journal-sheet-content syncs to the legacy `notes` field,
   cross-user isolation.
9. `api/11-google-auth.spec.ts` — added 2026-09-09 for the new Google Sign-In feature (commit
   `d922a30`): `/auth/config`, and `/auth/google`'s failure/validation paths only — a genuine
   successful Google login can't be black-box tested (see the file's own header for the full
   reasoning) and isn't attempted. `docker-compose.test.yml` sets a fake-but-shaped
   `GOOGLE_CLIENT_ID` so these paths exercise real verification-library code, not just the
   "unconfigured" short-circuit.
10. `api/12-todo-patch-fields.spec.ts` — added 2026-09-09 for the same-commit rewrite of `PATCH
    /api/todos/:id` into a general dynamic-field updater (`text`, `priority`, `category`, alongside
    the existing `completed`/`dueDate`), built by hand-assembling `$1, $2, ...` SQL parameters —
    exactly the kind of code worth testing each field alone and several together, not just
    individually.
11. `api/13-proxy.spec.ts` — checklist items 7 (rate limiting through the real nginx path) and 8
    (CORS), run against nginx-qa on `localhost:8280` (not `dayflow-qa.local` — that hostname only
    matters to the frontend's own hostname-sniffing JS, which this file never loads; see
    `shared/env.ts`'s `proxyBaseUrl`), so proxy header handling is actually exercised without
    pulling in the e2e layer's hosts-file dependency. Renumbered twice now (07 → 10 → 13) as new
    files needed to slot in ahead of it — always runs last, on purpose, see file-level comments.
12. `api/14-production-hardening.spec.ts` — added 2026-09-17 for commit `1be7769`'s Helmet headers,
    the new structured 404 fallback for an unmatched `/api` route, the richer `GET /api/health`
    (now a real `SELECT 1` against Postgres, not just process liveness), and the 200kb request body
    limit — everything from that commit observable regardless of `NODE_ENV`. The parts that only
    activate under `NODE_ENV=production` (error-message masking, and the removed in-memory-store
    fallback on a DB failure) need a dedicated environment instead — see
    `prodcheck/15-production-mode.spec.ts` and `docker-compose.prodcheck.yml` below.

   **Side effect to know about before sharing an environment:** this file deliberately exhausts
   the auth rate limiter. Before the 2026-08-31 fix (see below) that lockout was shared by
   *everyone* hitting the environment through nginx, not just the test — as of `trust proxy` being
   set, a spoofed/different client no longer shares another client's bucket in the way that used to
   demonstrate, but the exhaustion itself is still real and still shared by anything without a
   distinguishing IP, so `npm run stack:reset-api` (restarts only `api-qa`, no data lost) is still
   good practice before handing a shared environment to a manual tester.

**Three findings confirmed live against `DAYFLOW_PINNED_REF` on 2026-08-23 — all three confirmed
FIXED on retest against `v2.3.0` (commit `75e65e7`) on 2026-08-31.** See
[reports/2026-08-31-qa-retest.md](../reports/2026-08-31-qa-retest.md) for the full retest account,
including two e2e test bugs (not app bugs) the retest surfaced and fixed along the way.

1. ~~`02-isolation.spec.ts`'s delete-by-known-ID case~~ — **fixed.** `DELETE`/`PATCH` on
   `/api/todos/:id` and `DELETE /api/habits/:id` now check `rowCount` and return `404` when nothing
   matched. Verified live: full `02-isolation.spec.ts` run, 14/14 pass.
2. ~~The proxy suite's second-client case~~ (numbered `07-proxy.spec.ts` at the time, now
   `13-proxy.spec.ts`) — **fixed.** `server.ts` now calls `app.set('trust
   proxy', 1)`. The original test could never have validated this properly (see the retest report —
   it had no way to simulate two genuinely different client IPs from one test machine); rewritten
   to assert the thing that setting actually guarantees: a client can't dodge the limit by forging
   its own `X-Forwarded-For`. Verified live, including a from-scratch trust-proxy-semantics
   walkthrough to confirm the new test is actually correct, not just passing.
3. ~~Unhandled `pg.Pool` error crashing the process~~ — **fixed.** `db.ts` now has a `pool.on('error',
   ...)` listener. Verified live: restarted `postgres-qa` alone (no longer also restarting `api-qa`
   as the old workaround did) and confirmed `api-qa` stays up, reconnects on its own, and serves a
   real DB-backed request afterward.

`06-restart-persistence.spec.ts`'s old api-qa-restart workaround for finding #3 has been removed
now that it's confirmed fixed — the test now only restarts `postgres-qa`, which also makes it a
live regression guard: if the crash-on-disconnect bug ever comes back, this is the test that would
catch it.

~~**Finding 04**~~ — confirmed live 2026-09-07, **fixed** 2026-09-08 (commit `f0d3ebb`). `PATCH
/api/todos/:id` with an empty body used to silently set `is_completed = false` regardless of
current state; the handler now has a dedicated no-op branch (existence-check only) when neither
`completed` nor `dueDate` is provided. Verified live: `08-todo-due-dates.spec.ts`'s regression case
passes now, full suite 90/90. See
[reports/2026-09-08-qa-retest.md](../reports/2026-09-08-qa-retest.md).

~~**Finding 05**~~ — identified 2026-09-09 (via source review + an isolated bcryptjs test, not a
live reproduction — see `api/11-google-auth.spec.ts`'s header for the full reasoning on why a real
Google-linked test user can't be self-provisioned through the public API), **fixed** 2026-09-16
(commit `967a679`, `fix(auth): guard login against missing password_hash for Google-only users`).
`authRoutes.ts`'s `/login` handler now checks `if (!passwordHash) return res.status(401)...`
before ever calling `bcrypt.compare`, closing off exactly the null-hash throw confirmed in the
original finding, and returns an actionable message ("This account was created with Google
Sign-In..."). Confirmed via source diff (a minimal, direct fix, matching the guard the report
suggested almost verbatim) plus the full regression suite staying green — same as the finding
itself, this fix cannot be live-reproduced/black-box-confirmed against a real Google-linked
account for the same self-provisioning reason. See
[reports/2026-09-16-qa-retest.md](../reports/2026-09-16-qa-retest.md).

**Finding 06, identified 2026-09-17 — PARTIALLY fixed 2026-09-20 (commit `432ce86`), confirmed by
a live network-request diagnostic, not just re-running the suite until green.** Original issue:
every notes save fired `ApiClient.saveNotes(...)` without awaiting it, and marked the UI "Saved"
instantly regardless. Dev's fix made `flushCurrentNoteEditor`/`flushNotesToApi` genuinely `async`,
awaited by their own caller, with every navigation handler now awaiting the flush before changing
`STATE.selectedDate`/`currentWeekStart` — that specific mechanism is real and confirmed working via
source diff. **But a fresh diagnostic (a small standalone script logging every
`/api/todos/notes` request/response with timestamps) showed the underlying race survives in a more
general form:** nearly every UI action that touches notes (the date picker, the view-mode buttons,
the notes nav tab, blur) fires its *own independent* `flushCurrentNoteEditor()` call. Awaiting
inside one handler only orders that handler's own request relative to itself — it does nothing to
order it relative to a *different* handler's already-in-flight request. Three-plus independent,
unsequenced saves firing within the same second or two (exactly what normal rapid navigation
produces) can still resolve out of order and let an earlier, stale/empty save overwrite a later,
real one. Reproduced at roughly the same ~30% rate as before the fix across 10 repeated runs of
`e2e/daily-journal.spec.ts`'s reload-persistence case — not a regression in QA's own test, the
diagnostic confirmed it directly against the running app. Suggestion: sequence saves for the same
week/sheet (a simple per-key promise chain/mutex around `ApiClient.saveNotes`, or a
monotonic version/timestamp the server rejects a stale write against) rather than relying on each
individual call site awaiting only its own request.

**Finding 07, identified 2026-09-17 — fixed and confirmed 2026-09-20 (commit `432ce86`).**
`docker-compose.prod.yml`'s `JWT_SECRET: ${JWT_SECRET:-dayflow_prod_secret_key_2026_94bec832_secure}`
fallback silently satisfied `authMiddleware.ts`'s fail-fast guard with a value committed in this
public repo. Now reads `JWT_SECRET: ${JWT_SECRET:?JWT_SECRET must be set — see
server/.env.example}` — Compose's own required-variable syntax. Verified directly, not just by
reading the diff: ran `docker compose -f docker-compose.prod.yml config` with `JWT_SECRET` unset —
refuses with `required variable JWT_SECRET is missing a value: ...`; with it set, interpolates
clean. Closed.

**UPDATE 2026-09-20 (second retest, commit `7dfa287`; pin now `7dfa287`):** Finding 08 — **fixed**
(0 saves on 6 nav clicks). Finding 06 — **still not resolved**, and the diagnosis above was
incomplete: write ordering is now fixed (per-week queue), but the residual loss (7/12 zero-wait
runs) is a *read-clobbers-local-edit* race — `syncWeekDataWithApi` (3 sequential GETs)
unconditionally assigns `weekData.noteSheets` from the server, replacing text typed before the
response lands. New **Finding 09**: `saveNotes` never throws (returns `false`), so
`flushCurrentNoteEditor`'s catch is unreachable — a failed save reads "Saved" and is never
retried. See [reports/2026-09-20-qa-retest-2.md](../reports/2026-09-20-qa-retest-2.md).

**UPDATE 2026-09-21 (commit `8fbc404`, pin now `8fbc404`): change / forgot / reset password.**
Strict pre-production review — see [reports/2026-09-21-qa-password-management.md](../reports/2026-09-21-qa-password-management.md).
Findings **13–22**: `password_reset_tokens` missing from `schema.sql` (forgot-password 500s; guard:
`npm run schema:check`), reset-link host from `Origin`/`Referer` when `APP_URL` unset (mitigated
when set), sessions survive change/reset, non-string inputs → 500, live tokens in logs without a
mail key, forgot-password timing channel, docs drift, bcrypt 72-byte truncation, `hasPassword` not
delivered to the UI, token left in URL. New: `api/15-password-management.spec.ts`,
`prodcheck/16-password-production.spec.ts`, `e2e/forgot-password.spec.ts`,
`e2e/change-password.spec.ts`, `shared/mailbox.ts` (reads the emailed link from the API log — QA
has no mail server). Known defects are held as `it.fails`/`test.fail` markers that flip loudly when
fixed. `api-qa` now runs `migrate.js` before the server (mirrors production compose); `test:e2e`
is three batches.

**UPDATE 2026-09-20 (fifth retest, commit `74dda2b`; `DAYFLOW_PINNED_REF` is a SHA again because
the dev team's named target `v2.4.1` has not been tagged):** **Finding 12 fixed** and verified
against reload-during-outage, two-failed-weeks, recover-then-reload and per-user-storage edge
cases; its expected-failure marker flipped and is now a normal test, plus a new persistence guard.
No new findings — findings 06–12 (the notes-saving saga) are all closed. See
[reports/2026-09-20-qa-retest-5.md](../reports/2026-09-20-qa-retest-5.md).

**UPDATE 2026-09-20 (fourth retest, tag `v2.4.0` = `91a595c`; `DAYFLOW_PINNED_REF` now holds the
tag name):** the dev team finally cut `v2.4.0`, after this had been raised nine times — the pin is
a name again, not a SHA. Findings **06, 10, 11 fixed** and verified (15/15 zero-wait loop clean;
`note-sheets` custom-sheet test 8/8 with retries off; `daily-journal` waits removed, 8/8 stable).
New narrower **Finding 12**: the failed-save marker is per-week but the retry always saves the
*current* week and any success clears it, so a note whose save failed is never re-sent if the user
leaves that day before the server recovers (status reads "Saved"; note gone after reload).
Expected-failure test in `e2e/notes-save-behavior.spec.ts`. See
[reports/2026-09-20-qa-retest-4.md](../reports/2026-09-20-qa-retest-4.md).

**UPDATE 2026-09-20 (third retest, commit `63498c7`; pin then `63498c7`):** Finding 09 — **fixed**.
Finding 06 — much improved (zero-wait loss 7/12 → 1/15) but the fix introduced **Finding 10**
(global `STATE.isNotesDirty` suppresses sync/render for *any* week while set, held through every
in-flight save and forever after a failure — a failed save on day A leaves A's text in day B's
editor and later saves it there) and **Finding 11** (regression: `note-sheets.spec.ts`'s
custom-sheet test now fails first-attempt ~50%, showing the journal sheet's text on the custom
sheet after reload). Finding 10 is an expected-failure test in `e2e/notes-save-behavior.spec.ts`.
See [reports/2026-09-20-qa-retest-3.md](../reports/2026-09-20-qa-retest-3.md).

**Finding 08 (new), identified 2026-09-20 — a real performance regression introduced BY the
Finding 06 fix, confirmed live with a network-trace diagnostic.** `flushCurrentNoteEditor()` has no
dirty-check: it unconditionally calls `ApiClient.saveNotes(...)` every time it runs, and it now
runs — awaited, i.e. blocking — before *every* navigation action app-wide (`navigateDate`, the
date-picker handler, the view-mode button handler, `switchView`, `handleSwitchToDayView`), not just
ones that touch notes. A diagnostic script clicking through view-mode buttons and week navigation
without ever opening the Notes tab still fired exactly one `POST /api/todos/notes` per click — 6
redundant saves for 6 clicks that never touched a note. Before the fix this was harmless because it
was fire-and-forget (never blocked navigation); now every one of those navigation actions
genuinely waits on a network round trip that saves nothing new. Consistent with a real, measured
slowdown across this round's *entire* e2e suite (not just notes-related specs) — runs that
previously completed in ~30s now take ~50s+ with no other change to explain it. Suggestion: skip
the save when the active sheet's content hasn't actually changed since the last successful save
(a simple dirty flag set on input/`setSheetContent`, cleared on a successful save, checked at the
top of `flushCurrentNoteEditor`).

**Done when:** all 11 items in the onboarding's §7 regression checklist have a corresponding
automated assertion, and the suite's outcome (pass, or a red test with a filed issue behind it) is
understood — not necessarily 100% green, per the findings above.

## Production-mode verification (new 2026-09-17)
Commit `1be7769` made several behaviors conditional on `NODE_ENV=production` specifically (error
masking, no silent memory-store fallback on a DB failure) that the regular `api-qa` container never
exercises — it deliberately stays on `NODE_ENV=test` so the rest of this suite's assertions on
exact error messages keep working. `docker-compose.prodcheck.yml` adds two opt-in containers
(`api-qa-prodcheck` — correct DB credentials; `api-qa-prodcheck-baddb` — deliberately wrong DB
password, to force every DB-touching route to fail) sharing postgres-qa's network, tested by
`prodcheck/15-production-mode.spec.ts` (its own Vitest config, its own `npm run test:prodmode` —
deliberately NOT swept into `npm run test:api`, so the regular regression count stays stable
whether or not a production-mode check happens to run that round). Bring up with `npm run
prodcheck:up` (after `stack:up`), tear down with `npm run prodcheck:down`. Confirmed live
2026-09-17: masked 500s on the broken-DB container, normal happy-path behavior (including
un-masked 400-level validation messages) on the healthy one — see
[reports/2026-09-17-qa-production-readiness.md](../reports/2026-09-17-qa-production-readiness.md).

## e2e rate-limit budget (new 2026-09-17)
The e2e suite has grown enough (24 registration/login attempts across 9 files, once this round's 3
new files were added) that a single clean `test:e2e` run started brushing up against the same
shared 50-attempts/15-min auth rate limit `api/13-proxy.spec.ts` deliberately exhausts — confirmed
live with a direct 429 probe against nginx-qa immediately after a run that failed several unrelated
tests with the "registration never completes" symptom this exact budget exhaustion has always
produced (not a DayFlow bug — the limiter doing exactly its job against more traffic than before).
Fixed by splitting `npm run test:e2e` into `test:e2e:batch1`/`batch2` with a `stack:reset-api`
between them (see package.json and README.md's Quick Start section) — confirmed clean and
noticeably faster (no retries needed) across two repeated runs. Keep the two batches roughly
balanced by registration count as new e2e files are added, or this will quietly resurface.

## Phase 2 — Web E2E (Playwright, kept small)
Only what genuinely needs a rendered DOM, per the onboarding's scoping call:
- `e2e/login-gate.spec.ts` — unauthenticated → login redirect/gate, then successful login lands on
  the grid.
- `e2e/todo-persistence.spec.ts` — UI state survives a real page reload (browser-level version of
  checklist item 5).
- `e2e/view-modes.spec.ts` — Day/Week/Month navigation, category filter, "NOW" slot highlight.
- `e2e/time-lock.spec.ts` — checklist item 9. This is the one genuinely DOM-only checklist item:
  the Planned Task field's lock state lives entirely in the frontend, never enforced by the API
  (see Phase 1 note above), so it can only be verified by driving the actual modal.
- `e2e/note-sheets.spec.ts` — added 2026-09-07: the multiple-categorized-note-sheets UI (tab bar,
  create/switch/delete a sheet, per-sheet content persisting across reload). Default-sheet
  synthesis and the save/fetch contract itself are covered in `api/09-note-sheets.spec.ts`; this
  file is only the tab-switching and modal interactions an API test can't reach.
- `e2e/todo-due-date.spec.ts` — added 2026-09-07: the due-date quick-set buttons (Today/Tomorrow/
  Clear) and the resulting badge classes (`.todo-due-today` etc.) in the todo list — UI-rendering
  behavior that `api/08-todo-due-dates.spec.ts`'s contract coverage doesn't reach.
- `e2e/view-mode-persistence.spec.ts` — added 2026-09-09: Day/Month view selection surviving a
  real reload. Purely a `localStorage` preference, confirmed against `app.js` — no API surface at
  all, so this is the *only* coverage for this feature, not a DOM-only supplement to something
  already tested in `api/`.
- `e2e/login-gate.spec.ts`'s new Google sign-in visibility case — added 2026-09-09: confirms the
  Google option appears on the login screen once the server reports itself configured. Explicitly
  does not click the button or attempt a real sign-in — see `api/11-google-auth.spec.ts`'s header
  for why that specifically can't be automated.
- `e2e/daily-journal.spec.ts` — added 2026-09-17 for the new date-specific Daily Journal note sheet
  (commit `5330565`): switching to Day view auto-activates it (and switching away reverts to the
  regular Weekly Journal), and each day's content is isolated from every other day and survives a
  reload. Surfaced Finding 06 (see above) while writing the reload-persistence case, and — after
  2026-09-20's partial fix — still needs explicit `waitForTimeout` calls between navigation steps
  to stay reliably green, since the underlying race (see Finding 06's updated writeup) is narrowed
  but not closed. Not a workaround QA is comfortable calling permanent; revisit once dev sequences
  saves properly.
- `e2e/month-view-data.spec.ts` — added 2026-09-17 for a real bug fix bundled into the same commit:
  Month view's day cells used to read every day's task count from whichever ONE week happened to
  already be loaded, so any other week's days always showed "No tasks" regardless of what was
  actually scheduled. Creates tasks in two different weeks of the same month and confirms both
  render correctly — the actual regression the fix addresses, not just "Month view is active."
- `e2e/note-sheets.spec.ts`'s first test — updated 2026-09-17: now asserts on 5 default sheets, not
  4. The 5th (`daily_journal`) is injected client-side only — the server's own `defaultSheets()` in
  `todoRoutes.ts` was NOT updated and still returns 4, so `api/09-note-sheets.spec.ts` (which
  asserts on the raw API response) correctly did **not** need the same update. See the "also
  noticed" section of the 2026-09-17 report for why that split is fine, not a bug.

Not yet covered, lower priority than the above (noted so it's a decision, not an oversight):
Markdown edit/split/preview modes and the formatting toolbar (`src/js/markdown.js`, "Phase 4"),
and the `dateFormat` display setting — both are purely client-side rendering/localStorage
preferences with no API surface, per source review on 2026-09-07.

Explicitly **not** duplicating Layer 1 coverage here — if a case can be asserted over HTTP, it
belongs in `api/`, not `e2e/`.

**Done when:** the specs above are green against `dayflow-qa.local:8280` (run locally — see
the CI note above), using the hostname strategy in ARCHITECTURE §4 (not `localhost`, so the real
proxy path is exercised).

## Phase 3 — Mobile UI (future, gated on dev's Flutter app shipping)
Not started — DayFlow's Phase 3 mobile app doesn't exist yet. Reserved so it's additive later:
1. When the Flutter app has a first build, pick the driver (Maestro vs. Appium — see
   [mobile/README.md](../mobile/README.md)) based on what CI/device-matrix support actually turns
   out to be needed.
2. Reuse `shared/` fixtures as-is for setting up test users/data through the API before driving the
   mobile UI — no new backend test infrastructure required.
3. Add a `test:mobile` npm script alongside `test:api`/`test:e2e`; fold it into a CI workflow if/when
   GitHub Actions is usable on this account again (see the Phase 0 note above).

Do not build this early speculatively — the onboarding doc is explicit that Phase 3 isn't built and
"no mobile app" isn't a bug to chase. This phase exists in the plan so that when it *is* built, QA
isn't redesigning the repo to fit it in.

## Phase 4 — Multi-device sync (future, gated on dev's Phase 4)
Real-time multi-device sync/push notifications aren't built either. No action until the dev roadmap
ships it; noted here only so it isn't forgotten when it does.

## Out of scope (per onboarding §6)
Load/performance testing, visual regression/screenshot diffing. Revisit only if the bug history
starts showing a class of bug these would actually catch — they aren't free, and the onboarding
doc's own bug history doesn't currently justify them.

## Contract drift
[contract/API_CONTRACT.md](../contract/API_CONTRACT.md) holds QA's pinned copy of the dev team's
published contract. `npm run contract:check` (run by hand on every pinned-ref bump — no CI right
now, see the Phase 0 note above) diffs it against the copy inside the checked-out dev ref and fails
loudly on drift, per onboarding §8 — the goal is QA discovering a breaking API change from an
explicit check failure, not from a mysteriously red assertion three files away.

**Worth knowing: `contract:check` passing doesn't mean the docs are current, only that they haven't
drifted from what QA already pinned.** The `/auth/config`, `/auth/google`, and
`text`/`priority`/`category` PATCH fields gap flagged on 2026-09-09 was fixed 2026-09-16 (commit
`967a679` documents all of it, confirmed by direct diff against the actual API — see
[reports/2026-09-16-qa-retest.md](../reports/2026-09-16-qa-retest.md)) — the second time in a row
this exact lag-then-catch-up pattern has played out (`dueDate`/`noteSheets` was the first, flagged
2026-09-07, fixed 2026-09-08). `contract/API_CONTRACT.md` has been refreshed to the current pin
accordingly.

As of 2026-09-17 (commit `6474194`), `docs/API_DOCUMENTATION.md` was updated in the SAME commit as
the health-check change it documents (version bump, the richer health/degraded response shapes) —
confirmed accurate against the live API. Not documented there, deliberately not flagged as a gap:
Helmet's headers, the 200kb payload limit, and the structured 404 fallback — none of those are
really part of a REST *contract* in the sense this doc otherwise covers (request/response shapes),
so their absence isn't the same kind of drift as a missing endpoint or field.
