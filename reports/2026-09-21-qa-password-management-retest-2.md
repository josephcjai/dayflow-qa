# DayFlow QA — Password Management, Second Retest (Findings 17, 18, 19, 23, 24) — 2026-09-21

Retest against the dev team's reply to the first retest. One commit landed (`165bd81`, "address QA
retest findings 17, 18, 19, 23, 24"). Same strict standard as before: this is what goes to
production.

**Verdict: four of the five claimed fixes are verified (17, 19, 23, 24), the fifth is one string
short (18). Every finding that blocked deployment is closed. But strict testing turned up four new
issues — one of them a genuine security defect in the reset endpoint (28) that also *corrects an
earlier QA claim* — and I recommend fixing 28 and 25 before go-live; both have small fixes.**

| | |
|---|---|
| **Prepared** | 2026-09-21 |
| **Commit tested** | `165bd81367798b7624316746484658e987afeecc` (`main`; still no tag after `v2.4.0`) |
| **Previous pin** | `0563993866efbbc74b11645d939fd77a469b953a` |
| **Dev reply reviewed** | `temp/2026-09-21-qa-password-management-retest-reply.md` |

## Summary

**Regular suite: 165 checks passing** (125 API + 40 E2E), each run twice, plus **13/13** on the
production-mode containers (twice, on fresh containers). 5 of the API passes are known-defect
markers (tests asserting the correct behaviour that fail today): findings 18, 25, 26, 27, 28.

| # | Claim | QA verdict |
|---|---|---|
| **17** | forgot-password timing | ✅ **Fixed** — existing 116.2 ms vs unknown 116.1 ms, median ratio **1.00** (was 2.2×) |
| **19** | 72-**byte** password limit | ✅ **Fixed** on register / change / reset — but see **25** for a side effect |
| **23** | `displayName` validation | ✅ **Fixed** — object/array/101+ chars → 400; exactly 100 accepted |
| **24** | session check fails open | ✅ **Fixed** — malformed `userId` → 401; DB unreachable → **503**, and a *revoked* token is still refused |
| **18** | docs verbatim | ⚠️ **Almost** — 1 message still differs (the reset-password *success* text) |
| **25** | *new* legacy accounts with >72-byte passwords are locked out | **Open — Medium** (deploy risk) |
| **26** | *new (pre-existing)* login timing reveals whether an email is registered | **Open — Medium/Low** (~20×) |
| **27** | *new (pre-existing)* register email >255 chars → 500 | **Open — Low** |
| **28** | *new (pre-existing)* a reset token can be spent several times concurrently | **Open — Medium** (security) |

---

## Verified fixed — how each was checked

- **17.** 30 interleaved pairs against forgot-password: existing account median 116.1 ms / p95 118.7 ms,
  unknown email median 116.2 ms / p95 119.1 ms — indistinguishable. (The mechanism is a 100 ms
  floor plus a dummy query; the earlier 2.2× gap is gone.)
- **19.** `é×40 + suffix` (84 bytes), `é×37` (74), `😀×19` (76) are refused with *"Password cannot
  exceed 72 bytes"* on register, change-password and reset-password; exactly 72 bytes (`é×36`,
  `😀×18`, 72 ASCII) is accepted; login refuses anything over 72 bytes with the generic 401.
- **23.** Object, array and 101-character `displayName` → 400 with a clear message; exactly 100 works.
- **24.** Forged tokens with `userId` = `"not-a-uuid"`, an object, a number, `""`, or 500 characters →
  **401** with no Postgres text. In the production container with an unreachable database, both a
  *revoked* token (password changed on the healthy container) and a *current* token get **503**
  ("temporarily unavailable") — no route runs, nothing leaks. (An older prod-mode test that
  encoded the previous "masked 500 from the route" behaviour was updated: 503 is the intended new
  contract.)

## Finding 28 (new) — a reset token can be spent more than once — and a correction

**Severity:** Medium · `authRoutes.ts` `/reset-password`

**Correction first.** QA's first review listed *"a reset token is single-use, even under a
concurrent race"* as verified-correct, based on 5 concurrent requests. That was too weak a test: the
requests happened to serialise. The check was re-run at 8 concurrent requests during this retest
after an unexplained flaky failure of that very test, and the result is unambiguous:

```
14 tokens x 8 concurrent requests — successes per token: {2: 1, 4: 4, 5: 4, 6: 4, 7: 1}   (1 is correct)
```
**Every one of 14 tokens was accepted 2–7 times.** Cause: the route reads the token (`used = false`),
then hashes the new password (bcrypt, ~60–100 ms), and only *afterwards* marks it used — every
request that arrives inside that window passes the check. Each success also bumps `token_version`,
and the last writer's password wins. Practical risk: someone who has intercepted a reset link (mail
compromise, shoulder-surf, a log) can race the owner's own submission and overwrite it, within a
~100 ms window that the single-use guarantee is supposed to close. Sequential replay *is* correctly
refused (verified). **Suggestion:** consume the token atomically before doing the slow work —
`UPDATE password_reset_tokens SET used = TRUE WHERE id = $1 AND used = FALSE AND expires_at > now()
RETURNING id` — and proceed only if a row comes back. Held as a marker that requires *every* one of
three independent tokens to be spent exactly once (a single token can occasionally serialise by luck).

## Finding 25 (new) — accounts registered with a long password can no longer sign in

**Severity:** Medium (deploy risk) · `authRoutes.ts` `/login`

The 72-byte rule was added to login as well: any password over 72 bytes is rejected with the
generic 401 *before* comparing. But until this commit, long passwords were **legal**. Verified with a
historical account simulated in QA's own throwaway DB (an 80-character password): signing in with
its real password → **401 "Invalid email or password"**; signing in with only its **first 72
characters → 200**. So an existing user with a long password (a password-manager passphrase, say)
is silently locked out and cannot know the truncation trick; their only route back is
forgot-password, which needs a working mail provider. There is no way to count the affected users
from outside (the hash does not reveal length). **Suggestion:** on login, compare against the
password truncated to 72 bytes — exactly what bcrypt did before, so nobody is locked out — while
still refusing new long passwords at register/change/reset.

## Finding 26 (new, pre-existing) — login timing reveals whether an email is registered

**Severity:** Medium/Low · `/login`. Dev has now padded forgot-password to a flat 100 ms to hide
whether an account exists — but `/login` still runs bcrypt only when the email exists. 15 wrong-password
attempts each, identical `401` bodies: **existing account median 65.2 ms vs unknown email 3.3 ms
(~20×)**. That is far easier to read than the gap just closed, and makes the padding above moot for
an attacker who can simply try to sign in. **Suggestion:** always run a bcrypt compare (against a
fixed dummy hash when the email is unknown).

## Finding 27 (new, pre-existing) — email length is not validated

**Severity:** Low. Same class as the `displayName` finding just fixed: `users.email` is
`varchar(255)`, `register` only checks the type, and a 256-character (or longer) email returns
**500** with the raw DB message (*"value too long for type character varying(255)"*) outside
production. **Suggestion:** cap at 254/255 → 400.

## Finding 18 — one string left

Now verbatim in the docs: every register/login/change/forgot/stale-session/72-byte/displayName
message and the corrected §1.8 error strings. **Still different:** the reset-password *success*
message — the API returns *"Password has been reset successfully. You can now sign in with your new
password."*. A test enforces the rule "every message the API returns must appear verbatim".

## Deploy checklist (updated)

| | |
|---|---|
| **Fix 28 before go-live** (atomic token consumption — a few lines) | Security: single-use guarantee |
| **Fix 25 before go-live** (truncate to 72 bytes on login) | Silent lockout of existing users |
| Unchanged from before: run `migrate.js` *before* starting the new code; set `APP_URL`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`; do one manual end-to-end check against real Brevo (QA cannot — it would send addresses to a third party) | Availability / the one untested path |
| Track after deploy: **26** (login timing), **27** (email length), **18** (one doc string) | Lower risk |

## Method

Server diff reviewed line by line, then each claim attacked directly: 30-pair interleaved timing
(forgot and login), multibyte/emoji byte boundaries on all three endpoints, forged tokens against
the middleware, an unreachable-DB production container with a revoked token, a simulated legacy
long-password account, and a concurrent-spend loop (14 tokens × 8 requests, fresh rate-limit bucket
per iteration). Harness changes: `shared/legacyAccount.ts` (**the one documented exception to
"public API only"** — writes a bcrypt hash into QA's *own* throwaway DB for a user registered
through the API, to model data that predates a rule); the API spec split into more groups so each
stays inside the shared 50-attempt auth budget; `prodcheck/15` and `16` updated for the 503
contract. Results: API 125/125 (×2), E2E 13 + 16 + 11 = 40 (×2), prod-mode 13/13 (×2, fresh
containers); `contract:check` and `schema:check` clean.
