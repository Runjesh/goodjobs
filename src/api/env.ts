/** Build-time API wiring (shared by client + mockBackend; no fetch here). */

export function trimApiOrigin(url: string): string {
  return url.replace(/\/$/, '');
}

export function isSameOriginApiMode(): boolean {
  try {
    return String(import.meta.env.VITE_USE_SAME_ORIGIN_API ?? '').toLowerCase() === 'true';
  } catch {
    return false;
  }
}

export function hasExplicitApiBaseUrl(): boolean {
  try {
    return !!String(import.meta.env.VITE_API_BASE_URL ?? '').trim();
  } catch {
    return false;
  }
}

/** True when this build expects a real FastAPI backend (Railway monolith or split deploy). */
export function expectsRealBackend(): boolean {
  return isSameOriginApiMode() || hasExplicitApiBaseUrl();
}
