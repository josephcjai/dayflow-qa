# DayFlow QA — New Feature Coverage & Findings — 2026-09-09

Five commits landed on `main` since the last round (`f0d3ebb`, 2026-09-08): **Google Sign-In**, an
extensively rewritten `PATCH /api/todos/:id`, and several UI-persistence features. This round
analyzed each, added test coverage for what's testable, and ran the complete suite (old + new)
against the result. **One new finding**, plus a real bug caught and fixed in this repo's own test
suite along the way — both detailed below.

| | |
|---|---|
| **Prepared** | 2026-09-09 |
| **Commit tested** | `d922a3061eebab0f223d26585fa7e803e899c955` |
| **Pin status** | Raw commit SHA — still no tag past `v2.3.0` (fourth time this has come up) |
| **Commits analyzed** | `f0d3ebb..d922a30` — 5 commits, see [Method](#method) for the full list |
| **Environment** | `dayflow-qa`'s isolated stack (own Postgres/API/nginx, ports 5543/5100/8280) |

---

## Summary

**106 of 106 checks passed.** No product regressions found in this round's new API test coverage.
One new finding (below) was identified via source review + an isolated library test, not a live
failure — it can't be live-reproduced black-box (explained in detail below). Separately, two
pre-existing e2e tests broke against this round's frontend changes; both were confirmed to be an
outdated *test* assumption, not a DayFlow bug, and fixed (also below).

| Layer | Passed | Total |
|---|---|---|
| API / integration (`api/`) | 85 | 85 |
| Web / Playwright (`e2e/`) | 21 | 21 |
| **Total** | **106** | **106** |

Full run output is in [Method](#method).

---

## What changed since the last test, and what got covered

### 1. Google Sign-In (new)
`POST /api/auth/register` and `/login` are joined by `GET /api/auth/config` (reports whether
Google Sign-In is configured) and `POST /api/auth/google` (verifies a Google Identity Services ID
token via `google-auth-library` and creates/links an account). `users.password_hash` is now
nullable — a Google-only account has none.

**What could be tested, and was:** `api/11-google-auth.spec.ts` (5 tests) — the configuration
endpoint, and every failure/validation path on `/auth/google` (missing credential, garbage
credential, a well-formed-but-fake JWT, a sweep of malformed shapes) — all fail cleanly (`400`/
`401`), never `500`. `e2e/login-gate.spec.ts` gained one case confirming the Google option actually
appears on the login screen once the server reports itself configured.

**What could not be tested, and why:** a genuine successful Google sign-in. That requires a real
Google account completing a live consent flow to produce an authentic signed token — nothing
short of that will pass DayFlow's own verification, by design (that's the point of the token). Both
new test files' headers spell this out in full; it isn't an oversight, and reaching for a workaround
(mocking the verification library, or inserting a Google-linked user directly into the database)
would either test our own mock instead of DayFlow, or break the ground rule that all test data is
self-provisioned through the public API. `docker-compose.test.yml` now sets a
fake-but-shaped-like-real `GOOGLE_CLIENT_ID` specifically so the *failure* paths exercise real
verification-library code instead of short-circuiting on "not configured."

### 2. `PATCH /api/todos/:id`, rewritten (new)
Went from a fixed `completed`/`dueDate` branch to a general dynamic-field updater also covering
`text`, `priority`, and `category`, built by hand-assembling `$1, $2, ...` SQL parameters — new
validation rejects an empty `text` and a `priority` outside `High`/`Medium`/`Low`. New:
`api/12-todo-patch-fields.spec.ts` (8 tests) — each field alone, all five fields together in one
`PATCH`, clearing `dueDate` alongside another field, a non-UUID id (cleanly `404`, not a `500` from
a Postgres type-cast error), and cross-user isolation on the three new fields. All passed cleanly —
the manually-tracked parameter indices, which are exactly the kind of code that's easy to get
subtly wrong in one field combination and not another, held up correctly in every combination
tested.

### 3. UI-only persistence features (new)
"Persist schedule view mode" and "week header day switching" — confirmed against `app.js`: purely
`localStorage` preferences, no API surface. New: `e2e/view-mode-persistence.spec.ts` (2 tests) —
Day and Month view selection surviving a real reload. Tab persistence and the day-switching
interaction itself were reviewed but not separately tested this round (lower priority; flagged in
`docs/TECHNICAL_PLAN.md`, not silently skipped).

---

## Finding 05 — A Google-only account would get a raw 500 on the regular login form

**Severity:** Medium · `authRoutes.ts` → `POST /api/auth/login`

**How this was identified — read this before the "expected vs. actual" below:** this is the first
finding in this repo that wasn't live-reproduced against DayFlow itself. It comes from source
review plus an isolated test of the `bcryptjs` library alone (a throwaway install, not touching
DayFlow or its database), because reproducing it live would require a real Google-linked test user,
which — per the ground rules and explained in full in `api/11-google-auth.spec.ts`'s header — this
suite has no way to create. Confidence is high despite that: the exact library call and its exact
failure mode are both directly confirmed, only the specific account state that triggers it
couldn't be manufactured black-box.

**Expected vs. actual**
- **Expected:** a Google-only account (no password ever set) trying the regular email+password
  login form gets a normal `401 Invalid email or password` — same as any other wrong-credential
  attempt.
- **Actual (by code inspection + isolated library test):** a raw `500`, with an internal error
  message leaking into the response body.

**Why, precisely**
```js
const isMatch = await bcrypt.compare(password, user.password_hash || user.passwordHash);
```
For a Google-only user, both `password_hash` (DB, now nullable) and `passwordHash` (in-memory
fallback shape) are absent, so this becomes `bcrypt.compare(password, null)`. Confirmed directly,
isolated from DayFlow entirely:
```
$ node -e "require('bcryptjs').compare('x', null).catch(e => console.log(e.message))"
Illegal arguments: string, object
```
That throw isn't caught by anything specific to this case — it falls through to the route's
generic `catch`, which returns `500` with `err.message` verbatim.

**Suggestion:** guard for a missing hash before calling `compare` — e.g. `if (!user.password_hash)
return res.status(401).json({ error: 'This account uses Google Sign-In. Please continue with
Google.' })`. That also happens to be a better user-facing message than a generic "invalid
credentials" for someone who forgot they signed up with Google.

---

## Two e2e tests broke this round — both confirmed to be an outdated test assumption, not a bug

`e2e/view-modes.spec.ts`'s category-filter test and `e2e/time-lock.spec.ts` both open the task
modal by clicking an empty grid cell once — which stopped working. Investigated properly (a live
DOM inspection script, not a guess) rather than assumed away:

```js
// src/js/grid.js, current commit
td.addEventListener('click', (e) => {
  if (STATE.selectedSlotKey === slotKey) {
    openTaskModal(...);      // opens only if this cell was ALREADY selected
  } else {
    selectSlotCell(slotKey, td);   // first click just selects it
  }
});
td.addEventListener('dblclick', (e) => {
  e.preventDefault();
  openTaskModal(...);        // always opens directly
});
```

This is a deliberate interaction change (evidently supporting the same commit's new cell
selection/copy-paste/context-menu features), not a regression — a single click now selects a cell,
a second click or a double-click opens it. Both tests were written against the old single-click
behavior and simply hadn't been updated. Fixed by switching both to `.dblclick()`, which the app's
own handler treats as an unconditional "open" regardless of selection state. Re-ran clean twice
after.

---

## Also noticed

**`docs/API_DOCUMENTATION.md` is behind again.** Neither `/auth/config`, `/auth/google`, nor the
new `text`/`priority`/`category` fields on `PATCH /api/todos/:id` are documented there —
`contract:check` still passes (nothing changed relative to what QA already pinned), but the dev
team's own contract doc is now behind their own API for the second round in a row. The
`dueDate`/`noteSheets` version of this same gap was fixed in the very next round (2026-09-08), so
this may just be a lag, not neglect — flagging in case it's useful to catch before the next tag.

**Still no tag past `v2.3.0`**, now flagged a fourth time.

---

## Recommended next steps

| Suggestion | Addresses |
|---|---|
| Guard `POST /api/auth/login` against a missing `password_hash` (Google-only accounts) | Finding 05 |
| Update `docs/API_DOCUMENTATION.md` for `/auth/config`, `/auth/google`, and the new PATCH fields | Also noticed |
| Tag a release so QA can pin a name instead of a raw SHA | Also noticed |

---

## Method

Same isolated `dayflow-qa` stack as prior reports, rebuilt fresh from `d922a30`.

Commits analyzed (newest first, back to the last-tested point):
```
d922a30 feat: persist schedule view mode (day/week/month), unify module versions, and enable week header day switching
b10cbba fix(scripts): add production environment guard and cross-platform support to freePorts.cjs
1001b08 feat: tab persistence, port cleanup, todo due date fix, notes enhancements
36c8bf0 feat: add Google Authentication with Google Identity Services and OAuth token verification
d0c8e25 fix: address code review findings and resolve linter warnings
f0d3ebb fix(api): guard todo PATCH against empty body and update API docs [last tested, 2026-09-08]
```

<details>
<summary><strong>API/integration suite — full output</strong></summary>

```
✓ api/02-isolation.spec.ts (14 tests)
✓ api/12-todo-patch-fields.spec.ts (8 tests)
✓ api/07-date-bounds.spec.ts (22 tests)
✓ api/03-schedule.spec.ts (4 tests)
✓ api/09-note-sheets.spec.ts (5 tests)
✓ api/11-google-auth.spec.ts (5 tests)
✓ api/13-proxy.spec.ts (4 tests)
✓ api/06-restart-persistence.spec.ts (1 test)
✓ api/01-auth.spec.ts (8 tests)
✓ api/05-todos.spec.ts (3 tests)
✓ api/04-habits.spec.ts (3 tests)

Test Files  12 passed (12)
     Tests  85 passed (85)
```

(Run twice for stability — identical result both times.)

</details>

<details>
<summary><strong>Web (Playwright) suite — full output</strong></summary>

```
Running 21 tests using 2 workers

  ok  login-gate.spec.ts (5 tests, incl. new Google visibility case)
  ok  note-sheets.spec.ts (3 tests)
  ok  time-lock.spec.ts (2 tests)
  ok  todo-due-date.spec.ts (4 tests)
  ok  todo-persistence.spec.ts (2 tests)
  ok  view-mode-persistence.spec.ts (2 tests, new)
  ok  view-modes.spec.ts (3 tests)

  21 passed (26.5s)
```

(Run twice for stability — identical result both times.)

</details>

---

## Ground rules

Per the standing agreement between `dayflow-qa` and `DayFlow`: QA reports issues, it doesn't fix
them here or there. Nothing in `DayFlow` was modified to produce this report.
