/**
 * Added 2026-09-17 for commit 1be7769 ("feat: production hardening, HTTPS reverse proxy,
 * database migration decoupling, and process resilience"). Covers the parts of that commit
 * observable through the QA stack as it's normally configured (NODE_ENV=test) — see
 * api/15-production-mode.spec.ts for the parts that only activate when NODE_ENV=production,
 * which needs a dedicated environment (Helmet, the 404 fallback, the payload limit, and the
 * richer health check are unconditional — they apply regardless of NODE_ENV, confirmed against
 * server.ts).
 */
import { describe, it, expect } from 'vitest';
import { ApiClient } from '../shared/apiClient.js';

const api = new ApiClient();

describe('Production hardening — Helmet, 404 fallback, health check, payload limit', () => {
  it('every response carries Helmet security headers', async () => {
    const res = await api.get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
    // CSP allows Google's own origins (needed for Sign-In) plus 'unsafe-inline' for scripts/styles
    // — confirmed present, not asserting a full policy match since that's an implementation detail
    // Helmet may reformat.
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['content-security-policy']).toMatch(/accounts\.google\.com/);
  });

  it('GET /api/health now reports live database connectivity, not just process liveness', async () => {
    const res = await api.get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('online');
    expect(res.body.database).toBe('connected');
    expect(res.body.service).toBe('DayFlow API Server');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('an unmatched /api route gets a clean, structured 404 instead of falling through to the SPA/static handler', async () => {
    const res = await api.get('/totally-not-a-real-route');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/API route not found: GET \/api\/totally-not-a-real-route/);
  });

  it('a request body over the 200kb limit is rejected with 413, not left to hang or crash the process', async () => {
    const oversized = JSON.stringify({ text: 'a'.repeat(250_000) });
    const res = await api.rawRequest('POST', '/auth/register', oversized);
    expect(res.status).toBe(413);
  });

  it('the base info endpoint reflects the new version and the Google auth endpoint', async () => {
    const res = await api.get('');
    expect(res.body.version).toBe('2.4.0');
    expect(res.body.endpoints.auth).toMatch(/POST \/google/);
  });
});
