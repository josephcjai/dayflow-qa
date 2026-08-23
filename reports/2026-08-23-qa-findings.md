# DayFlow QA Findings — 2026-08-23

Independent regression results from the `dayflow-qa` test repository against `DayFlow`.
48 automated checks across the API and web layers, plus three issues confirmed by hand while
building the suite. **Findings only** — QA does not open fixes against the `DayFlow` repo, per
[docs/GROUND_RULES.md](../docs/GROUND_RULES.md).

| | |
|---|---|
| **Prepared** | 2026-08-23 |
| **Commit tested** | `9d61c71caa96df66eb95724166aaa3a7fe5ecdcb` |
| **Pin status** | `main@HEAD` — no `v2.3.0` git tag exists yet (see Observations) |
| **Environment** | `dayflow-qa`'s isolated stack (own Postgres/API/nginx, ports 5543/5100/8280) |

---

## Summary

**46 of 48 checks passed.** Both failures map to real, reproducible product behavior, not flaky
tests — each was re-run clean multiple times. A third issue, a process crash under a database
hiccup, doesn't show up as a failing assertion but was triggered and confirmed directly while
validating the restart-persistence check. All three are written up below with exact repro steps.

| Layer | Passed | Total |
|---|---|---|
| API / integration (`api/`) | 35 | 37 |
| Web / Playwright (`e2e/`) | 11 | 11 |
| **Total** | **46** | **48** |

Full run output is in [Method](#method) at the bottom.

---

## Findings

### Finding 01 — Deleting another user's record reports success instead of being rejected
**Severity:** Medium · `todoRoutes.ts` → `DELETE /api/todos/:id` (same pattern in `PATCH
/api/todos/:id` and `DELETE /api/habits/:id`)

**Expected vs. actual**
- **Expected:** a request to delete a record the caller doesn't own is rejected — a 404 or 403,
  something that tells the caller nothing happened.
- **Actual:** the API responds `200 { "message": "Todo item deleted" }` regardless of whether the
  `WHERE` clause matched any row.

**Repro steps**
1. Register User A, register User B (two separate accounts).
2. As A: `POST /api/todos/todo` — create a todo, note its `id`.
3. As B: `DELETE /api/todos/{A's todo id}`.
4. Response is `200`. A's todo is still there (isolation itself holds — the SQL is correctly
   scoped to the caller's own weeks) — only the response is wrong.

**Evidence**
```
FAIL api/02-isolation.spec.ts > cross-user isolation — checklist item #4
     > B deleting A's todo by known ID does not remove it
AssertionError: expected 200 not to be 200
  ❯ expect(deleteAttempt.status).not.toBe(200);
```

**Why it happens**
The handler never checks `rowCount` on the delete/update query before responding — it always
returns the same success message whether zero rows or one row was affected. The same shape (query
scoped correctly, response unconditional) is also present in `PATCH /api/todos/:id` and `DELETE
/api/habits/:id`; we only asserted the status code for the todo-delete case, but the other two
look like the same pattern from source and are worth checking together.

**Suggestion:** Check the query result's row count before responding; return `404` when nothing
matched. A five-line change per handler, and it turns a currently-misleading "success" into an
honest one.

---

### Finding 02 — The auth rate limiter can't tell clients apart behind a reverse proxy
**Severity:** High · `server.ts`, `middleware/rateLimiter.ts` · every route under `/api/auth`

**Expected vs. actual**
- **Expected:** one client tripping the rate limit doesn't affect a different client hitting the
  same server.
- **Actual:** behind nginx (or any reverse proxy), *every* client shares one bucket. One client
  exhausting it locks everyone out for the rest of the 15-minute window.

**Repro steps**
1. Put the API behind a reverse proxy (as production already does — see
   `doc/DEPLOYMENT_LIGHTSAIL.md`).
2. From one client, send ~50 requests to `POST /api/auth/login` (any credentials) — the 51st gets
   `429`, correctly.
3. From a *second, distinct* client hitting the same proxy, send one more login request.
4. It also gets `429` — immediately, with no attempts of its own.

We hit this ourselves during this engagement, not only in the automated check: a real browser
session testing the app manually was locked out by an unrelated automated test run sharing the
same environment, mid-session.

**Evidence**
```
FAIL api/07-proxy.spec.ts > rate limiting through the real reverse-proxy path
     > a different simulated client in the same window should be unaffected
AssertionError: expected 429 not to be 429
  ❯ expect(second.status).not.toBe(429);
```

**Why it happens**
`server.ts` never calls `app.set('trust proxy', ...)`. Without it, Express's `req.ip` — the key
the limiter buckets by — is always the immediate TCP peer, which behind any reverse proxy is the
proxy itself, not the real client. Every proxied request looks like it came from the same IP.

> Separately: the rate limiter's actual ceiling (`rateLimiter.ts`: 50 attempts / 15 min for
> non-localhost IPs, 500 for localhost) doesn't match the 15-requests figure in the onboarding
> brief and API docs — worth reconciling whichever is intended.

**Suggestion:** Set `app.set('trust proxy', 1)` (or the exact hop count matching the deployed
topology) so Express reads the real client IP from `X-Forwarded-For`. nginx already sets that
header correctly — it's just not being trusted yet.

---

### Finding 03 — A brief database outage takes down the whole API process
**Severity:** High · `db.ts` — the exported `pg.Pool`

**Expected vs. actual**
- **Expected:** if Postgres becomes briefly unreachable (a restart, a network blip, connection
  recycling), DB-backed requests fail gracefully — a 500 or 503 — while the process itself stays
  up.
- **Actual:** the whole Node process exits (code 1). Every route goes down, including
  `/api/health`, until something manually restarts it.

**Repro steps**
1. Start the API against a real Postgres instance and confirm it's serving traffic.
2. Restart the Postgres container/process (`docker restart`, a maintenance bounce, anything that
   closes the pool's open connections).
3. The API process exits immediately — not just the in-flight request, the entire server.

**Evidence**
```
$ docker ps -a --filter name=dayflow-qa-api
NAMES            STATUS
dayflow-qa-api   Exited (1) 51 seconds ago

$ docker logs dayflow-qa-api --tail 5
❌ Connection error to PostgreSQL Database at postgres-qa:5432: connect ECONNREFUSED
Node.js v20.20.2                              ← process trailer; the server is gone
```

Not encoded as a failing assertion — the API/E2E suites don't exercise this path directly — but
reproduced twice while building `06-restart-persistence.spec.ts`, which now works around it by
explicitly restarting the API after the database recovers rather than waiting for the pool to
reconnect on its own.

**Why it happens**
`db.ts` constructs its `pg.Pool` with no `.on('error', ...)` listener. Node's `EventEmitter`
treats an unhandled `'error'` event as fatal by default — when an idle pooled connection is
dropped by the database, that's exactly the event the pool emits, and with nobody listening, Node
crashes the process.

**Suggestion:** Add `pool.on('error', (err) => console.error('Unexpected idle client error',
err))` (or equivalent logging/metrics). That one listener is the difference between "a query
fails" and "the API is down."

---

## Also noticed (not blocking)

**No git tag for the version under test.** The onboarding brief and `server/package.json` both say
v2.3.0, but no `v2.3.0` git tag exists on the repo — QA's pin mechanism falls back to `main@HEAD`
with a warning rather than pinning exactly. Tagging releases (`git tag v2.3.0 && git push --tags`)
would let QA — and anyone else deploying from a known-good point — pin precisely instead of
"whatever main happened to be."

**Rate limiter was recently tuned for local testing.** The commit under test (`9d61c71`) is titled
*"...relax rate limiter for local testing"* — worth double-checking the 500-attempt localhost
allowance isn't reachable from outside local development in whatever this ships to.

---

## Recommended next steps

| Suggestion | Addresses |
|---|---|
| Check `rowCount` before responding in `DELETE`/`PATCH` handlers; return `404` on no match | Finding 01 |
| Call `app.set('trust proxy', 1)` so rate limiting keys on the real client IP behind nginx | Finding 02 |
| Reconcile the documented rate limit (15/15 min) with the code's actual value (50 / 500) | Finding 02 |
| Add a `pool.on('error', ...)` listener in `db.ts` so a DB blip degrades instead of crashing | Finding 03 |
| Tag releases in git so downstream pinning (QA, deploys) is exact | Observations |

These are suggestions for the dev team to weigh, not fixes QA has made or intends to make — see
[docs/GROUND_RULES.md](../docs/GROUND_RULES.md).

---

## Method

All checks ran against an isolated stack owned by `dayflow-qa` — its own Postgres, API container,
and nginx, on ports that never collide with a developer's local instance, built from a read-only
checkout of `DayFlow` at the commit above. Nothing in the dev repository was modified. Full
architecture: [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

<details>
<summary><strong>API/integration suite — full output</strong></summary>

```
❯ api/02-isolation.spec.ts (14 tests | 1 failed)
   × B deleting A's todo by known ID does not remove it
     → expected 200 not to be 200

✓ api/03-schedule.spec.ts (4 tests)
✓ api/06-restart-persistence.spec.ts (1 test)
   ✓ a note and a todo written before restart are still there after

❯ api/07-proxy.spec.ts (4 tests | 1 failed)
   × a different simulated client in the same window should be unaffected
     → expected 429 not to be 429

✓ api/01-auth.spec.ts (8 tests)
✓ api/05-todos.spec.ts (3 tests)
✓ api/04-habits.spec.ts (3 tests)

Test Files  2 failed | 5 passed (7)
     Tests  2 failed | 35 passed (37)
```

</details>

<details>
<summary><strong>Web (Playwright) suite — full output</strong></summary>

```
Running 11 tests using 4 workers

  ok  login-gate.spec.ts › an unauthenticated visitor sees the login screen
  ok  login-gate.spec.ts › logging in with the wrong password stays on the login screen
  ok  login-gate.spec.ts › registering with a fresh email lands on the authenticated grid
  ok  login-gate.spec.ts › logout returns to the login screen
  ok  time-lock.spec.ts › a slot from a past day: Planned Task is locked
  ok  time-lock.spec.ts › a slot from a future day: Planned Task is fully editable
  ok  todo-persistence.spec.ts › weekly scratchpad notes survive reload
  ok  todo-persistence.spec.ts › added/completed/deleted todo state survives reload
  ok  view-modes.spec.ts › the current 30-minute slot is highlighted as "NOW"
  ok  view-modes.spec.ts › Day / Week / Month switching updates correctly
  ok  view-modes.spec.ts › the category filter narrows the grid to a single category

  11 passed (13.7s)
```

</details>

---

## Ground rules

Per the standing agreement between `dayflow-qa` and `DayFlow`: QA reports issues, it doesn't fix
them here or there. Nothing in `DayFlow` was modified to produce this report. Findings above are
QA's account for the dev team to file, prioritize, and resolve as they see fit.
