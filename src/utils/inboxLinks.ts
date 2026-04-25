/** Deep link to unified inbox row: `/tasks?focus=kind:refId` */
export function tasksInboxHref(kind?: string, refId?: string | number | null): string {
  if (kind && refId != null && String(refId) !== '') {
    return `/tasks?focus=${encodeURIComponent(`${kind}:${refId}`)}`;
  }
  return '/tasks';
}

/** Notification `id` is `kind:refId` from the API. */
export function parseInboxFocusFromNotificationId(id: string): { kind: string; refId: string } | null {
  const i = id.indexOf(':');
  if (i <= 0) return null;
  const kind = id.slice(0, i);
  const refId = id.slice(i + 1);
  if (!kind || !refId) return null;
  return { kind, refId };
}

export function tasksPathFromNotificationId(id: string): string {
  const p = parseInboxFocusFromNotificationId(id);
  if (!p) return '/tasks';
  return tasksInboxHref(p.kind, p.refId);
}

export function notificationTasksHref(n: { tasks_path?: string | null; id?: string }): string {
  const tp = (n.tasks_path || '').trim();
  if (tp) return tp.startsWith('/') ? tp : `/${tp}`;
  return tasksPathFromNotificationId(String(n.id || ''));
}
