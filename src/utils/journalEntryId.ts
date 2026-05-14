/**
 * Resolves the canonical id for a freshly-posted journal entry.
 *
 * Task #25 originally fell back to a synthetic `JE-${Date.now()}` whenever
 * the backend response didn't contain an id, which leaked fake ids into
 * localStorage that *looked* like real persisted ids. Task #32 fixes that:
 * the backend now returns the persisted id, and locally-fabricated ids are
 * clearly prefixed with `local-` so the rest of the app can tell them apart
 * (e.g. when re-syncing or filtering "not yet on the server" entries).
 *
 * Returns `{ source: 'backend', id }` when the response carries a real id
 * (under any of the common field-name conventions: `id`, `entry_id`,
 * `journal_entry_id`, or nested `entry.id` / `data.id`). Otherwise returns
 * `{ source: 'local', id }` with a deterministic-but-clearly-local id.
 */
export type JournalEntryIdSource = 'backend' | 'local';

export interface ResolvedJournalEntryId {
  source: JournalEntryIdSource;
  id: string;
}

interface ResolveOpts {
  /** Override for tests so the local id is deterministic. */
  now?: () => number;
  rand?: () => number;
}

export function resolvePersistedJournalEntryId(
  payload: unknown,
  opts: ResolveOpts = {},
): ResolvedJournalEntryId {
  const backend = extractBackendId(payload);
  if (backend) return { source: 'backend', id: backend };

  const now = opts.now ?? Date.now;
  const rand = opts.rand ?? Math.random;
  const ts = now();
  // 4-char base36 suffix avoids collisions when two entries are created in
  // the same millisecond (e.g. quick repeat clicks under fake timers).
  const suffix = Math.floor(rand() * 0x10000).toString(36).padStart(4, '0');
  return { source: 'local', id: `local-JE-${ts}-${suffix}` };
}

function extractBackendId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  // Try the common conventions in priority order.
  for (const key of ['id', 'entry_id', 'journal_entry_id']) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  // One level of nesting for `{ entry: { id } }` or `{ data: { id } }`.
  for (const key of ['entry', 'data', 'journal_entry']) {
    const nested = obj[key];
    if (nested && typeof nested === 'object') {
      const inner = extractBackendId(nested);
      if (inner) return inner;
    }
  }
  return null;
}

/** Convenience: true for ids the frontend fabricated when the backend
 *  didn't (yet) assign one. UI can use this to show a "local-only" badge
 *  or to filter out drafts during a sync flow. */
export function isLocalJournalEntryId(id: string): boolean {
  return id.startsWith('local-JE-');
}
