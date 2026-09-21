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

// Columns too (added 2026-09-21 — token_version was added to BOTH, but the class of bug is the same):
// every "ALTER TABLE t ADD COLUMN IF NOT EXISTS c" in migrate.ts must have column c declared in
// schema.sql's CREATE TABLE t.
const tableBody = (sql, t) => {
  const m = new RegExp('CREATE TABLE(?: IF NOT EXISTS)?\\s+' + t + '\\s*\\(([\\s\\S]*?)\\n\\);', 'i').exec(sql);
  return m ? m[1].toLowerCase() : '';
};
const missingCols = [...migrate.matchAll(/ALTER TABLE\s+([a-z_]+)\s+ADD COLUMN IF NOT EXISTS\s+([a-z_]+)/gi)]
  .map((m) => [m[1].toLowerCase(), m[2].toLowerCase()])
  .filter(([t, c]) => !new RegExp('(^|\\s)' + c + '\\s', 'm').test(tableBody(schema, t)))
  .map(([t, c]) => t + '.' + c);

if (missing.length || missingCols.length) {
  if (missing.length) console.error('❌ schema.sql is missing table(s) that migrate.ts creates: ' + missing.join(', '));
  if (missingCols.length) console.error('❌ schema.sql is missing column(s) that migrate.ts adds: ' + missingCols.join(', '));
  process.exit(1);
}
console.log('✅ schema.sql contains all ' + inMigrate.size + ' tables (and every added column) migrate.ts creates.');
