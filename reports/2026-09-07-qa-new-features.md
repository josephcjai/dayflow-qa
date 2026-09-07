# DayFlow QA — New Feature Coverage & Findings — 2026-09-07

Three feature commits landed on `main` since `v2.3.0` was tagged (`75e65e7`, last tested
2026-08-31): todo due dates, multiple categorized note sheets, and server-side date-range
validation. This round analyzed each, added test coverage for what's API-testable and
UI-observable, and ran the complete suite (old + new) against the result. **One new finding**,
confirmed live, not yet filed.

| | |
|---|---|
| **Prepared** | 2026-09-07 |
| **Commit tested** | `6fb7686b6dfd4f7610376ed74064821a56016a1c` |
| **Pin status** | Raw commit SHA — no tag exists for this point yet (same open item as before) |
| **Commits analyzed** | `9d61c71..6fb7686` — see [Method](#method) for the full list |
| **Environment** | `dayflow-qa`'s isolated stack (own Postgres/API/nginx, ports 5543/5100/8280) |

---

## Summary

**89 of 90 checks passed.** The one failure is a new, confirmed regression (Finding 04, below),
reproduced live twice against a clean environment.

| Layer | Passed | Total |
|---|---|---|
| API / integration (`api/`) | 71 | 72 |
| Web / Playwright (`e2e/`) | 18 | 18 |
| **Total** | **89** | **90** |

Full run output is in [Method](#method).

---

## What changed since the last test, and what got covered

### 1. Server-side date-range validation (new)
Every `weekStart`/`dueDate`/`logTime`-bearing endpoint across `schedule`, `habits`, and `todos` now
rejects dates outside **1800-01-01 to 2200-12-31** (or malformed, or not-a-real-calendar-date) with
a clean `400`, backed by matching Postgres `CHECK` constraints as a DB-level backstop. New:
**`api/07-date-bounds.spec.ts`** (22 tests) — every affected route, the exact boundary dates (both
accepted), one day past either boundary (both rejected), malformed strings, and an
impossible-calendar-date (`2026-02-30`).

### 2. Todo due dates (new)
Todos can now carry an optional `dueDate`, settable on create or via `PATCH`, clearable with
`null`, validated against the same 1800–2200 bound. New: **`api/08-todo-due-dates.spec.ts`**
(8 tests: round-trip, defaulting to `null`, validation, patch-set, patch-clear, patch-reject,
cross-user isolation) and **`e2e/todo-due-date.spec.ts`** (4 tests: the Today/Tomorrow quick-set
buttons, the resulting `.todo-due-today`/`.todo-due-tomorrow` badges, the Clear button, no badge
when unset). This pairing is also where **Finding 04** turned up — see below.

### 3. Multiple categorized note sheets (new)
The single weekly scratchpad is now up to N named, iconed sheets per week (one, `id: 'journal'`,
still mirrors the legacy `weekly_notes` column for backward compatibility). New:
**`api/09-note-sheets.spec.ts`** (5 tests: default-sheet synthesis for a brand-new week, custom
sheet save/fetch round-trip including emoji icons, journal-content-syncs-to-legacy-notes,
legacy-only saves still working, cross-user isolation) and **`e2e/note-sheets.spec.ts`** (3 tests:
the 4 default tabs, create/write/reload a custom sheet, delete a custom sheet).

### 4. Not covered — and why that's a decision, not an oversight
- **Markdown editing (edit/split/preview modes, formatting toolbar)** — purely client-side
  rendering (`src/js/markdown.js`), no API surface at all. No due-date-style contract to test
  against; would need dedicated DOM/rendering tests. Deferred as lower priority given the app's own
  bug history has lived almost entirely at the API layer, not in rendering.
- **`dateFormat` display setting** — a `localStorage`-only preference (`DD/MM/YYYY` vs. others),
  same reasoning.

Both are noted in `docs/TECHNICAL_PLAN.md` so they stay a visible, deliberate gap rather than
something nobody remembers to revisit.

---

## Finding 04 — An empty PATCH body silently un-completes a todo

**Severity:** Medium · `todoRoutes.ts` → `PATCH /api/todos/:id`

**Expected vs. actual**
- **Expected:** a `PATCH` request that specifies neither `completed` nor `dueDate` changes
  nothing — it's a no-op, or arguably a `400` for a pointless request, but never a silent state
  change.
- **Actual:** `is_completed` gets set to `false` unconditionally, even if the item was already
  completed.

**Repro steps**
1. Create a todo, then `PATCH /api/todos/:id` with `{ "completed": true }` — confirm it's now
   completed.
2. `PATCH /api/todos/:id` with an empty body: `{}`.
3. Re-fetch the todo. It's no longer completed.

**Evidence**
```
FAIL api/08-todo-due-dates.spec.ts > todo due dates
     > REGRESSION — an empty PATCH body silently resets completed to false
AssertionError: expected false to be true
  ❯ expect(item?.completed).toBe(true);
```
Reproduced twice against a freshly reset environment — not a flake.

**Why it happens**
The handler branches three ways depending on which fields are present:
```ts
if (dueDate !== undefined && completed !== undefined) { /* update both */ }
else if (dueDate !== undefined) { /* update due_date only */ }
else { /* UPDATE todo_items SET is_completed = $1 ...  -- $1 is !!completed */ }
```
The third branch is meant for "just toggling completion" (`{ completed: false }` legitimately
wants this). But it's also what runs when *neither* field is present — `completed` is `undefined`
there, `!!undefined` is `false`, and the query still runs unconditionally.

**Suggestion:** Add a fourth branch (or an early guard) for "neither field provided" that either
no-ops with a `200`/`204`, or returns `400` for a pointless request — either is better than the
current silent state change. A minimal fix: change the `else` condition to
`else if (completed !== undefined)`, and only fall through to a no-op when both are `undefined`.

---

## Also noticed

**`docs/API_DOCUMENTATION.md` hasn't been updated for any of this round's new fields.** Checked
directly (`npm run contract:check` against the freshly checked-out commit): the dev team's own API
doc still shows the pre-due-date, pre-note-sheets shapes for `POST /todos/todo`, `PATCH
/todos/:id`, and `POST /todos/notes` — no mention of `dueDate` or `noteSheets` anywhere, and no
mention of the new 1800–2200 date-bounds validation on any endpoint. Nothing is *wrong* — old
clients following the doc still work — but new integrators reading it would have no idea these
fields exist. Worth a doc pass alongside whenever this gets tagged.

## Recommended next steps

| Suggestion | Addresses |
|---|---|
| Guard `PATCH /api/todos/:id`'s final branch against "neither field provided" | Finding 04 |
| Tag this point in history (still no tag past `v2.3.0`) so QA can pin a name, not a raw SHA | Observations |
| Update `docs/API_DOCUMENTATION.md` for `dueDate`, `noteSheets`, and the date-bounds validation | Also noticed |

---

## Method

Same isolated `dayflow-qa` stack as prior reports. `DAYFLOW_PINNED_REF` is currently a raw 40-char
commit SHA rather than a tag (see `docs/TECHNICAL_PLAN.md`'s Phase 0 note) —
`scripts/checkout-dev-ref.mjs` was extended this round to fetch an exact SHA directly
(`git fetch --depth 1 origin <sha>`), since `git clone --branch` doesn't accept one.

Commits analyzed (newest first, back to the last-tested point):
```
6fb7686 feat: implement due date sync, date bounds (1800-2200), schema docs, and date format customization
408b6d6 feat(notes): implement Phase 5 multiple categorized note sheets & themed deletion modal
a7f8351 feat(notes): implement Phase 4 Markdown and code snippet support in scratchpad
75e65e7 fix(api): Resolve QA regression findings [last tested, 2026-08-31]
```

While building this round's tests, the full suite briefly started failing with `429 Too many
authentication attempts` partway through an unrelated file — not a product bug, a suite-design one:
the three new API spec files' `it.each` blocks were each registering a fresh user per parametrized
case, pushing the whole numbered suite's total registrations for files 01–09 past the shared
50-per-15-minute auth rate limit before `10-proxy.spec.ts` (which deliberately exhausts it on
purpose, last by design) even started. Fixed by sharing one registered user per file wherever tests
don't actually test cross-user isolation from each other — cut the new files' registrations from
~38 to ~7. Mentioned here because it's exactly the kind of shared-budget interaction that's easy to
reintroduce when adding more test files later.

<details>
<summary><strong>API/integration suite — full output</strong></summary>

```
✓ api/02-isolation.spec.ts (14 tests)
✓ api/07-date-bounds.spec.ts (22 tests)
✓ api/03-schedule.spec.ts (4 tests)
✓ api/09-note-sheets.spec.ts (5 tests)
✓ api/10-proxy.spec.ts (4 tests)
✓ api/06-restart-persistence.spec.ts (1 test)
✓ api/01-auth.spec.ts (8 tests)
✓ api/05-todos.spec.ts (3 tests)
✓ api/04-habits.spec.ts (3 tests)

❯ api/08-todo-due-dates.spec.ts (8 tests | 1 failed)
   × REGRESSION — an empty PATCH body silently resets completed to false
     → expected false to be true

Test Files  1 failed | 9 passed (10)
     Tests  1 failed | 71 passed (72)
```

</details>

<details>
<summary><strong>Web (Playwright) suite — full output</strong></summary>

```
Running 18 tests using 4 workers

  ok  login-gate.spec.ts (4 tests)
  ok  note-sheets.spec.ts › the 4 default sheets are present for a brand-new week
  ok  note-sheets.spec.ts › creating a custom sheet, writing content, and reloading keeps it
  ok  note-sheets.spec.ts › deleting a custom sheet removes its tab
  ok  time-lock.spec.ts (2 tests)
  ok  todo-due-date.spec.ts › setting due date to "Today" shows a Due Today badge
  ok  todo-due-date.spec.ts › the Clear button empties the due-date field before it's submitted
  ok  todo-due-date.spec.ts › setting due date to "Tomorrow" shows a Due Tomorrow badge
  ok  todo-due-date.spec.ts › a todo with no due date set shows no due-date badge at all
  ok  todo-persistence.spec.ts (2 tests)
  ok  view-modes.spec.ts (3 tests)

  18 passed (17.1s)
```

</details>

---

## Ground rules

Per the standing agreement between `dayflow-qa` and `DayFlow`: QA reports issues, it doesn't fix
them here or there. Nothing in `DayFlow` was modified to produce this report.
