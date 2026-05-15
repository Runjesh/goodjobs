/** Cross-module refresh signal — listeners refetch Today, Tasks, notifications, etc. */
export const APP_REFRESH_EVENT = 'goodjobs:refresh';

export function emitAppRefresh(): void {
  try {
    window.dispatchEvent(new Event(APP_REFRESH_EVENT));
  } catch {
    /* ignore */
  }
}

/** Subscribe to {@link APP_REFRESH_EVENT}; returns an unsubscribe function. */
export function onAppRefresh(handler: () => void): () => void {
  window.addEventListener(APP_REFRESH_EVENT, handler);
  return () => window.removeEventListener(APP_REFRESH_EVENT, handler);
}
