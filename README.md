# dayflow-qa

Independent QA test repository for [DayFlow](https://github.com/josephcjai/DayFlow) — a personal
productivity / time-blocking web app.

This repository is owned and operated entirely by the QA team. It is **not** a fork, a workspace,
or a submodule of the `DayFlow` dev repo, and it never writes to it. See
[docs/GROUND_RULES.md](docs/GROUND_RULES.md) for the boundary contract this repo operates under,
and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the test stack is isolated from dev.

## What's in here

| Layer | Location | Tool | Status |
|---|---|---|---|
| API / integration | [api/](api/) | Vitest + native `fetch` | **Priority — build first** |
| Web E2E | [e2e/](e2e/) | Playwright | Small, targeted set |
| Mobile UI (future) | [mobile/](mobile/) | TBD (Maestro/Appium) — reserved | Scaffold only, not implemented |
| Contract pin | [contract/](contract/) | Markdown + drift script | Tracks dev's published API contract |
| Shared fixtures | [shared/](shared/) | TS helpers | Used by every layer above |

Read [docs/TECHNICAL_PLAN.md](docs/TECHNICAL_PLAN.md) for the phased build-out plan and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system diagram, port map, and the
hostname/routing detail that matters once you get to browser-level tests.

**What's actually covered right now:** [docs/TEST_INVENTORY.md](docs/TEST_INVENTORY.md) — every
test title, grouped by file, regenerated straight from the test source with `npm run
docs:test-inventory` (never hand-edited — no CI to enforce that automatically right now, see
[docs/TECHNICAL_PLAN.md](docs/TECHNICAL_PLAN.md)'s Phase 0 note, so re-run it by hand after adding
or renaming a test).

## Reports

Dated findings reports for the dev team live in [reports/](reports/) — repro steps, evidence, and
suggestions for whatever the suite turned up on a given run.

- [2026-09-21-qa-password-management-retest-2.md](reports/2026-09-21-qa-password-management-retest-2.md)
  — second retest (`165bd81`): **17, 19, 23, 24 verified fixed**, 18 one string short; **4 new findings**
  incl. a reset token that can be spent several times concurrently (28 — also corrects an earlier QA
  claim) and legacy long-password accounts locked out by the new login rule (25); 165 checks, prod-mode 13/13.
- [2026-09-21-qa-password-management-retest.md](reports/2026-09-21-qa-password-management-retest.md)
  — retest of dev's fixes (`0563993`): the **blocking defects (13, 14, 15, 16, 20, 21, 22) are fixed
  and verified**; **17 (timing) and 18 (docs) are not resolved, 19 only partly**; **2 new lower-severity
  findings** (23 displayName validation, 24 session check fails open); 160 checks + 6 known-defect
  markers, prod-mode 13/13.
- [2026-09-21-qa-password-management.md](reports/2026-09-21-qa-password-management.md) — strict
  pre-production review of change/forgot/reset password (commit `8fbc404`): **verdict — not ready to
  deploy as-is**; **10 new findings** incl. reset-link poisoning via Origin/Referer (14), a missing
  `schema.sql` table that 500s forgot-password (13), sessions surviving resets (15); 151 checks + 11
  known-defect markers.
- [2026-09-20-qa-retest-5.md](reports/2026-09-20-qa-retest-5.md) — fifth retest: **Finding 12
  confirmed fixed**, verified against reload-during-outage, two-failed-weeks and launch-retry edge
  cases; **no new findings, no expected-failure markers left**, 119/119 checks, no flakes.
- [2026-09-20-qa-retest-4.md](reports/2026-09-20-qa-retest-4.md) — fourth retest against the new
  **`v2.4.0` tag**: Findings **06, 10, 11 confirmed fixed**, waits removed from the daily-journal
  test, **1 new narrower finding** (12: a failed note save is dropped if you leave that day before
  the server recovers); 118/118 checks, no flakes.
- [2026-09-20-qa-retest-3.md](reports/2026-09-20-qa-retest-3.md) — third retest: **Finding 09
  fixed**, Finding 06 much improved (7/12 → 1/15), but the fixes introduced **2 new data-corruption
  findings** (10, 11: notes land in the wrong day/sheet); 117 checks, 1 first-attempt flake.
- [2026-09-20-qa-retest-2.md](reports/2026-09-20-qa-retest-2.md) — second retest: **Finding 08
  confirmed fixed**, **Finding 06 still not resolved** (root cause corrected: a late sync GET
  overwrites unsaved edits), **1 new finding** (failed notes saves read "Saved"), 116/116 checks.
- [2026-09-20-qa-retest.md](reports/2026-09-20-qa-retest.md) — retest against the dev team's fix:
  **Finding 07 confirmed resolved**, **Finding 06 only partially resolved** (narrowed, not closed —
  confirmed by a live network-trace diagnostic), plus **1 new finding** (a performance regression
  introduced by the Finding 06 fix), 114/114 regular-suite checks passing.
- [2026-09-17-qa-production-readiness.md](reports/2026-09-17-qa-production-readiness.md) —
  coverage for the "production ready" round (Helmet/CORS/error-masking hardening, migration
  decoupling, HTTPS reverse proxy, Daily Journal), a full end-to-end smoke test of the actual
  production Docker deployment, plus **2 new findings**, 114/114 regular-suite checks passing.
- [2026-09-16-qa-retest.md](reports/2026-09-16-qa-retest.md) — retest against the dev team's fix:
  **Finding 05 confirmed resolved**, docs gap confirmed closed, 106/106 checks passing.
- [2026-09-09-qa-new-features.md](reports/2026-09-09-qa-new-features.md) — coverage for 5 new
  commits (Google Sign-In, rewritten todo PATCH, UI persistence features) plus **1 new finding**,
  106/106 checks passing.
- [2026-09-08-qa-retest.md](reports/2026-09-08-qa-retest.md) — retest against the dev team's fix:
  **Finding 04 confirmed resolved**, 90/90 checks passing.
- [2026-09-07-qa-new-features.md](reports/2026-09-07-qa-new-features.md) — coverage for 3 new
  feature commits (due dates, note sheets, date-range validation) plus **1 new finding**, 89/90
  checks passing.
- [2026-08-31-qa-retest.md](reports/2026-08-31-qa-retest.md) — retest against the dev team's fix:
  **all 3 prior findings confirmed resolved**, 48/48 checks passing.
- [2026-08-23-qa-findings.md](reports/2026-08-23-qa-findings.md) — original findings (3 issues,
  46/48 checks passing).

## Quick start (local)

Requires: Node 20+, Docker Desktop.

```bash
npm install

# 1. Pull a read-only, pinned copy of the dev repo's source (never modified, never committed)
npm run checkout:dev-ref

# 2. Bring up the QA stack: its own Postgres, its own API container, its own nginx —
#    all on ports that never collide with a dev's local DayFlow instance.
npm run stack:up

# 3. Run the suites
npm run test:api
npm run test:e2e

# 4. Tear down
npm run stack:down
```

See [docs/ARCHITECTURE.md#local-hostname-setup](docs/ARCHITECTURE.md#local-hostname-setup) before
running `test:e2e` for the first time — one one-line hosts-file entry is required for the browser
tests to exercise the app the same way production does.

**Sharing a running environment with a manual tester?** `api/13-proxy.spec.ts` deliberately
exhausts the auth rate limiter as part of checklist item #7 — that's the point of the test, not a
bug, but it means anyone else hitting the same environment through nginx right after will also see
"Too many authentication attempts" until the window resets. Run `npm run stack:reset-api` after
`test:api` before handing the environment to someone for manual use — it only restarts the API
container, no data is lost. (This used to also mean one client's lockout leaked to a *different*
client — a real DayFlow gap, fixed 2026-08-31, see
[reports/2026-08-31-qa-retest.md](reports/2026-08-31-qa-retest.md). What's left is just the
limiter doing its job against a shared environment, not a bug.)

**`npm run test:e2e` now runs in three batches (two until 2026-09-21) with a `stack:reset-api` in between**, as of
2026-09-17. The suite has grown enough (24 registrations/logins across 9 files at last count) that
a single clean run started brushing up against the very same shared 50-attempts/15-min budget
`api/13-proxy.spec.ts` exercises above — confirmed live with a direct 429 probe against nginx-qa
immediately after a run that failed several unrelated tests with the exact "registration never
completes" symptom this same budget exhaustion has always produced. Not a DayFlow bug (the limiter
is doing exactly its job) — a QA-suite scaling issue, fixed by splitting `test:e2e` into
`test:e2e:batch1`/`batch2` (see package.json) with a reset between them. Keep the two batches
roughly balanced by registration count as new e2e files are added, or this will quietly resurface.

**Verifying `NODE_ENV=production`-only behavior** (error-message masking, and the removal of every
route's fallback to the in-memory store on a DB failure — see commit 1be7769) needs two extra,
opt-in containers neither `test:api` nor `test:e2e` bring up: `npm run prodcheck:up` (after
`stack:up`), then `npm run test:prodmode`, then `npm run prodcheck:down` when done. See
`docker-compose.prodcheck.yml` and `prodcheck/15-production-mode.spec.ts` for exactly what these
check and why they need a dedicated environment.

## Ground rules (short version)

1. This repo never pushes to, branches, or PRs against `DayFlow`. Access to it is read-only,
   for source reference and pinning a commit/tag to test against.
2. Bugs are filed as issues against `DayFlow`, with repro steps — QA does not fix them here or there.
3. No shared database, no shared ports, no shared running instance with dev. Ever.

Full detail: [docs/GROUND_RULES.md](docs/GROUND_RULES.md).
