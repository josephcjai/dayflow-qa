/**
 * Restarts a QA-stack container mid-suite — used only by api/restart-persistence.spec.ts to
 * prove data survives a real restart, not just a re-fetch in the same process (checklist item 6).
 * Only ever touches this repo's own docker-compose.test.yml, never anything dev-owned.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// import.meta.url, not __dirname — see the comment in shared/env.ts for why.
const here = path.dirname(fileURLToPath(import.meta.url));
const composeFile = path.resolve(here, '..', 'docker-compose.test.yml');
const repoRoot = path.resolve(here, '..');

export function restartQaContainers(...services: string[]): void {
  const target = services.length ? services.join(' ') : '';
  execSync(`docker compose -f "${composeFile}" --env-file .env.test restart ${target}`, {
    stdio: 'inherit',
    cwd: repoRoot,
  });
}

/** Polls `docker inspect`'s health status for a QA container until it reports "healthy". */
export async function waitForContainerHealthy(containerName: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const status = execSync(
        `docker inspect -f "{{.State.Health.Status}}" ${containerName}`,
        { cwd: repoRoot }
      )
        .toString()
        .trim();
      if (status === 'healthy') return;
    } catch {
      // container not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${containerName} did not report healthy within ${timeoutMs}ms`);
}
