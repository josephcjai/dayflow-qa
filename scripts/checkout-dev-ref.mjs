#!/usr/bin/env node
/**
 * Pulls a shallow, read-only checkout of the DayFlow dev repo at the ref pinned in
 * DAYFLOW_PINNED_REF, into a gitignored, disposable directory. Never pushes, never branches,
 * never commits anything back — see docs/GROUND_RULES.md.
 *
 * Also drops QA's own Dockerfile into the checkout as `server/Dockerfile.qa` so
 * docker-compose.test.yml can build with a plain relative `dockerfile:`. That file lives only in
 * the throwaway checkout (recreated every run, gitignored) — nothing is written back to the real
 * DayFlow repo.
 */
import { execSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, cpSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_URL = 'https://github.com/josephcjai/DayFlow.git';
const ref = readFileSync(path.join(repoRoot, 'DAYFLOW_PINNED_REF'), 'utf8').trim();
const checkoutDir = path.resolve(
  repoRoot,
  process.env.DEV_CHECKOUT_DIR || '.dev-checkout/DayFlow'
);

const isFullSha = /^[0-9a-f]{40}$/i.test(ref);

function freshDir() {
  if (existsSync(checkoutDir)) rmSync(checkoutDir, { recursive: true, force: true });
  mkdirSync(checkoutDir, { recursive: true });
}

freshDir();
console.log(`Checking out DayFlow @ "${ref}" (read-only) into ${checkoutDir} ...`);

if (isFullSha) {
  // A tag/branch name works with `clone --branch`; a raw commit SHA doesn't (git rejects it as
  // an unknown ref for that flag even though GitHub will happily serve it) — fetch it directly
  // instead. Used when DAYFLOW_PINNED_REF is pinned to an exact commit because no tag exists yet
  // for what's being tested (see docs/TECHNICAL_PLAN.md's pinning notes).
  execSync(`git init -q "${checkoutDir}"`, { stdio: 'inherit' });
  execSync(`git -C "${checkoutDir}" remote add origin ${REPO_URL}`, { stdio: 'inherit' });
  execSync(`git -C "${checkoutDir}" fetch --depth 1 origin ${ref}`, { stdio: 'inherit' });
  execSync(`git -C "${checkoutDir}" checkout FETCH_HEAD`, { stdio: 'inherit' });
} else {
  try {
    execSync(`git clone --branch ${ref} --depth 1 ${REPO_URL} "${checkoutDir}"`, {
      stdio: 'inherit',
    });
  } catch {
    console.warn(
      `\n⚠️  No git tag/branch named "${ref}" exists on DayFlow (yet). Falling back to main@HEAD` +
        ` so the stack can still come up.`
    );
    console.warn(
      `   This means the suite is NOT actually pinned to "${ref}" right now — ask the dev team to` +
        ` tag releases (e.g. "git tag ${ref} && git push --tags") so QA's pin is exact, then bump` +
        ` DAYFLOW_PINNED_REF here to match.\n`
    );
    freshDir();
    execSync(`git clone --depth 1 ${REPO_URL} "${checkoutDir}"`, { stdio: 'inherit' });
  }
}

cpSync(
  path.join(repoRoot, 'docker', 'api.Dockerfile'),
  path.join(checkoutDir, 'server', 'Dockerfile.qa')
);

console.log('✅ Read-only checkout ready.');
