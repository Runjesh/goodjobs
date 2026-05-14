export type LlmKeyStatus = {
  configured: boolean;
  masked: string | null;
  source: string;
  env_fallback_available: boolean;
};

export function getApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (raw) return raw.replace(/\/$/, '');
  return 'http://localhost:8000';
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const direct = localStorage.getItem('access_token');
    if (direct) return direct;
    const raw = localStorage.getItem('sevasuite_auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string };
    return parsed?.token ?? null;
  } catch {
    return null;
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = getApiBaseUrl();
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  const token = getAccessToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, { ...init, headers });
}
