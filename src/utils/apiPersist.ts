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
    const data = await res.json() as { detail?: string; error?: string; message?: string };
    if (typeof data.detail === 'string') return data.detail;
    if (typeof data.message === 'string') return data.message;
    if (typeof data.error === 'string') return data.error;
  } catch { /* ignore */ }
  return res.statusText || `Request failed (${res.status})`;
}
