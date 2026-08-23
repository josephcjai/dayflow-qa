#!/usr/bin/env node
/**
 * Polls a health-check URL until it responds 200 or the timeout elapses.
 * Usage: node scripts/wait-for-health.mjs [url] [timeoutMs]
 * Defaults to the QA API's own /api/health (bypassing nginx) so CI can gate on the stack being
 * up before running any suite.
 */
const url = process.argv[2] || `http://localhost:${process.env.QA_API_PORT || 5100}/api/health`;
const timeoutMs = Number(process.argv[3] || 90_000);
const start = Date.now();

async function main() {
  console.log(`Waiting for ${url} ...`);
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        console.log(`✅ ${url} is healthy (${Math.round((Date.now() - start) / 1000)}s)`);
        return;
      }
    } catch {
      // not up yet, keep polling
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.error(`❌ ${url} did not become healthy within ${timeoutMs}ms`);
  process.exit(1);
}

main();
