/**
 * API base URL resolution
 *
 * - **Local dev:** defaults to `http://localhost:8000`.
 * - **Railway / split deploy:** the site URL (static) is usually **not** the API. Set
 *   `VITE_API_BASE_URL` to your **FastAPI** public URL at **build** time, e.g.
 *   `https://your-backend-service.up.railway.app` (no trailing slash).
 * - **Monolith** (API + static on same host): set `VITE_USE_SAME_ORIGIN_API=true` at build.
 * - **Emergency override (browser):** `localStorage.setItem('goodjobs_api_base', 'https://…'); location.reload()`
 */

import { expectsRealBackend, hasExplicitApiBaseUrl, isSameOriginApiMode, trimApiOrigin } from './env';

function buildTimeBase(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (raw) return trimApiOrigin(raw);
  if (import.meta.env.DEV) return 'http://localhost:8000';
  if (isSameOriginApiMode() && typeof window !== 'undefined') {
    return trimApiOrigin(window.location.origin);
  }
  if (import.meta.env.PROD && typeof window !== 'undefined') {
    console.warn(
      '[GoodJobs] Production build without VITE_API_BASE_URL. Using this page origin for API calls. ' +
        'If POST /auth/login returns 405, this host only serves static files — set VITE_API_BASE_URL to your FastAPI Railway URL and rebuild. ' +
        'Or temporarily: localStorage.setItem("goodjobs_api_base","https://YOUR-API.up.railway.app"); location.reload()',
    );
    return trimApiOrigin(window.location.origin);
  }
  return typeof window !== 'undefined' ? trimApiOrigin(window.location.origin) : '';
}

/**
 * Effective API origin: optional runtime override, then build-time / defaults.
 */
export function getApiBaseUrl(): string {
  try {
    const fromLs = localStorage.getItem('goodjobs_api_base')?.trim();
    if (fromLs) return trimApiOrigin(fromLs);
  } catch {
    /* private mode */
  }
  return buildTimeBase();
}

async function maybeMockFallback(path: string, init: RequestInit | undefined, noMock: boolean): Promise<Response | null> {
  if (noMock || expectsRealBackend()) return null;
  const { mockResponse, isMockEnabled } = await import('./mockBackend');
  if (!isMockEnabled()) return null;
  return mockResponse(path, init);
}

/** @deprecated Use getApiBaseUrl() — does not include localStorage override */
export const API_BASE_URL = buildTimeBase();

export { expectsRealBackend, hasExplicitApiBaseUrl, isSameOriginApiMode } from './env';

export type StoredAuth = { token?: string } | null;

export function getAccessToken(): string | null {
  const direct = localStorage.getItem('access_token');
  if (direct) return direct;

  try {
    const raw = localStorage.getItem('sevasuite_auth');
    if (!raw) return null;
    const parsed: StoredAuth = JSON.parse(raw);
    return parsed?.token ?? null;
  } catch {
    return null;
  }
}

/**
 * Extra options layered on top of the standard `RequestInit`.
 *
 * `noMockFallback` — when true, `apiFetch` never falls through to the local
 * mock backend on connection / 404 / 405 errors. Use this for endpoints
 * where a silent mock-success would create a *false-green* (e.g. donor
 * lifecycle persistence and outreach sends — Task #9): we'd rather the
 * caller see a real failure and surface "send failed, please retry" than
 * mark a milestone done because the mock cheerfully returned 200.
 */
export interface ApiFetchInit extends RequestInit {
  noMockFallback?: boolean;
}

export async function apiFetch(path: string, init: ApiFetchInit = {}): Promise<Response> {
  const base = getApiBaseUrl();
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  // Strip our custom field before handing to fetch so it doesn't end up on
  // the actual Request init.
  const { noMockFallback: _nmf, ...fetchInit } = init;
  void _nmf;
  const method = (fetchInit.method ?? 'GET').toUpperCase();
  const noMock =
    init.noMockFallback === true
    || (expectsRealBackend() && !['GET', 'HEAD', 'OPTIONS'].includes(method));

  if (!headers.has('Authorization')) {
    const token = getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  try {
    const res = await fetch(url, { ...fetchInit, headers });
    // Some hosts (the static-site origin) answer with HTML 404/405 for API
    // paths instead of refusing the connection. Treat those as "no backend"
    // and fall through to the local mock so the UI keeps working — but only
    // when the mock is actually enabled (i.e. dev / static-only deploys).
    // If a real backend is configured and returns 404, surface the real 404
    // so we don't silently mask backend bugs.
    // Detect non-JSON response (HTML SPA fallback or error page).
    // Static Vite deployments return 200 + index.html for every route, so
    // res.ok is true but res.json() would throw. Treat any non-JSON reply
    // as "no real backend" and route through the mock when mock is active.
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      const mocked = await maybeMockFallback(path, fetchInit, noMock);
      if (mocked) return mocked;
      if (expectsRealBackend()) {
        return new Response(
          JSON.stringify({
            error: 'backend_non_json',
            detail: 'API returned HTML instead of JSON. Check VITE_API_BASE_URL / Railway deploy.',
          }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }
    if (!noMock && (res.status === 404 || res.status === 405 || res.status === 502 || res.status === 503)) {
      if (!ct.includes('application/json')) {
        const mocked = await maybeMockFallback(path, fetchInit, noMock);
        if (mocked) return mocked;
      }
    }
    return res;
  } catch {
    // TypeError from fetch usually means: connection refused, DNS failure, or
    // CORS preflight blocked — i.e. there is no reachable backend. Synthesise
    // a plausible response so the UI stays usable end-to-end. mockResponse
    // itself respects isMockEnabled() and returns 503 if the operator has
    // disabled the fallback explicitly.
    if (noMock) {
      // Caller has explicitly opted out of mock fallback (e.g. an outreach
      // send): surface a real failure so the UI doesn't false-green.
      return new Response(
        JSON.stringify({ error: 'Backend unreachable.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }
    const mocked = await maybeMockFallback(path, fetchInit, noMock);
    if (mocked) return mocked;
    return new Response(
      JSON.stringify({ error: 'Backend unreachable.', detail: 'Network error or CORS blocked.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
