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

function trimOrigin(url: string): string {
  return url.replace(/\/$/, '');
}

function buildTimeBase(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (raw) return trimOrigin(raw);
  if (import.meta.env.DEV) return 'http://localhost:8000';
  if (import.meta.env.VITE_USE_SAME_ORIGIN_API === 'true' && typeof window !== 'undefined') {
    return trimOrigin(window.location.origin);
  }
  if (import.meta.env.PROD && typeof window !== 'undefined') {
    console.warn(
      '[GoodJobs] Production build without VITE_API_BASE_URL. Using this page origin for API calls. ' +
        'If POST /auth/login returns 405, this host only serves static files — set VITE_API_BASE_URL to your FastAPI Railway URL and rebuild. ' +
        'Or temporarily: localStorage.setItem("goodjobs_api_base","https://YOUR-API.up.railway.app"); location.reload()',
    );
    return trimOrigin(window.location.origin);
  }
  return typeof window !== 'undefined' ? trimOrigin(window.location.origin) : '';
}

/**
 * Effective API origin: optional runtime override, then build-time / defaults.
 */
export function getApiBaseUrl(): string {
  try {
    const fromLs = localStorage.getItem('goodjobs_api_base')?.trim();
    if (fromLs) return trimOrigin(fromLs);
  } catch {
    /* private mode */
  }
  return buildTimeBase();
}

/** @deprecated Use getApiBaseUrl() — does not include localStorage override */
export const API_BASE_URL = buildTimeBase();

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

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = getApiBaseUrl();
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = new Headers(init.headers);

  if (!headers.has('Authorization')) {
    const token = getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(url, { ...init, headers });
}
