/**
 * API base URL resolution
 *
 * - **Local dev:** defaults to `http://localhost:8000`.
 * - **Railway / split deploy:** set `VITE_API_BASE_URL` to your **FastAPI** public URL at **build**
 *   time (no trailing slash). You may pass **comma-separated fallbacks**, e.g.
 *   `https://wrong-label,https://goodjobs-api.up.railway.app` — the client probes
 *   until it receives JSON.
 * - **Monolith** (API + static on same host): set `VITE_USE_SAME_ORIGIN_API=true` at build.
 * - **Emergency override (browser):** `localStorage.setItem('goodjobs_api_base', 'https://…'); location.reload()`
 */

import {
  expectsRealBackend,
  hasExplicitApiBaseUrl,
  isSameOriginApiMode,
  trimApiOrigin,
} from './env';

const SESSION_PIN_KEY = 'goodjobs_api_base_pin';

function getPinnedSessionBase(): string | null {
  try {
    const p = sessionStorage.getItem(SESSION_PIN_KEY)?.trim();
    return p ? trimApiOrigin(p) : null;
  } catch {
    return null;
  }
}

function setPinnedSessionBase(url: string) {
  try {
    sessionStorage.setItem(SESSION_PIN_KEY, trimApiOrigin(url));
  } catch {
    /* private mode */
  }
}

/** Ordered list of origins to try (localStorage override → same-origin → env list → dev default). */
export function getApiBaseCandidates(): string[] {
  const out: string[] = [];
  const push = (u: string) => {
    const t = trimApiOrigin(u);
    if (t && !out.includes(t)) out.push(t);
  };

  try {
    const ls = localStorage.getItem('goodjobs_api_base')?.trim();
    if (ls) push(ls);
  } catch {
    /* private mode */
  }

  if (isSameOriginApiMode() && typeof window !== 'undefined') {
    push(window.location.origin);
  }

  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (raw) {
    for (const part of raw.split(',')) {
      if (part.trim()) push(part.trim());
    }
  }

  if (import.meta.env.DEV) {
    push('http://localhost:8000');
  }

  if (import.meta.env.PROD && !raw && !isSameOriginApiMode() && typeof window !== 'undefined') {
    console.warn(
      '[GoodJobs] Production build without VITE_API_BASE_URL. Using this page origin for API calls. ' +
        'If POST /auth/login returns HTML, set VITE_API_BASE_URL to your FastAPI Railway URL and rebuild. ' +
        'Comma-separated fallbacks are supported. Or: localStorage.setItem("goodjobs_api_base","https://YOUR-API…"); location.reload()',
    );
    push(window.location.origin);
  }

  return out;
}

function orderedApiBases(): string[] {
  const candidates = getApiBaseCandidates();
  const pin = getPinnedSessionBase();
  if (!pin) return candidates.length ? candidates : [typeof window !== 'undefined' ? trimApiOrigin(window.location.origin) : ''];
  const rest = candidates.filter((c) => c !== pin);
  return [pin, ...rest];
}

/**
 * Effective API origin: session pin (after a successful fallback), optional localStorage override,
 * then build-time / defaults.
 */
export function getApiBaseUrl(): string {
  const list = orderedApiBases();
  return list[0] ?? (typeof window !== 'undefined' ? trimApiOrigin(window.location.origin) : '');
}

/** First build-time origin only (no session pin / localStorage). For legacy callers. */
function primaryBuildTimeOrigin(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (raw) return trimApiOrigin(raw.split(',')[0].trim());
  if (import.meta.env.DEV) return 'http://localhost:8000';
  if (isSameOriginApiMode() && typeof window !== 'undefined') {
    return trimApiOrigin(window.location.origin);
  }
  if (typeof window !== 'undefined') return trimApiOrigin(window.location.origin);
  return '';
}

async function maybeMockFallback(
  path: string,
  init: RequestInit | undefined,
  noMock: boolean,
): Promise<Response | null> {
  if (noMock || expectsRealBackend()) return null;
  const { mockResponse, isMockEnabled } = await import('./mockBackend');
  if (!isMockEnabled()) return null;
  return mockResponse(path, init);
}

/** @deprecated Use getApiBaseUrl() — does not include runtime pin / full fallback list */
export const API_BASE_URL = primaryBuildTimeOrigin();

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
 * mock backend on connection / 404 / 405 errors.
 */
export interface ApiFetchInit extends RequestInit {
  noMockFallback?: boolean;
}

function shouldTryAlternateApiBase(res: Response): boolean {
  if (!expectsRealBackend()) return false;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return false;
  if (ct.includes('text/html')) return true;
  // Some static hosts return SPA shell as 200 with empty or generic content-type.
  if (res.ok && !ct) return true;
  return false;
}

export async function apiFetch(path: string, init: ApiFetchInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const { noMockFallback: _nmf, ...fetchInit } = init;
  void _nmf;
  const method = (fetchInit.method ?? 'GET').toUpperCase();
  const noMock =
    init.noMockFallback === true ||
    (expectsRealBackend() && !['GET', 'HEAD', 'OPTIONS'].includes(method));

  if (!headers.has('Authorization')) {
    const token = getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  let bases = orderedApiBases();
  if (bases.length === 0) {
    bases = [typeof window !== 'undefined' ? trimApiOrigin(window.location.origin) : ''];
  }

  let lastError: unknown = null;

  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];
    const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
    try {
      const res = await fetch(url, { ...fetchInit, headers });
      const ct = res.headers.get('content-type') ?? '';

      if (ct.includes('application/json')) {
        if (i > 0) setPinnedSessionBase(base);
        if (
          !noMock &&
          (res.status === 404 || res.status === 405 || res.status === 502 || res.status === 503)
        ) {
          const mocked = await maybeMockFallback(path, fetchInit, noMock);
          if (mocked) return mocked;
        }
        return res;
      }

      const mocked = await maybeMockFallback(path, fetchInit, noMock);
      if (mocked) return mocked;

      if (expectsRealBackend() && shouldTryAlternateApiBase(res) && i < bases.length - 1) {
        continue;
      }

      if (expectsRealBackend()) {
        return new Response(
          JSON.stringify({
            error: 'backend_non_json',
            detail:
              'API returned HTML instead of JSON. Your browser may be calling the static site, not FastAPI. ' +
              'Fix: set VITE_API_BASE_URL to the API origin (comma-separated fallbacks supported), ' +
              'deploy the Docker monolith (VITE_USE_SAME_ORIGIN_API=true), or run ' +
              'localStorage.setItem("goodjobs_api_base","https://YOUR-API…"); location.reload().',
          }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (!noMock && (res.status === 404 || res.status === 405 || res.status === 502 || res.status === 503)) {
        if (!ct.includes('application/json')) {
          const m2 = await maybeMockFallback(path, fetchInit, noMock);
          if (m2) return m2;
        }
      }
      return res;
    } catch (err) {
      lastError = err;
      if (expectsRealBackend() && i < bases.length - 1) {
        continue;
      }
      if (noMock) {
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

  if (noMock) {
    return new Response(
      JSON.stringify({ error: 'Backend unreachable.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const mocked = await maybeMockFallback(path, fetchInit, noMock);
  if (mocked) return mocked;
  void lastError;
  return new Response(
    JSON.stringify({ error: 'Backend unreachable.', detail: 'Network error or CORS blocked.' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } },
  );
}
