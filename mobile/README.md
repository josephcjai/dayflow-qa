# Mobile UI testing — reserved, not implemented

DayFlow's Phase 3 (Flutter mobile app) has not been built yet. Per the onboarding doc: "no mobile
app" is a roadmap gap, not a bug to chase, and this repo shouldn't build speculative coverage for
a UI that doesn't exist. This folder exists so that when Phase 3 ships, mobile testing is
additive — a new layer next to `api/` and `e2e/` — not a redesign. See
[docs/ARCHITECTURE.md §5](../docs/ARCHITECTURE.md#5-accommodating-future-mobile-ui-testing-phase-3-not-yet-built)
and [docs/TECHNICAL_PLAN.md Phase 3](../docs/TECHNICAL_PLAN.md#phase-3--mobile-ui-future-gated-on-devs-flutter-app-shipping).

## What already covers mobile, today, with zero extra work
A Flutter app talks to the same `/api/auth`, `/api/schedule`, `/api/habits`, `/api/todos` REST
contract a browser does. Everything in [`../api/`](../api/) and [`../shared/`](../shared/)
(test-user factory, the `ApiClient` wrapper) is UI-agnostic already — it's testing DayFlow's
*backend*, which mobile will depend on identically. That coverage doesn't wait for Phase 3.

## What's actually deferred: driving the mobile UI itself
When there's a real Flutter build to point at, pick between:

| | [Maestro](https://maestro.mobile.dev) | Appium (+ Flutter driver) |
|---|---|---|
| Test format | Declarative YAML flows | WebdriverIO/similar, imperative |
| Setup cost | Low — single binary, no server | Higher — Appium server, driver plugin, capabilities config |
| Flutter support | Good, via the accessibility tree | Good, via the official Flutter integration driver |
| Best fit when | Fast flow coverage is the priority | A real device-lab/BrowserStack-style matrix is needed |

Default recommendation: start with Maestro for speed; move to (or add) Appium only if
cross-device-matrix coverage becomes an actual requirement, not preemptively.

## How it will plug into the existing stack
- **No separate backend.** The mobile layer targets the same `dayflow-qa` stack
  (`docker-compose.test.yml`) an emulator/simulator can reach — same pinned checkout, same
  isolated Postgres, same ports.
- **Reachability differs by platform, not by backend:**
  - Android emulator → host loopback is `10.0.2.2`, not `127.0.0.1`; the `dayflow-qa.local` hosts
    entry needs an emulator-side equivalent (either the emulator's own hosts file, or point the
    build's API base at `10.0.2.2:<QA_API_PORT>` directly for local runs).
  - iOS simulator → can reach the host's `127.0.0.1`/hosts entries directly.
  - Physical devices / CI device farms → need the QA stack reachable over the local network or a
    tunnel; not designed yet, since there's no app to test against.
- **CI shape:** `.github/workflows/ci.yml` already separates `api` and `e2e-web` into independent
  jobs sharing one stack-up. A future `e2e-mobile` job is additive: boot an emulator, install the
  build, run this folder's flows against the same running stack.

## Suggested folder shape once this is built
```
mobile/
├── README.md          (this file)
├── flows/              # if Maestro: *.yaml flow files
│   or specs/            # if Appium: *.spec.ts
└── mobile.config.ts    # emulator/capabilities config, env wiring to shared/env.ts
```

Nothing under `flows/`/`specs/` exists yet — don't scaffold fake tests for an unbuilt app; wire this
up when there's a real build artifact to point at.
