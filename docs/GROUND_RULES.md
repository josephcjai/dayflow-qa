# Ground Rules — Access & Change Boundaries

Source: `QA_TEAM_ONBOARDING.md` §2, provided by the dev team at handoff. This file is the
operating contract for everyone working in `dayflow-qa`. If a change to this repo's process would
violate one of these, it doesn't happen — raise it with the dev team instead.

## 1. QA never modifies the dev codebase
Not the app code, not `server/src/db/schema.sql`, not `docker-compose.yml`, not CI, not deployment
docs — nothing in the `DayFlow` repository. All test code, fixtures, CI config, and tooling live
exclusively here, in `dayflow-qa`.

## 2. QA's access to `DayFlow` is read-only
Clone/browse/view-history only — no push, no branch creation, no merge rights. That access exists
so testers can:
- read source to tell a test bug from an app bug,
- reference `server/src/db/schema.sql` and `doc/` for architecture questions,
- reference `docker-compose.yml` / `doc/DEPLOYMENT_LIGHTSAIL.md` to reproduce the real deployment
  topology locally (see [ARCHITECTURE.md](ARCHITECTURE.md)).

It is not an invitation to open PRs or push branches there, even for a one-line fix.

## 3. Bugs are reported, never fixed by QA
File against the `DayFlow` issue tracker: repro steps, expected vs. actual, environment/commit.
The dev team owns the fix. See [../contract/API_CONTRACT.md](../contract/API_CONTRACT.md) for how
findings map back to the checklist in `docs/TECHNICAL_PLAN.md`.

## 4. Minimal, one-directional coupling only
The only two things `dayflow-qa` depends on from the dev side:
- a versioned API contract the dev team publishes (pinned copy under [contract/](../contract/)),
- a pinned commit/tag/Docker image of `DayFlow` (see [DAYFLOW_PINNED_REF](../DAYFLOW_PINNED_REF)),
  checked out read-only to stand up a disposable test environment.

Never a live push-based dependency in either direction, and never a shared running
instance/database with anything a developer is using locally.

If a test change seems to require touching app code (e.g. a test-only seed endpoint), that's a
proposal to the dev team, not a QA-authored PR.
