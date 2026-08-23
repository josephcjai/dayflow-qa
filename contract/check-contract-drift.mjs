#!/usr/bin/env node
/**
 * Diffs QA's pinned copy (API_CONTRACT.md, below the HTML comment header) against the live copy
 * inside the checked-out pinned ref (docs/API_DOCUMENTATION.md). Fails loudly on drift rather
 * than letting testers discover a breaking API change via a mysteriously failing assertion —
 * see docs/TECHNICAL_PLAN.md's "Contract drift" section.
 *
 * Requires `npm run checkout:dev-ref` to have run first.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pinnedCopyPath = path.join(repoRoot, 'contract', 'API_CONTRACT.md');
const checkoutDir = path.resolve(
  repoRoot,
  process.env.DEV_CHECKOUT_DIR || '.dev-checkout/DayFlow'
);
const liveCopyPath = path.join(checkoutDir, 'docs', 'API_DOCUMENTATION.md');

if (!existsSync(liveCopyPath)) {
  console.error(
    `❌ ${liveCopyPath} not found. Run "npm run checkout:dev-ref" first (or the dev team moved/` +
      `renamed their contract doc — update DEV_CHECKOUT_DIR-relative path above if so).`
  );
  process.exit(1);
}

const pinnedRaw = readFileSync(pinnedCopyPath, 'utf8');
const liveRaw = readFileSync(liveCopyPath, 'utf8');

// Strip QA's leading HTML-comment header before comparing — everything after it should be a
// verbatim copy of the dev team's file.
const pinnedBody = pinnedRaw.replace(/^<!--[\s\S]*?-->\s*/, '').trim();
const liveBody = liveRaw.trim();

if (pinnedBody === liveBody) {
  console.log('✅ contract/API_CONTRACT.md matches DayFlow/docs/API_DOCUMENTATION.md exactly.');
  process.exit(0);
}

console.error('❌ Contract drift detected between contract/API_CONTRACT.md and the pinned ref.');
console.error(
  '   The dev team changed docs/API_DOCUMENTATION.md without QA re-pinning it. Re-copy the file' +
    ' into contract/API_CONTRACT.md (below the header comment) as part of reviewing what changed' +
    ' — do not just silence this check.'
);
process.exit(1);
