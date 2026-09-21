/**
 * QA has no real mail server, and the API's EmailService (server/src/utils/emailService.ts) — when
 * BREVO_API_KEY is unset, as it is in every QA container — "simulates" sending by logging the
 * full message, reset link included, to stdout. That log line is the only channel a black-box test
 * has for the emailed reset token, so this reads it back from the container's logs. It never
 * touches the database or dev code; it observes an external side-effect of the public API, the
 * same way a tester would read a mail-catcher inbox.
 *
 * (Side effect worth knowing: it also means a production deployment WITHOUT BREVO_API_KEY writes
 * live reset tokens to its logs — reported in the 2026-09-21 report.)
 */
import { execFileSync } from 'node:child_process';

export interface ResetLink {
  base: string; // everything before "#reset-password"
  token: string;
  email: string;
  url: string;
}

function allLogs(container: string): string {
  // `docker logs` replays the container's stdout on our stdout and its stderr on ours; capture both.
  const r = execFileSync('docker', ['logs', container], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return r;
}

export function resetLinksFor(email: string, container = 'dayflow-qa-api'): ResetLink[] {
  const text = allLogs(container);
  const re = /(\S*)#reset-password\?token=([0-9a-f]{64})&email=(\S+)/g;
  const out: ResetLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let decoded = m[3];
    try {
      decoded = decodeURIComponent(m[3]);
    } catch {
      /* leave as-is */
    }
    if (decoded.toLowerCase() === email.toLowerCase()) {
      out.push({ base: m[1], token: m[2], email: decoded, url: m[0] });
    }
  }
  return out;
}

/** Polls the container logs until a (new) reset link for `email` appears; returns the latest. */
export async function waitForResetLink(
  email: string,
  opts: { container?: string; minCount?: number; timeoutMs?: number } = {}
): Promise<ResetLink> {
  const { container = 'dayflow-qa-api', minCount = 1, timeoutMs = 8000 } = opts;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const links = resetLinksFor(email, container);
    if (links.length >= minCount) return links[links.length - 1];
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no reset link #${minCount} for ${email} appeared in ${container} logs within ${timeoutMs}ms`);
}
