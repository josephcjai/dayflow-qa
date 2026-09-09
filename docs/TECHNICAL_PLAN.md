# Technical Plan

Companion to [ARCHITECTURE.md](ARCHITECTURE.md) (the *what/where*) — this is the *build order* and
*done criteria* for each phase.

## Phase 0 — Repo & environment scaffold (this commit)
- Repo structure, ground rules doc, pinned-ref mechanism, `docker-compose.test.yml` with isolated
  ports/DB/hostname (see ARCHITECTURE §4).
- **Done when:** `npm run stack:up && curl http://localhost:5100/api/health` succeeds from a clean
  clone with nothing manually configured beyond Docker + the one hosts-file entry.

**Pinned to a raw commit SHA as of 2026-09-09, not `v2.3.0`.** Nine feature/fix commits have now
landed on `main` after `v2.3.0` was tagged (`75e65e7`) — multi-sheet Markdown notes, todo due
dates, server-side date-range validation (1800–2200), the Finding 04 fix, and as of this round
**Google Sign-In**, an extensively-rewritten `PATCH /api/todos/:id`, and several localStorage-only
UI persistence features — with no new tag cut for any of them yet. `DAYFLOW_PINNED_REF` now holds
the exact 40-char commit SHA (`d922a30`); `checkout-dev-ref.mjs` fetches an exact SHA directly
(`git fetch --depth 1 origin <sha>`) since `git clone --branch` doesn't accept one. Same suggestion
as before, now asked four times: a tag for this point would let the pin be a name again instead of
a SHA.

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

**Finding 05, identified 2026-09-09, not encoded as an automated test (can't be — see below), not
yet filed:** a Google-linked account (no password set — `password_hash` is nullable as of commit
`d922a30`) attempting the regular `POST /api/auth/login` with any password would get a raw `500`,
not a clean `401`. `bcrypt.compare(password, user.password_hash || user.passwordHash)` becomes
`bcrypt.compare(password, null)` for such a user, and bcryptjs throws
(`Illegal arguments: string, object`) rather than resolving `false` — confirmed via an isolated
test of the bcryptjs library itself, not a live reproduction against DayFlow, since creating a
real Google-linked test user requires an actual Google account (see `api/11-google-auth.spec.ts`'s
header for the full reasoning on why that path can't be black-box tested). High confidence despite
not being live-reproduced: the exact library call and exact failure mode are both confirmed, only
the specific account state (`password_hash IS NULL`) that triggers it couldn't be manufactured
through the public API. See
[reports/2026-09-09-qa-new-features.md](../reports/2026-09-09-qa-new-features.md).

**Done when:** all 11 items in the onboarding's §7 regression checklist have a corresponding
automated assertion, and the suite's outcome (pass, or a red test with a filed issue behind it) is
understood — not necessarily 100% green, per the findings above.

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
drifted from what QA already pinned.** As of 2026-09-09, `docs/API_DOCUMENTATION.md` still doesn't
mention `/auth/config`, `/auth/google`, or the `text`/`priority`/`category` fields on `PATCH
/api/todos/:id` — none of that changed the file this commit touched, so the check is legitimately
green, but the dev team's own contract doc is now behind their own API on two features in a row
(the same gap flagged for `dueDate`/`noteSheets` on 2026-09-07 was fixed 2026-09-08; this is a new
instance of the same pattern).
