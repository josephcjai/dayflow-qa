/**
 * Simulates a HISTORICAL account — one created before a validation rule existed — which cannot be
 * made through the public API any more. Used only for the "does the new rule lock out accounts that
 * predate it?" class of check (Finding 25: passwords longer than 72 bytes were legal until commit
 * 165bd81, and login now rejects them).
 *
 * This is the one deliberate exception to "self-provision through the public API only"
 * (docs/GROUND_RULES.md): it writes a bcrypt hash straight into QA's OWN throwaway Postgres
 * container (never a dev/shared database), on a user that was itself registered through the API.
 * The hash is produced by the API container's own bcryptjs so it is exactly what the app would have
 * stored at the time. Kept in one clearly named helper so the exception is easy to find and audit.
 */
import { execFileSync } from 'node:child_process';

export function setStoredPasswordDirectly(userId: string, plaintext: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('userId must be a UUID');
  const hash = execFileSync(
    'docker',
    ['exec', 'dayflow-qa-api', 'node', '-e', `console.log(require('bcryptjs').hashSync(${JSON.stringify(plaintext)}, 10))`],
    { encoding: 'utf8' }
  ).trim();
  execFileSync(
    'docker',
    ['exec', 'dayflow-qa-postgres', 'psql', '-U', 'dayflow_qa', '-d', 'dayflow_qa', '-c', `UPDATE users SET password_hash='${hash}' WHERE id='${userId}'`],
    { stdio: 'ignore' }
  );
}
