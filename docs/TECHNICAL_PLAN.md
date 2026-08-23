# Technical Plan

Companion to [ARCHITECTURE.md](ARCHITECTURE.md) (the *what/where*) — this is the *build order* and
*done criteria* for each phase.

## Phase 0 — Repo & environment scaffold (this commit)
- Repo structure, ground rules doc, pinned-ref mechanism, `docker-compose.test.yml` with isolated
  ports/DB/hostname (see ARCHITECTURE §4).
- CI skeleton that checks out the pinned ref, brings the stack up, waits for `/api/health`, and
  tears down — even with zero tests wired in yet.
- **Done when:** `npm run stack:up && curl http://localhost:5100/api/health` succeeds from a clean
  clone with nothing manually configured beyond Docker + the one hosts-file entry.

## Phase 1 — API/integration suite (priority — build first)
Per the onboarding doc, nearly every real bug found in this app so far has been at this layer:
auth correctness, cross-user isolation, and persistence across a real restart. Files are numbered
and **must run in that order** — the API's auth rate limiter is one shared in-memory bucket per
container lifetime, and file 7 deliberately exhausts it (see vitest.config.ts):
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
6. `api/07-proxy.spec.ts` — checklist items 7 (rate limiting through the real nginx path) and 8
   (CORS), run against nginx-qa on `localhost:8280` (not `dayflow-qa.local` — that hostname only
   matters to the frontend's own hostname-sniffing JS, which this file never loads; see
   `shared/env.ts`'s `proxyBaseUrl`), so proxy header handling is actually exercised without
   pulling in the e2e layer's hosts-file dependency. Runs last on purpose — see file-level
   comments.

**Three findings already confirmed live against `DAYFLOW_PINNED_REF`, not yet filed** (verified by
actually running this suite against a real stack while building it — not just reading source):

1. `02-isolation.spec.ts`'s delete-by-known-ID case — `DELETE /api/todos/:id` for another user's
   todo returns `200` regardless of whether any row matched, rather than a rejection. Data
   isolation itself holds (confirmed: the row is untouched); the response semantics don't. **Red
   today**, reproduced live.
2. `07-proxy.spec.ts`'s second-client case — confirmed live that a second client sharing the same
   nginx proxy inherits the first client's exhausted rate-limit bucket, because `server.ts` never
   calls `app.set('trust proxy', ...)`. **Red today**, reproduced live.
3. **Not encoded as a failing assertion, but confirmed live and worth its own issue:** a brief
   Postgres outage crashes the whole API process (exit code 1), not just the DB-backed routes —
   `server/src/db/db.ts` constructs a `pg.Pool` with no `.on('error', ...)` listener, so a dropped
   idle-client connection is an unhandled `Pool` `'error'` event, which Node treats as fatal. Seen
   directly while building `06-restart-persistence.spec.ts` (see that file's header for the full
   account); that spec now explicitly restarts `api-qa` after `postgres-qa` recovers to work around
   it, rather than relying on the pool to reconnect on its own, since it doesn't.

File all three against `DayFlow` rather than "fixing" the tests (or the workaround) to match
current behavior.

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

Explicitly **not** duplicating Layer 1 coverage here — if a case can be asserted over HTTP, it
belongs in `api/`, not `e2e/`.

**Done when:** the four specs above are green against `dayflow-qa.local:8280` in CI, using the
hostname strategy in ARCHITECTURE §4 (not `localhost`, so the real proxy path is exercised).

## Phase 3 — Mobile UI (future, gated on dev's Flutter app shipping)
Not started — DayFlow's Phase 3 mobile app doesn't exist yet. Reserved so it's additive later:
1. When the Flutter app has a first build, pick the driver (Maestro vs. Appium — see
   [mobile/README.md](../mobile/README.md)) based on what CI/device-matrix support actually turns
   out to be needed.
2. Reuse `shared/` fixtures as-is for setting up test users/data through the API before driving the
   mobile UI — no new backend test infrastructure required.
3. Add an `e2e-mobile` CI job parallel to the existing `e2e-web` job.

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
published contract. `npm run contract:check` (CI runs this on every pinned-ref bump) diffs it
against the copy inside the checked-out dev ref and fails loudly on drift, per onboarding §8 — the
goal is QA discovering a breaking API change from an explicit CI failure, not from a mysteriously
red assertion three files away.
