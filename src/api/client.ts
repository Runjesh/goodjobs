/**
 * - Dev: defaults to local FastAPI.
 * - Prod: set `VITE_API_BASE_URL` at **build** time to your API public URL (e.g. Railway backend).
 *   If unset in prod, uses `window.location.origin` (works when API is served from the same host).
 */
function resolveApiBaseUrl(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (raw) return raw.replace(/\/$/, '');
  if (import.meta.env.DEV) return 'http://localhost:8000';
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

export const API_BASE_URL = resolveApiBaseUrl();

type StoredAuth = { token?: string } | null;

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

export async function apiFetch(path: string, init: RequestInit = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  const headers = new Headers(init.headers);

  if (!headers.has('Authorization')) {
    const token = getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(url, { ...init, headers });
}

