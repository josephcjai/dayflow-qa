#!/usr/bin/env node
/**
 * Guard added 2026-09-21. Every table the dev repo's migration script (server/src/db/migrate.ts —
 * run automatically by docker-compose.prod.yml) creates must ALSO exist in server/src/db/schema.sql,
 * which docs/DATABASE_SCHEMA.md names the "Primary Schema File" and which postgres-qa's initdb hook
 * loads. When they drift, any environment built from schema.sql breaks at runtime (this is exactly
 * how forgot-password ended up returning 500 for every existing account). Run by hand like
 * `npm run contract:check`; exits 1 with the missing tables listed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const checkout = process.env.DEV_CHECKOUT_DIR || path.join(root, '.dev-checkout', 'DayFlow');
const migrate = readFileSync(path.join(checkout, 'server/src/db/migrate.ts'), 'utf8');
const schema = readFileSync(path.join(checkout, 'server/src/db/schema.sql'), 'utf8');
const tables = (t) => new Set([...t.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+)/gi)].map((m) => m[1].toLowerCase()));
const inMigrate = tables(migrate), inSchema = tables(schema);
const missing = [...inMigrate].filter((t) => !inSchema.has(t));
if (missing.length) {
  console.error(`❌ schema.sql is missing table(s) that migrate.ts creates: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`✅ schema.sql contains all ${inMigrate.size} tables migrate.ts creates.`);
