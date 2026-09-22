# DayFlow QA — Password Management, Third Retest (Findings 18, 25, 26, 27, 28) — 2026-09-22

Retest against the dev team's reply to the second retest. One commit landed (`448ea06`, "address
QA second retest findings 18, 25, 26, 27, 28"). Same strict standard: this is what goes to
production.

**Verdict: all five claimed fixes are verified. This closes every finding raised across the entire
password-management review (13 through 28) — no `it.fails` markers remain in the password test
file, and no new findings were found this round despite deliberately probing the edges of each
fix (wrong long passwords, boundary email lengths, higher concurrency, three-way timing).**

| | |
|---|---|
| **Prepared** | 2026-09-22 |
| **Commit tested** | `448ea0686ca24571c0fe18b766d6f183bccf30b4` (`main`; still no tag past `v2.4.0`) |
| **Previous pin** | `165bd81367798b7624316746484658e987afeecc` |
| **Dev reply reviewed** | `temp/2026-09-22-qa-password-management-retest-2-reply.md` |

## Summary

**Regular suite: 166 checks passing** (126 API + 40 E2E), each run twice, plus **13/13** on the
production-mode containers (unaffected by this round's changes, confirmed on a fresh run). **Zero
known-defect markers remain** in `api/15-password-management.spec.ts` — the first time that has
been true since this feature started.

| # | Claim | QA verdict |
|---|---|---|
| **28** | Reset token consumed atomically before hashing | ✅ **Fixed** — 0/5 wrong-count at 10-way concurrency, 0/3 at 8-way (re-verified after this round's own tests) |
| **25** | Login truncates >72-byte passwords instead of rejecting | ✅ **Fixed** — legacy 80-byte password logs in; a *different* 80-byte password is still correctly rejected; short-password accounts unaffected |
| **26** | Login timing equalized (dummy bcrypt compare) | ✅ **Fixed** — existing-wrong 62.7 ms vs unknown-email 62.3 ms, ratio **1.01** (was ~20×) |
| **27** | Register rejects email > 255 chars | ✅ **Fixed** — 256 chars → 400; exactly 255 → 200 |
| **18** | Reset-password success message documented verbatim | ✅ **Fixed** — confirmed against the refreshed contract pin |

## Verified fixed — how each was checked

- **Finding 28.** Beyond this round's own regression suite (3 independent tokens × 8 concurrent
  requests, each exactly 1 success), ran an additional check at 10-way concurrency across 5 fresh
  tokens: 0 of 5 showed a wrong success count. Sequential replay after a successful reset is still
  correctly refused (3 attempts, all 400).
- **Finding 25.** A simulated legacy account (80-byte password, via `shared/legacyAccount.ts`) now
  logs in with its real password (200). Two things dev's fix could plausibly have gotten wrong were
  checked and are both fine: a **different** 80-byte password sharing no meaningful prefix is still
  refused (401), and a completely ordinary short-password account is unaffected by the new
  truncate-before-compare logic (real password → 200, real password + 80 bytes of garbage → 401).
  One expected, non-new residual noted below.
- **Finding 26.** 25 interleaved pairs (existing account, wrong password) vs. (unknown email, same
  wrong password): medians 62.7 ms vs 62.3 ms, ratio 1.01. `bcrypt.compare` against the fixed dummy
  hash costs the same as a real compare, as intended.
- **Finding 27.** 256-character email → 400 (`"Email address cannot exceed 255 characters"`);
  exactly 255 → 200. Also checked the same class of overlong email against `forgot-password` and
  `login` (both routes that don't insert a row) — neither 500s; `forgot-password` returns its usual
  generic 200 (no enumeration change), `login` returns the usual 401.
- **Finding 18.** The reset-password success message now appears verbatim in the refreshed contract
  pin. A permanent regression test enforces this for every message these three endpoints return, not
  just the ones fixed so far — this is the same class of gap (docs trailing the API) that took three
  rounds to fully close, so it is worth keeping a standing guard rather than treating it as one-off.

## Expected, not a new finding: bcrypt's ordinary 72-byte equivalence, restored for legacy accounts

Truncating the supplied password to 72 bytes on login (Finding 25's fix) reintroduces bcrypt's
normal behavior for any account whose stored hash predates the limit: two different long passwords
sharing the same first 72 bytes both work. Confirmed live and **not filed as a finding** — it is
the exact, unavoidable trade-off of "an existing user's real password must keep working" (which is
what Finding 25 asked for), it only applies to legacy accounts (register/change/reset still refuse
to *create* a password over 72 bytes), and it is no different from how bcrypt has always behaved
everywhere else. Worth knowing, not worth fixing.

## Two bugs found and fixed in QA's own new tests this round

Not app defects — recorded for transparency, per this project's practice of not quietly patching
its own mistakes:
1. The Finding 27 boundary-length email test used a **fixed literal string**. `stack:reset-api`
   only restarts the API container (Postgres data persists between runs, by design — see
   `docker-compose.test.yml`), so the second run of the suite hit "an account with this email
   already exists" (400) instead of exercising the boundary at all. Fixed by making the boundary
   email unique per run while keeping it exactly 255 characters.
2. The Finding 18 doc-parity test called `forgot-password` a second time (to check its own message)
   *before* using the token obtained by an earlier `requestReset` call — which invalidates that
   token, since a newer forgot-password request correctly invalidates the previous one (verified
   correct behavior elsewhere in this file). The 'reset success' check was silently failing against
   an already-invalidated token. Fixed by reordering: consume that token for its own check first.

## Also noticed (not filed — genuinely untestable black-box)

`authRoutes.ts`'s `/auth/google` handler changed an unrelated response (`payload.email` missing →
`400` with *"Unable to verify Google user payload"* is now `401` with *"Unable to verify Google
credential token."*) as an incidental part of this commit. This branch only runs for a token that
**passes** Google's signature verification but carries no email claim — not reachable with a
garbage or malformed credential, so this suite cannot exercise it (same category of limitation
`api/11-google-auth.spec.ts`'s header already documents for the rest of the Google flow). Confirmed
the existing garbage-credential tests are unaffected (still 401, unrelated code path).

## Recommended next steps

None blocking. The password-management feature has no open findings as of this commit. Only the
pre-existing, unrelated item stands: **still no tag past `v2.4.0`**.

## Method

Server diff reviewed line by line. Each fix attacked with fresh probes before any test was edited:
wrong-vs-correct long passwords against a simulated legacy account, boundary and over-limit email
lengths against three different endpoints, 25-pair interleaved login timing, and reset-token
concurrency at both 8-way (3 tokens) and 10-way (5 tokens). `api/15-password-management.spec.ts`'s
five remaining `it.fails` markers were converted to plain `it`s only after each was independently
reproduced as fixed; two markers uncovered bugs in the QA tests themselves during that process (see
above), both fixed before being counted as passing. `prodcheck/15` and `16` re-run on fresh
containers, unaffected by this round's changes. Results: API 126/126 (×2), E2E 13+16+11 = 40 (×2),
prod-mode 13/13; `contract:check` and `schema:check` clean.
