import type { ApiFetchInit } from '../api/client';
import { expectsRealBackend } from '../api/client';

/** POST/PUT/PATCH/DELETE: never silently mock when this build targets a real API. */
export function apiMutationInit(init: ApiFetchInit = {}): ApiFetchInit {
  return expectsRealBackend() ? { ...init, noMockFallback: true } : init;
}

/** Local Zustand / localStorage fallback is only for offline demo or static-only hosts. */
export function allowLocalPersistFallback(): boolean {
  if (expectsRealBackend()) {
    return typeof navigator !== 'undefined' && !navigator.onLine;
  }
  return true;
}

export async function readApiError(res: Response): Promise<string> {
  try {
    const data = await res.json() as {
      detail?: string | Array<{ msg?: string; loc?: unknown[] }>;
      error?: string;
      message?: string;
    };
    if (typeof data.detail === 'string') return data.detail;
    if (Array.isArray(data.detail) && data.detail.length > 0) {
      const first = data.detail[0];
      if (first && typeof first.msg === 'string') return first.msg;
    }
    if (typeof data.message === 'string') return data.message;
    if (typeof data.error === 'string') return data.error;
  } catch { /* ignore */ }
  return res.statusText || `Request failed (${res.status})`;
}

/** Client-only demo tokens are rejected by the real API (401). */
export function isDemoAuthToken(token: string | null | undefined): boolean {
  if (!token) return true;
  return token.startsWith('demo-jwt-');
}
