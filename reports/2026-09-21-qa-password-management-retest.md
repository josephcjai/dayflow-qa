# DayFlow QA — Password Management Retest (Findings 13–22) — 2026-09-21

Retest against the dev team's reply to the pre-production review. One commit landed (`0563993`,
"address QA password management findings 13-22"). Held to the same strict standard, because this
is what gets deployed to production.

**Verdict: the blocking security defects are fixed and verified — but two of the ten "resolved"
claims are not (17 timing, 18 docs), one is only partly resolved (19), and the fixes introduced
two new lower-severity issues (23, 24, the second being a fail-open in the new session check).**
None of the remaining items is an account-takeover path; all can be tracked after deploy, provided
the deploy checklist at the end is followed.

| | |
|---|---|
| **Prepared** | 2026-09-21 |
| **Commit tested** | `0563993866efbbc74b11645d939fd77a469b953a` (`main`; no new tag — `v2.4.0` is still the latest; the reply names `v2.4.1-rc1`, which does not exist) |
| **Previous pin** | `8fbc404302a0e401e2e03997e68a225dc0191829` |
| **Dev reply reviewed** | `temp/2026-09-21-qa-password-management-reply.md` |

## Summary

**Regular suite: 160 checks passing** (120 API + 40 E2E), each run twice, plus **13/13** on the
production-mode containers. 6 of those are deliberate *known-defect markers* (tests asserting the
correct behaviour that fail today, so they turn red when fixed): 5 API, 1 prod-mode. Down from 11
markers last round — six fixes were confirmed by markers flipping.

| # | Claim | QA verdict |
|---|---|---|
| **13** | `schema.sql` missing `password_reset_tokens` | ✅ **Fixed & verified** — QA's stack now boots from `schema.sql` alone; migrate path and in-place upgrade also verified |
| **14** | Reset link host from `Origin`/`Referer` | ✅ **Fixed & verified** — forged headers ignored; production refuses to boot without `APP_URL` |
| **15** | Sessions survive password change/reset | ✅ **Fixed & verified** — every prior session revoked; fresh token returned to the caller |
| **16** | Non-string inputs → 500 | ✅ **Fixed & verified** — 400 on every variant tried |
| **20** | Tokens in production logs | ✅ **Fixed & verified** — production returns 503, logs nothing |
| **21** | `hasPassword` not on login/register/google | ✅ **Fixed & verified** (google path not testable black-box) |
| **22** | Token left in URL | ✅ **Fixed & verified** |
| **19** | bcrypt 72-byte truncation / whitespace | ⚠️ **Partly** — whitespace and >72 *characters* fixed; **multi-byte passwords still truncate** |
| **17** | Timing side channel | ❌ **Not resolved** — existing accounts still take ~2.2× as long |
| **18** | Docs match the API | ❌ **Not fully resolved** — §1.8's two error strings were changed to text the API does not return |
| **23** | *new (pre-existing gap)* register does not validate `displayName` | Open — Low |
| **24** | *new* the session-version check fails **open** when its DB lookup errors | Open — Medium/Low |

---

## Verified fixed — how each was checked

- **13 — schema parity.** QA's API container no longer runs `migrate.js` (that was a workaround);
  the database is built from `schema.sql` alone and forgot-password works for existing accounts.
  `npm run schema:check` now passes and was extended to compare **columns** too (negative control
  confirmed: removing `token_version` from `schema.sql` makes it fail). Also verified the two
  production paths: `migrate.js` on top of a `schema.sql` database (idempotent), an **in-place
  upgrade** (pre-feature schema with existing users → migrate → existing users still log in,
  pre-upgrade tokens still work, forgot-password starts working), and a brand-new database built by
  `migrate.js` alone (register/forgot/change/session-revocation all correct).
- **14 — host poisoning.** Forged `Origin`/`Referer` no longer change the link (base is the fixed
  default outside production). A production container **without** `APP_URL` exits immediately with
  `FATAL: APP_URL environment variable must be set in production!`. *Not verifiable black-box:*
  the `escapeHtml` on the URL in the email HTML (the HTML body is never logged) — source-reviewed.
- **15 — sessions.** After change-password: the token used, a separate login's token, and a
  protected data route all return 401; the fresh token returned by the change works; a second
  change works with the fresh token. After reset: an attacker-held token is refused. In the browser:
  the changing tab stays signed in (fresh token stored), a second signed-in browser context is sent
  to the login screen. **Deploy-compat confirmed:** a legacy token with no `tokenVersion` claim
  still works for accounts that never changed their password (no forced logout on deploy), and is
  revoked once they do. Forged `tokenVersion` values (99, 0, −1, `"1"`) and tokens for unknown
  users are refused.
- **16, 19 (partly), 21, 22.** Non-string `token`/`email`/`newPassword`/`currentPassword` → 400
  everywhere (public reset included), also in production. Whitespace-only and 73-character passwords
  are refused on register, change and reset; exactly 72 is accepted. `hasPassword` is present on
  login and register and stored by the UI. The reset token is gone from the address bar after a
  successful reset.
- **20.** In production with no mail key, forgot-password is a **503 for existing and unknown
  emails alike** (identical bodies — no enumeration through the failure), validation still 400s
  first, and the container logs (stdout **and** stderr) contain no token, no address, no message
  text. Change-password still succeeds (the "changed" notice is best-effort).

## Finding 19 (residual) — the 72 limit counts characters, but bcrypt counts bytes

The new check is `password.length > 72` (UTF-16 code units). bcrypt truncates at 72 **bytes**. A
password of 40 × "é" plus a suffix is 44 characters (accepted) but 84 bytes — verified live:
register with `é×40 + "AAAA"`, then log in with `é×36 + "ZZZZ"` (same first 72 bytes) → **200**.
So the silent-truncation equivalence still exists for any non-ASCII password. **Suggestion:**
measure `Buffer.byteLength(password, 'utf8') > 72`.

## Finding 17 — timing side channel is NOT neutralised

Dev's fix adds a dummy `randomBytes` + `sha256` for unknown emails — microseconds. The real
difference is what only the existing-account path does: two DB writes (invalidate old tokens,
insert a new one) plus, outside production, an awaited email send. Measured, 20 interleaved pairs,
local: **existing 11.1 ms vs unknown 5.1 ms (2.2×, ratio unchanged from last round's 2.4×)**. In
production the email send goes async, but the DB writes stay on the request path, so the gap
remains. (Production timing with a real mail key was not measured — that would send addresses to a
third party — but the DB-write gap does not depend on it.) **Suggestion:** do the token bookkeeping
off the request path too (respond immediately, then do the work), or pad every response to a fixed
minimum time. Encoded as a known-defect marker.

## Finding 18 — docs §1.8 now quote text the API does not return

Fixed: §1.6's 401 message, §1.7's success message, `hasPassword`, the `token` in change-password's
response. **Not fixed, and made worse:** the two §1.8 error bullets were rewritten to
*"Invalid or used password reset link…"* and *"Password reset link has expired…"* — but the route
strings were not changed and still read *"This password reset link is invalid or has already been
used. Please request a new one."* and *"This password reset link has expired. Password reset links
are valid for 1 hour."* Also: the reply says the 503 says "contact support"; the code says "try
again later" (unlisted in the docs). A test now enforces a simple rule: every message the API
returns for these endpoints must appear verbatim in the documented section.
**Suggestion:** change the docs to the real strings (or the code to the documented ones) — and
update Swagger to match.

## Finding 24 (new) — the session-version check fails open

`authMiddleware` looks up `token_version` in a `try`; the `catch` swallows any error, falls back to
the in-memory list, and — if nothing is found — leaves the version at 1 and **accepts the token**.
Two consequences, both reproduced:
- A validly-signed token with a malformed `userId` (`"not-a-uuid"`) passes the middleware and reaches
  the route, which then 500s with a raw Postgres message (*"invalid input syntax for type uuid…"*).
- With the database unreachable (production-mode container with a wrong DB password), a token that
  was **revoked** by a password change (version 1 vs 2) is no longer refused — the request reaches
  the route instead of getting a 401/503. Revocation therefore holds only while the DB is healthy.
Severity Medium/Low: exploiting it needs a stolen token *and* a DB fault, but it is a security
control that fails in the permissive direction. **Suggestion:** on lookup error return 503 (or 401),
never accept. Both cases are known-defect markers.

## Finding 23 (new, pre-existing) — `register` does not validate `displayName`

`displayName` as an object or array is accepted (200) and stored as a coerced string; 200 characters
returns **500** (*"value too long for type character varying(100)"*, a raw DB message outside
production). Public endpoint, user-controlled input. **Suggestion:** `typeof === 'string'` and a
length cap → 400. Known-defect marker.

## Deploy checklist (recommended)

| Before / at deploy | Why |
|---|---|
| **Run `migrate.js` (or apply `schema.sql`) BEFORE starting the new code.** The production compose command already does. Verified: new code against the old schema → register returns 500 (`column "token_version" does not exist`) | Rolling/separate-tier deploys |
| **Set `APP_URL`** (production refuses to boot without it) and **`BREVO_API_KEY` + `BREVO_SENDER_EMAIL`** (without a key, forgot-password is a 503 — the feature is unavailable, by design now) | Feature availability |
| Expect **existing sessions to survive the deploy** (no forced re-login); they are revoked per user on the next password change/reset | Rollout communication |
| **Do one manual end-to-end check against the real provider** (QA cannot: it would send addresses to Brevo): a real reset email arrives, the button opens `APP_URL`, HTML renders, the "password changed" notice arrives | The one path QA has never exercised |

Track after deploy (none is a takeover path): **24** fail-open session check, **19** byte length,
**17** timing, **18** docs strings, **23** displayName validation.

## Changes to QA's own harness this round

- `docker-compose.test.yml`: `api-qa` back to a **`schema.sql`-only database** (the migrate workaround
  is removed — that is the point of Finding 13). `docker-compose.prodcheck.yml`: `APP_URL` added to
  the broken-DB container; new `api-qa-prodcheck-noappurl` container expected to exit at boot.
  **Restart the prodcheck containers between `test:prodmode` runs** (`prodcheck:down`/`up`) — they
  share the 50-attempt auth limiter and a third consecutive run exhausts it.
- `shared/jwt.ts` (signs tokens with QA's own test secret to craft legacy/forged tokens);
  `shared/mailbox.ts` and the prod-mode helpers now read **stderr as well as stdout** (a leak check
  that only read stdout would have missed console.warn/error output).
- `api/15-password-management.spec.ts` 22 → 30 tests, `prodcheck/16` 4 → 7, `e2e/change-password`
  4 → 5, `e2e/forgot-password` 6; `contract/` pin refreshed; `schema:check` extended to columns.

## Method

Server and client diff reviewed line by line, then each claim in the reply attacked directly:
forged tokens, multibyte passwords, interleaved timing samples, concurrent token reuse, stale-token
replay against a DB-less container, and three database-provisioning paths (schema-only, in-place
upgrade, migrate-only). One-off experiments that touched the database (dropping `token_version` /
`password_reset_tokens` in QA's own throwaway DB to simulate the previous release) are described
above and were not committed as tests. Results: API 120/120 (×2), E2E 13 + 16 + 11 = 40 (×2),
prod-mode 13/13 (fresh containers, ×2); `contract:check` and `schema:check` clean. Per-request cost
of the new session lookup measured at ~1 ms locally.
