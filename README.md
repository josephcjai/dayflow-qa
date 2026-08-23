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
docs:test-inventory` (never hand-edited; CI fails if it's out of sync with the tests it describes).

## Reports

Dated findings reports for the dev team live in [reports/](reports/) — repro steps, evidence, and
suggestions for whatever the suite turned up on a given run. Latest:
[2026-08-23-qa-findings.md](reports/2026-08-23-qa-findings.md) (3 confirmed issues, 46/48 checks
passing).

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

**Sharing a running environment with a manual tester?** `api/07-proxy.spec.ts` deliberately
exhausts the auth rate limiter as part of checklist item #7, and a real, confirmed gap in DayFlow
(missing `trust proxy` config — see docs/TECHNICAL_PLAN.md) means that lockout is shared by anyone
else hitting the same environment through nginx, not just the test. Run `npm run stack:reset-api`
after `test:api` before handing the environment to someone for manual use — it only restarts the
API container, no data is lost.

## Ground rules (short version)

1. This repo never pushes to, branches, or PRs against `DayFlow`. Access to it is read-only,
   for source reference and pinning a commit/tag to test against.
2. Bugs are filed as issues against `DayFlow`, with repro steps — QA does not fix them here or there.
3. No shared database, no shared ports, no shared running instance with dev. Ever.

Full detail: [docs/GROUND_RULES.md](docs/GROUND_RULES.md).
