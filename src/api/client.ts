export const API_BASE_URL =
  (import.meta as any).env?.VITE_API_BASE_URL ?? 'http://localhost:8000';

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

