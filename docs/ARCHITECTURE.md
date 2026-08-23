# Architecture

## 1. Design goals

1. **Zero shared infrastructure with dev.** A developer running `DayFlow` locally (API on 5000, web
   on 8080, Postgres on 5433) and a tester running the full QA stack on the same machine at the same
   time must never collide, conflict, or share state.
2. **Black-box only.** QA never imports dev source as a library, never calls dev's Express `app`
   object directly (no `supertest(app)`), and never touches Postgres directly. Every test — API,
   web, or (later) mobile — talks to the system the same way a real client would: HTTP over the
   network, through the same reverse-proxy topology production uses.
3. **Disposable, not staged.** Nothing here is a long-lived shared environment. Every CI run (and
   every local run) stands the stack up from a pinned ref and tears it down after.
4. **Room for mobile without a rewrite.** DayFlow's Phase 3 (Flutter mobile app) isn't built yet,
   but it will talk to the *same* REST API this repo already tests. The layering below is chosen so
   that adding mobile UI tests later is additive — a new top-level folder and a new CI job — not a
   restructure.

## 2. System diagram

```
                                   dayflow-qa (this repo)
 ┌───────────────────────────────────────────────────────────────────────────┐
 │                                                                            │
 │   api/            e2e/                mobile/ (reserved,                 │
 │   Vitest+fetch     Playwright           not implemented — see §5)         │
 │       │               │                        │                          │
 │       │        loads http://dayflow-qa.local:8280/  (see §4)             │
 │       │               │                        │ (future: same API,      │
 │       │               ▼                        │  driven by an installed │
 │       │      ┌──────────────────┐               │  Flutter app instead   │
 │       │      │  nginx (QA)       │               │  of a browser)         │
 │       │      │  host :8280       │◀──────────────┘                        │
 │       │      │  static + /api    │                                       │
 │       │      │  proxy            │                                       │
 │       │      └────────┬─────────┘                                        │
 │       │               │ proxies /api/*                                    │
 │       ▼               ▼                                                   │
 │  ┌─────────────────────────────┐        pinned, read-only checkout        │
 │  │  DayFlow API (Node/Express)  │◀───────  of DayFlow @ DAYFLOW_PINNED_REF │
 │  │  container port 5000          │        (built here, not run from dev's  │
 │  │  host :5100                   │         machine or dev's containers)    │
 │  └───────────────┬───────────────┘                                        │
 │                   │ pg (node-postgres)                                    │
 │                   ▼                                                       │
 │  ┌─────────────────────────────┐                                          │
 │  │  Postgres (QA-only)           │  db: dayflow_qa                        │
 │  │  container port 5432          │  host :5543                            │
 │  │  host :5543                   │                                        │
 │  └─────────────────────────────┘                                          │
 │                                                                            │
 │   All four boxes above are defined in docker-compose.test.yml, owned      │
 │   by this repo, brought up and torn down per test run.                    │
 └───────────────────────────────────────────────────────────────────────────┘
```

The API and nginx images are **built from** a pinned, read-only checkout of the `DayFlow` source
(see §3) — QA never runs a dev-maintained container image or a dev's already-running stack.

## 3. Where the app under test comes from

`DAYFLOW_PINNED_REF` at the repo root holds the exact tag/commit currently under test (starts at
`v2.3.0`, matching the onboarding doc). `npm run checkout:dev-ref` (wraps
[scripts/checkout-dev-ref.mjs](../scripts/checkout-dev-ref.mjs)) does a shallow, read-only
`git clone --branch <ref> --depth 1` of `https://github.com/josephcjai/DayFlow.git` into
`.dev-checkout/` (gitignored, never committed, never pushed anywhere). `docker-compose.test.yml`
then uses that checkout purely as a **Docker build context** — QA supplies its own compose file,
its own env vars, its own port mappings, and its own nginx config; nothing from the dev repo's
`docker-compose.yml` or `doc/DEPLOYMENT_LIGHTSAIL.md` is executed directly. Bumping the pinned ref
is a one-line change reviewed like any other change in this repo.

## 4. Port map — and why hostname matters as much as port

| Component | Container-internal port | QA host port | Dev's equivalent |
|---|---|---|---|
| Web/nginx entry point | 80 | **8280** | 8080 (`python -m http.server`) |
| API (Node/Express) | 5000 | **5100** | 5000 |
| Postgres | 5432 | **5543** | 5433 |

None of these collide with the dev defaults in the onboarding doc, so both stacks can run on one
machine simultaneously.

**The subtlety worth knowing before writing any Playwright test:** DayFlow's frontend picks its API
base URL by inspecting `window.location.hostname` — `localhost`/`127.0.0.1` resolves to a
hard-coded `http://localhost:5000/api`; anything else resolves to a same-origin relative `/api`
(proxied by nginx). That logic lives in dev's source and QA does not patch it (Ground Rule #1). If
Playwright were pointed at `http://localhost:8280`, the app would ignore port 8280 entirely and try
to call port 5000 directly — which QA does not expose under that name, by design.

**Resolution:** the QA web stack is addressed by its own hostname, not `localhost`. Add once, in
your hosts file:

```
127.0.0.1   dayflow-qa.local
```

<a name="local-hostname-setup"></a>Then `E2E_BASE_URL=http://dayflow-qa.local:8280` (already the
default in [.env.test.example](../.env.test.example)) makes the frontend take the *relative `/api`*
branch, nginx same-origin-proxies it to the API container, and QA's chosen ports are respected end
to end. This also happens to be the more production-faithful path to test (prod is exactly
"non-localhost hostname → relative `/api` behind nginx"), and it's what makes the proxy-level checks
in the regression checklist (rate-limit headers, CORS) actually meaningful rather than accidentally
bypassed.

Layer 1 (`api/`) tests are unaffected by any of this — they call `API_BASE_URL`
(`http://localhost:5100/api`) directly over HTTP and never load the frontend.

## 5. Accommodating future mobile UI testing (Phase 3, not yet built)

Nothing here is implemented — DayFlow's Flutter app doesn't exist yet — but the layout is reserved
so it slots in without touching the layers that already work:

- **The API layer needs zero changes.** A Flutter app talks to the same
  `/api/auth`, `/api/schedule`, `/api/habits`, `/api/todos` contract a browser does. Everything in
  `api/` and `shared/` (test-user factory, fixture builders) is UI-agnostic already and doubles as
  mobile's backend coverage on day one of Phase 3.
- **`mobile/`** is reserved for the UI-driving layer, parallel to `e2e/`. Framework choice is
  deferred to when the app exists (an emulator/build target changes the calculus), but the leading
  candidates given a Flutter target are **Maestro** (fast to write, good Flutter accessibility-tree
  support, minimal CI setup) and **Appium + the Flutter driver plugin** (heavier, but needed if
  device-lab/BrowserStack-style cross-device matrices become a requirement). See
  [mobile/README.md](../mobile/README.md).
- **Environment reuse:** the mobile layer targets the exact same `dayflow-qa` stack (§2) an
  emulator/simulator can reach — no separate backend, no separate database. The same
  `docker-compose.test.yml`, the same pinned-ref checkout, the same `dayflow-qa.local` hostname
  strategy (an Android emulator needs `10.0.2.2` instead of `127.0.0.1` for the hosts mapping;
  iOS simulators can use the host's `127.0.0.1` directly — noted in `mobile/README.md` for when it's
  built).
- **CI shape:** `.github/workflows/ci.yml` already runs `api` and `e2e-web` as independent jobs
  against one stack-up. A future `e2e-mobile` job is additive — same stack-up step, new job that
  boots an emulator and runs `mobile/`.

## 6. Environments this repo can target

| | Frontend | API base | DB |
|---|---|---|---|
| QA local/CI (this repo) | nginx (QA), `dayflow-qa.local:8280` | relative `/api` via nginx → API :5100 internally | Postgres :5543, db `dayflow_qa` |
| Dev local (reference only, never touched) | `python -m http.server 8080` | `http://localhost:5000/api` | Postgres :5433 |
| Production (reference only) | nginx static root | same-origin `/api` | Postgres on the Lightsail instance |

QA's job is to validate the app the same way the **Production** row works (nginx + relative `/api`)
using an isolated copy of the topology — not to reproduce the **Dev local** row, which is a
convenience setup for app developers, not a test target.
