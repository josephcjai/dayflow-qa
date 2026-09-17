/**
 * Thin black-box HTTP client for the DayFlow API. Deliberately just `fetch` against a base URL —
 * QA never imports the dev repo's Express `app` object (no `supertest(app)`), because that would
 * make this repo depend on dev source as a library, not just as a running black box. See
 * docs/GROUND_RULES.md and docs/ARCHITECTURE.md §1.
 *
 * Shared by api/, e2e/ fixture setup, and (per docs/ARCHITECTURE.md §5) will be reused as-is by
 * mobile/ once that layer exists — a Flutter app talks to the same REST contract.
 */
import { ENV } from './env.js';

export interface ApiResponse<T = any> {
  status: number;
  ok: boolean;
  body: T;
  /** Lower-cased response header names to values — added 2026-09-17 to check Helmet's security
   *  headers without reaching for a raw `fetch` in the spec files themselves. */
  headers: Record<string, string>;
}

export class ApiClient {
  constructor(
    private baseUrl: string = ENV.apiBaseUrl,
    private token?: string
  ) {}

  /** Returns a new client authenticated as the given token — the original is untouched. */
  as(token: string | undefined): ApiClient {
    return new ApiClient(this.baseUrl, token);
  }

  async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let parsed: any = undefined;
    const text = await res.text();
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }

    return { status: res.status, ok: res.ok, body: parsed as T, headers: Object.fromEntries(res.headers.entries()) };
  }

  /** Raw request bypassing JSON.stringify — for payload-size / malformed-body checks where the
   *  body must be sent as literal bytes, not re-encoded. */
  async rawRequest(
    method: string,
    path: string,
    rawBody?: string,
    extraHeaders: Record<string, string> = {}
  ): Promise<ApiResponse> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const res = await fetch(`${this.baseUrl}${path}`, { method, headers, body: rawBody });
    let parsed: any = undefined;
    const text = await res.text();
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    return { status: res.status, ok: res.ok, body: parsed, headers: Object.fromEntries(res.headers.entries()) };
  }

  get<T = any>(path: string, extraHeaders?: Record<string, string>) {
    return this.request<T>('GET', path, undefined, extraHeaders);
  }
  post<T = any>(path: string, body?: unknown, extraHeaders?: Record<string, string>) {
    return this.request<T>('POST', path, body, extraHeaders);
  }
  patch<T = any>(path: string, body?: unknown, extraHeaders?: Record<string, string>) {
    return this.request<T>('PATCH', path, body, extraHeaders);
  }
  delete<T = any>(path: string, body?: unknown, extraHeaders?: Record<string, string>) {
    return this.request<T>('DELETE', path, body, extraHeaders);
  }
}
