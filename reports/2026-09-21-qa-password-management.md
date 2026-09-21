# DayFlow QA — Password Management (Change / Forgot / Reset) — Pre-Production Review — 2026-09-21

The dev team is planning a production deploy, so this round was run to a strict standard. One
commit landed since the last round: `8fbc404` — **change password** (Settings), **forgot
password** and **reset password** (public, emailed one-time link via Brevo), plus `hasPassword` on
`/auth/me`. Security-sensitive features get held to a higher bar than a normal feature, and this
one has real defects.

**Verdict: not ready to deploy as-is.** The core mechanics are sound (tokens are single-use even
under a concurrent race, unknown/known emails get identical responses, failed attempts change
nothing). But there are two issues that can be *exploited* or that *break the feature outright*
depending on configuration (Findings 14 and 13), one that leaves stolen sessions alive after a
password reset (15), and several smaller ones. A pre-deploy checklist is at the end.

| | |
|---|---|
| **Prepared** | 2026-09-21 |
| **Commit tested** | `8fbc404302a0e401e2e03997e68a225dc0191829` (`main`) — no new tag (`v2.4.0` is the latest) |
| **Previous pin** | `74dda2bc3fbac080ebfcd72745d9b20759b03b08` |
| **Environment** | `dayflow-qa` isolated stack, plus the opt-in `NODE_ENV=production` containers |

## Summary of results

**Regular suite: 151 checks passing** (112 API + 39 E2E), each run twice, plus **10/10** on the
production-mode suite. Some of those passes are *known-defect markers* — tests that assert the
correct behaviour and are expected to fail today (8 in API, 1 in prod-mode, 2 in E2E); they turn
red the moment a defect is fixed so nothing regresses silently. No regressions in existing
features; no existing test needed changing beyond the batching/environment changes described below.

| # | Finding | Severity |
|---|---|---|
| **13** | The new `password_reset_tokens` table is only in `migrate.ts`, **not in `schema.sql`** — on any DB built from `schema.sql`, `forgot-password` returns **500 for every existing account** | **High** (breaks feature) |
| **14** | Reset-link host is taken from the request's **`Origin`/`Referer`** header when `APP_URL` is unset → **password-reset poisoning / account takeover** | **High** (config-dependent) |
| **15** | **Existing sessions stay valid after a password change or reset** (30-day JWTs, no revocation) | **Medium** |
| **16** | Non-string `token`/`email` (reset) or `currentPassword` (change) → **HTTP 500** | **Medium** |
| **20** | With `BREVO_API_KEY` unset, **live reset tokens are written to the logs** — in production too — while the API says a link "has been dispatched" | **Medium** |
| **17** | `forgot-password` response **timing** differs for existing vs unknown emails | Low–Medium |
| **19** | bcrypt **72-byte truncation** (pre-existing) + no max length, whitespace-only passwords accepted | Low |
| **18** | `docs/API_DOCUMENTATION.md` §1.6–1.8 quote **different message strings** than the API returns | Low |
| **21** | `hasPassword` is never sent on login/register/google → Settings' "set first password" branch is **unreachable** | Low |
| **22** | The one-time reset token **stays in the URL/history** after a successful reset | Low |

---

## Finding 13 — `schema.sql` is missing the new table; `forgot-password` 500s on such databases

**Severity:** High · `server/src/db/migrate.ts` vs `server/src/db/schema.sql`

`password_reset_tokens` was added to `migrate.ts` only. `docs/DATABASE_SCHEMA.md` names
`schema.sql` the **"Primary Schema File"**, and it is what QA's Postgres loads on first start (and
what any restore/bootstrap from the repo's schema would use). On such a database, the very first
call for an existing account fails:
```
POST /api/auth/forgot-password  {"email": "<an existing user>"}
→ 500 {"error":"relation \"password_reset_tokens\" does not exist"}
POST /api/auth/forgot-password  {"email": "<unknown>"}
→ 200 {"message":"If an account exists…"}
```
Two consequences: (1) the feature is simply broken there, and (2) the 500-vs-200 difference becomes
a trivial **account-enumeration oracle**, defeating the deliberately generic response. The
production compose command (`node dist/db/migrate.js && node dist/server.js`) does create the
table, so a deployment that always runs that command is fine — but `npm run dev`
(`predev` only frees ports), a plain `docker-compose.yml` dev DB, or any tooling that loads
`schema.sql` is not. Earlier features (`google_id`, `avatar_url`, `note_sheets`…) were kept in
`schema.sql` too, so this is a break in an established practice.

**Suggestion:** add the table + indexes to `schema.sql` (and keep them in sync — a one-line CI
check). QA added `npm run schema:check`, which fails today with
`schema.sql is missing table(s) that migrate.ts creates: password_reset_tokens`. QA's own API
container now runs `migrate.js` first (as production does) so the rest of this suite could run.

## Finding 14 — password-reset poisoning via `Origin`/`Referer` (account takeover)

**Severity:** High when `APP_URL` is unset · `emailService.ts` `getBaseAppUrl`

`getBaseAppUrl` uses `APP_URL` if set, **otherwise falls back to the request's `Origin`, then
`Referer`** header — both attacker-controlled. An attacker who knows a victim's email sends:
```
POST /api/auth/forgot-password   Origin: http://evil.example    {"email":"victim@…"}
```
The victim receives a genuine DayFlow email whose "Reset Password" button points at
`http://evil.example/#reset-password?token=<live token>&email=…`. One click hands the attacker the
token, and they reset the victim's password on the real API. Verified live (link base logged by
the API):
```
no Origin header            → https://localhost/
Origin: http://evil.example → http://evil.example/
Referer: http://evil2.example/path?x=1 → http://evil2.example/path?x=1/   (whole Referer, path included)
```
**Confirmed mitigated when `APP_URL` is set:** in the production-mode container with
`APP_URL=https://dayflow-qa.example`, forged `Origin`/`Referer` are ignored (link base is exactly
`APP_URL`). So the exposure is precisely "deployment without `APP_URL`". `server/.env.example`
does define it (`APP_URL=https://localhost`), but nothing enforces it, and `docker-compose.prod.yml`
relies on the operator's `.env`. The same header value is also interpolated **unescaped** into the
email's `href` and link text (HTML/attribute injection into a trusted email).
**Suggestion:** never derive the link host from request headers. Require `APP_URL` in production and
fail fast at startup (as `JWT_SECRET` already does) — and drop the `Origin`/`Referer` fallback.

## Finding 15 — sessions survive a password change or reset

**Severity:** Medium · `authRoutes.ts` (JWT, 30-day expiry, no revocation)

A token issued before the change still returns `200` from `/auth/me` afterwards (verified for both
change-password and reset-password). The most common reason to reset a password is that the
account may be compromised — an attacker holding a stolen token keeps access for up to 30 days
after the owner "secures" the account. **Suggestion:** add a `token_version`/`password_changed_at`
claim checked in `authMiddleware`, and bump it on change/reset (optionally keep the current
session alive on change).

## Finding 16 — non-string inputs cause HTTP 500

**Severity:** Medium · `reset-password`, `change-password`

`reset-password` calls `token.trim()` / `email.trim()` without a type check; `change-password`
passes `currentPassword` straight to `bcrypt.compare`. Verified (dev/test mode shows the raw
messages; production masks them but the status is still 500):
```
reset  {token: 12345}      → 500 "token.trim is not a function"
reset  {email: 12345}      → 500 "email.trim is not a function"
reset  {token: {a:1}}      → 500 "token.trim is not a function"
change {currentPassword: {a:1}|123} → 500 "Illegal arguments: object, string"
```
`reset-password` is unauthenticated, so anyone can trigger these. (`forgot-password` and the
`newPassword` checks are correct — they reject non-strings with 400.) **Suggestion:** add
`typeof … === 'string'` guards → 400. (Same class as the earlier bcrypt-null finding.)

## Finding 20 — live reset tokens in production logs

**Severity:** Medium · `emailService.ts` `sendMail`

With `BREVO_API_KEY` unset, `sendMail` logs the whole message — reset link and live token — and
returns `success: true`; `forgot-password` then reports the link "has been dispatched". Verified in
the `NODE_ENV=production` container: the token is in `docker logs`. Anyone with log access can
take over any account that requested a reset in the last hour, and the user is told an email was
sent that never was. (The route also ignores `sendPasswordResetEmail`'s `success:false`, so a real
provider outage is likewise reported as success.) **Suggestion:** in production, refuse to start
(or refuse the feature) without a mail key, never log tokens, and surface send failures.
*Not tested:* a configured/fake key — that would POST the recipient's address to api.brevo.com, and
QA does not send data to third parties.

## Finding 17 — timing side channel on `forgot-password`

**Severity:** Low–Medium. Only the existing-account path does DB writes **and awaits the email
send**. Measured median latency (simulated email, local): **existing 4.1 ms vs unknown 1.7 ms**
(~2.4×); with a real Brevo HTTP call the gap becomes the provider's latency (tens–hundreds of
ms), which is trivially measurable. Bodies/status are identical (verified), so this is the only
remaining enumeration channel. **Suggestion:** send the email off the request path (fire and
forget, as the "password changed" notice already is), or pad to constant time.

## Findings 18, 19, 21, 22 (Low)

- **18 — docs vs behaviour.** §1.7's message is *"If an account exists with this email, password
  reset instructions have been dispatched."* — the API returns *"If an account exists for this
  email address, a password reset link has been dispatched. Please check your inbox."* §1.6's 401
  body is `"Unauthorized"`; the API returns `"Unauthorized access. Authentication token required."`;
  §1.8 documents one merged error string where the API has separate *invalid/used* and *expired*
  messages; `hasPassword` on `/auth/me` is undocumented. (Marked in
  `api/15-password-management.spec.ts`.)
- **19 — password handling.** bcrypt only uses the first 72 bytes: an account whose password is 72
  `a`s + `SUFFIX-ONE` also logs in with 72 `a`s + `DIFFERENT` (pre-existing in `/register`; now
  also via change/reset). There is no maximum length, and a 6-space password is accepted
  (minimum is length 6 only).
- **21 — `hasPassword` never reaches the UI.** Only `/auth/me` returns it; login/register/google do
  not, and the UI stores the login response, so `u.hasPassword === false` (the "Set Account
  Password" branch for Google-only users) can never be true. Google-only users simply see the
  normal "current password" field (the server still lets them set a first password without it).
- **22 — token stays in the URL.** After a successful reset the address bar and history still hold
  `#reset-password?token=…` (the token is dead by then, so risk is low, but it's avoidable with
  `history.replaceState`).

## What was verified as correct (strict checks that passed)

- **Single-use token, even under a race:** 5 concurrent resets with one token → exactly **one** 200,
  exactly one password takes effect.
- **No enumeration by response:** existing vs unknown email give identical status and body on
  forgot-password; wrong token / wrong email / unknown email give identical 400 bodies on reset.
- **A newer request invalidates the previous token;** validation failures (missing fields, short
  password) do **not** consume the token; a token for account A cannot reset account B.
- **Change password:** requires the current password; a wrong/missing one is a 400 and changes
  nothing; old password stops working and the new one works; one user's change never touches
  another's; unauthenticated → 401; `/me` reports `hasPassword`.
- **Robustness:** case/whitespace-insensitive email, padded token tolerated, hostile values in the
  reset link (`"><img onerror>`, `<script>`) are inert in the UI (no script, no injected markup).
- **Production mode:** the new 500s are masked ("Internal server error") and specific 400 messages
  pass through; `APP_URL` wins over forged `Origin`/`Referer`.
- **UI:** Forgot-Password ↔ Sign-In navigation, identical confirmation text for known/unknown
  emails, reset form via the emailed hash route, mismatch/wrong-token errors, a full end-to-end
  reset (new password signs in, old refused, link not reusable), and the Settings change-password
  card (wrong current, mismatch, success, form cleared, old password refused afterwards).
- **Migration:** `migrate.js` is idempotent across repeated container restarts.

## Not testable black-box (stated plainly)

- **Token expiry (1 h)** — needs DB access or waiting an hour; source-reviewed only. The branch
  returns a distinct message, which is fine.
- **Real email delivery / provider failure handling** — see Finding 20.
- **Rate limiting of the new endpoints** — they share the existing 50-attempts/15-min bucket per IP
  (measured: 429 at the 41st request in one sequence). Note the flip side: an attacker can keep
  requesting resets for a victim's email, which each invalidates the victim's pending link.

## Pre-deploy checklist (recommended)

| Must fix before production | |
|---|---|
| **14** Require `APP_URL` in production (fail fast); never use `Origin`/`Referer` for links | Account takeover |
| **13** Add `password_reset_tokens` to `schema.sql`; ensure every deploy runs `migrate.js` | Feature breaks |
| **15** Invalidate sessions on password change/reset | Stolen sessions persist |
| **20** Require a mail key in production; never log tokens; surface send failures | Token leak / silent non-delivery |
| **16** `typeof` guards on `token`, `email`, `currentPassword` | Public 500s |

Should fix soon: 17, 18, 19, 22, 21. Also confirm in the target environment that `APP_URL`,
`BREVO_API_KEY`, `BREVO_SENDER_EMAIL` are set correctly in the production `.env`.

## Changes to QA's own harness this round

- `api/15-password-management.spec.ts` (22 tests), `prodcheck/16-password-production.spec.ts` (4),
  `e2e/forgot-password.spec.ts` (6), `e2e/change-password.spec.ts` (4); `shared/mailbox.ts` reads
  the emailed link back from the API log (QA has no mail server).
- `docker-compose.test.yml`: `api-qa` now runs `node dist/db/migrate.js && node dist/server.js`,
  mirroring the production compose command (needed for Finding 13's table). New
  `npm run schema:check`. `docker-compose.prodcheck.yml`: `APP_URL` set on the healthy container.
- `test:e2e` is now **three** batches with an API reset between (`batch3` = the two new UI files),
  keeping each inside the shared 50-attempt auth budget.

## Method

Commit diff reviewed line by line (`authRoutes.ts`, `emailService.ts`, `migrate.ts`, frontend
`app.js`/`settings.js`/`apiClient.js`/`index.html`, docs). Live probes drove the API directly
(type-confusion, header injection, concurrency, session, timing), then were turned into permanent
tests. Results: API 112/112 (×2), E2E 13 + 16 + 10 = 39 (×2), prod-mode 10/10; `contract:check`
clean (pin refreshed — docs changed).
