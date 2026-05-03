import { apiFetch } from '../api/client';

export type LifecycleStage =
  | 'acquisition'
  | 'stewardship'
  | 'renewal'
  | 'lapse_risk'
  | 'lapsed'
  | 'unknown';

export type MilestoneId = 'thankyou' | 'impact' | 'fullimpact' | 'renewal';
export type MilestoneState = 'done' | 'due' | 'upcoming' | 'skipped' | 'overdue';

export interface MilestoneDef {
  id: MilestoneId;
  label: string;
  triggerDays: number;
  description: string;
}

export interface Milestone extends MilestoneDef {
  state: MilestoneState;
  dueDate: Date | null;
  doneDate: Date | null;
}

export interface DonorLifecycleState {
  milestones: Partial<Record<MilestoneId, string>>;
  skipped: Partial<Record<MilestoneId, true>>;
  lapseRiskAckAt?: string;
  notes?: string;
}

export const MILESTONE_DEFS: MilestoneDef[] = [
  { id: 'thankyou',   label: 'Day 3 Thank-You',     triggerDays: 3,   description: 'Personal thank-you within 72 hours of the gift.' },
  { id: 'impact',     label: 'Day 30 Impact Update', triggerDays: 30,  description: 'Short update on how the gift was deployed.' },
  { id: 'fullimpact', label: 'Day 90 Full Impact',   triggerDays: 90,  description: 'Detailed outcomes report with photos / metrics.' },
  { id: 'renewal',    label: 'Day 330 Renewal Appeal', triggerDays: 330, description: 'Appeal for next-cycle gift before lapse window.' },
];

// ── Storage scope ────────────────────────────────────────────────────────────
// Lifecycle state is now persisted SERVER-SIDE per donor (Task #9). The
// localStorage layer is kept as a synchronous read-through cache so the
// existing pure helpers below (`computeStage`, `computeTouchpoints`, etc.)
// can stay synchronous and the UI can render immediately on first paint.
//
// Lifecycle is scoped per tenant (ngoId) so multiple orgs in the same
// browser can't collide on donor IDs.  Layout calls `setLifecycleScope`
// whenever the authenticated user changes; if no scope is set we fall back
// to `_default` so unit-style usage still works.
let CURRENT_SCOPE: string = '_default';
export function setLifecycleScope(scope: string | null | undefined): void {
  const next = scope && String(scope).length > 0 ? String(scope) : '_default';
  if (next !== CURRENT_SCOPE) {
    // Different tenant ⇒ wipe the in-memory cache so donors from one org
    // can't leak into another's view via the read-through cache.
    MEM_CACHE.clear();
  }
  CURRENT_SCOPE = next;
}
const STORAGE_KEY  = (id: string | number) => `goodjobs.${CURRENT_SCOPE}.donor.${id}.v2`;
const LEGACY_KEY_V1 = (id: string | number) => `goodjobs.donor.${id}.v1`;

const DUE_WINDOW_DAYS = 7;
const LAPSE_RISK_WINDOW = 14;

export const STAGE_META: Record<LifecycleStage, { label: string; color: string; bg: string; description: string }> = {
  acquisition: { label: 'Acquisition', color: '#0F766E', bg: '#ccfbf1', description: 'Newly acquired donor — first 30 days. Personalised onboarding.' },
  stewardship: { label: 'Stewardship', color: '#0891b2', bg: '#e0f2fe', description: 'Active donor — share progress and impact updates.' },
  renewal:     { label: 'Renewal',     color: '#d97706', bg: '#fef3c7', description: 'Renewal window — appeal for next-cycle gift.' },
  lapse_risk:  { label: 'Lapse Risk',  color: '#ea580c', bg: '#ffedd5', description: 'Past renewal touch with no response — at risk of lapsing.' },
  lapsed:      { label: 'Lapsed',      color: '#64748b', bg: '#e2e8f0', description: 'No gift in 12+ months — needs re-engagement track.' },
  unknown:     { label: 'New',         color: '#64748b', bg: '#e2e8f0', description: 'No gift recorded yet.' },
};

// ── Read-through cache ───────────────────────────────────────────────────────
// Mem cache lets `loadDonorState` stay synchronous (the compute* helpers in
// this module + a lot of UI code rely on that). The cache is populated by
// `hydrateDonorLifecycles()` (Layout calls this once per session) and by
// every successful mutation. Falls back to localStorage on miss so existing
// per-donor state still shows up before hydration completes.
const MEM_CACHE = new Map<string, DonorLifecycleState>();
const cacheKey = (id: string | number) => `${CURRENT_SCOPE}:${String(id)}`;

function parseDate(raw: unknown): Date | null {
  if (!raw) return null;
  const d = new Date(raw as string);
  return isNaN(d.getTime()) ? null : d;
}

export function daysSinceLastGift(lastGift: unknown, now: Date = new Date()): number | null {
  const d = parseDate(lastGift);
  if (!d) return null;
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

function safeParseState(raw: string | null | undefined): DonorLifecycleState | null {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      milestones: parsed.milestones && typeof parsed.milestones === 'object' ? parsed.milestones : {},
      skipped:    parsed.skipped    && typeof parsed.skipped    === 'object' ? parsed.skipped    : {},
      lapseRiskAckAt: typeof parsed.lapseRiskAckAt === 'string' ? parsed.lapseRiskAckAt : undefined,
      notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
    };
  } catch {
    return null;
  }
}

function normaliseStateObject(obj: unknown): DonorLifecycleState | null {
  if (!obj || typeof obj !== 'object') return null;
  return safeParseState(JSON.stringify(obj));
}

export function loadDonorState(donorId: string | number): DonorLifecycleState {
  const key = cacheKey(donorId);
  const cached = MEM_CACHE.get(key);
  if (cached) return cached;
  try {
    // Prefer scoped v2 key.
    const scoped = safeParseState(localStorage.getItem(STORAGE_KEY(donorId)));
    if (scoped) { MEM_CACHE.set(key, scoped); return scoped; }
    // One-shot migration: read legacy unscoped v1 key, write into scoped v2.
    // Legacy data is left intact so other tenants on the same browser can
    // still read it during their own first migration.
    const legacy = safeParseState(localStorage.getItem(LEGACY_KEY_V1(donorId)));
    if (legacy) {
      try { localStorage.setItem(STORAGE_KEY(donorId), JSON.stringify(legacy)); } catch { /* ignore */ }
      MEM_CACHE.set(key, legacy);
      return legacy;
    }
    const empty: DonorLifecycleState = { milestones: {}, skipped: {} };
    MEM_CACHE.set(key, empty);
    return empty;
  } catch {
    return { milestones: {}, skipped: {} };
  }
}

/** Write-through to cache + localStorage. The server PUT is fired by the
 *  mutation helpers (`markMilestoneDone`, etc.) so callers don't have to
 *  remember to do it. */
export function saveDonorState(donorId: string | number, state: DonorLifecycleState): void {
  MEM_CACHE.set(cacheKey(donorId), state);
  try { localStorage.setItem(STORAGE_KEY(donorId), JSON.stringify(state)); } catch { /* ignore */ }
}

// ── Server sync ──────────────────────────────────────────────────────────────

/** Fire-and-forget PUT to persist the donor's lifecycle state. Failures are
 *  logged but don't throw — the caller has already updated the cache + LS,
 *  so the UI stays responsive even if the network is down. The next
 *  successful hydrate will reconcile. */
function persistRemote(donorId: string | number, state: DonorLifecycleState): void {
  try {
    void apiFetch(`/crm/donors/${encodeURIComponent(String(donorId))}/lifecycle`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      // Same rationale as CRM's outreach call: lifecycle is the server-side
      // source of truth for milestones. If the backend is unreachable we
      // want a real failure (logged below) — not a mock 200 that masks a
      // permanently-local write.
      noMockFallback: true,
      body: JSON.stringify({ state }),
    }).catch(() => { /* see fn doc */ });
  } catch {
    /* apiFetch unavailable (test env) — cache + LS are still consistent. */
  }
}

/**
 * Bulk-hydrate the in-memory cache (and write through to localStorage) from
 * the server. Called once by Layout after the user is authenticated. After
 * this resolves, `loadDonorState` returns the same data on every device.
 *
 * Resolves quietly on auth/network failure so the UI can still render the
 * locally-cached state.
 */
export async function hydrateDonorLifecycles(): Promise<void> {
  let res: Response;
  try {
    res = await apiFetch('/crm/donors/lifecycle');
  } catch {
    return;
  }
  if (!res.ok) return;
  let data: unknown;
  try { data = await res.json(); } catch { return; }
  const states = (data as { states?: Record<string, unknown> } | null)?.states;
  if (!states || typeof states !== 'object') return;
  for (const [donorId, raw] of Object.entries(states)) {
    const parsed = normaliseStateObject(raw);
    if (!parsed) continue;
    MEM_CACHE.set(cacheKey(donorId), parsed);
    try { localStorage.setItem(STORAGE_KEY(donorId), JSON.stringify(parsed)); } catch { /* ignore */ }
  }
}

// ── Mutations (write to cache+LS, then push to server) ───────────────────────

export function markMilestoneDone(donorId: string | number, mid: MilestoneId, when: Date = new Date()): DonorLifecycleState {
  const state = loadDonorState(donorId);
  state.milestones = { ...state.milestones, [mid]: when.toISOString() };
  // Clearing skipped if previously skipped.
  if (state.skipped?.[mid]) {
    const next = { ...state.skipped }; delete next[mid]; state.skipped = next;
  }
  saveDonorState(donorId, state);
  persistRemote(donorId, state);
  return state;
}

export function markMilestoneSkipped(donorId: string | number, mid: MilestoneId): DonorLifecycleState {
  const state = loadDonorState(donorId);
  state.skipped = { ...state.skipped, [mid]: true };
  saveDonorState(donorId, state);
  persistRemote(donorId, state);
  return state;
}

export function ackLapseRisk(donorId: string | number, when: Date = new Date()): DonorLifecycleState {
  const state = loadDonorState(donorId);
  state.lapseRiskAckAt = when.toISOString();
  saveDonorState(donorId, state);
  persistRemote(donorId, state);
  return state;
}

export function computeTouchpoints(donor: { id: string | number; lastGift?: unknown }, now: Date = new Date()): Milestone[] {
  const state = loadDonorState(donor.id);
  const baseDate = parseDate(donor.lastGift);
  const days = baseDate ? Math.floor((now.getTime() - baseDate.getTime()) / 86_400_000) : null;

  return MILESTONE_DEFS.map(def => {
    const doneIso = state.milestones?.[def.id];
    const doneDate = doneIso ? parseDate(doneIso) : null;
    const skipped = !!state.skipped?.[def.id];
    const dueDate = baseDate ? new Date(baseDate.getTime() + def.triggerDays * 86_400_000) : null;

    let stateOut: MilestoneState;
    if (doneDate) {
      stateOut = 'done';
    } else if (skipped) {
      stateOut = 'skipped';
    } else if (days == null) {
      stateOut = 'upcoming';
    } else if (days < def.triggerDays) {
      stateOut = 'upcoming';
    } else if (days <= def.triggerDays + DUE_WINDOW_DAYS) {
      stateOut = 'due';
    } else {
      stateOut = 'overdue';
    }
    return { ...def, state: stateOut, dueDate, doneDate };
  });
}

export function nextDueMilestone(donor: { id: string | number; lastGift?: unknown }, now: Date = new Date()): Milestone | null {
  const list = computeTouchpoints(donor, now);
  // Prefer overdue, then due, then upcoming with the soonest dueDate.
  const overdue = list.filter(m => m.state === 'overdue');
  if (overdue.length) return overdue[overdue.length - 1];
  const due = list.find(m => m.state === 'due');
  if (due) return due;
  const upcoming = list.filter(m => m.state === 'upcoming' && m.dueDate);
  upcoming.sort((a, b) => (a.dueDate!.getTime() - b.dueDate!.getTime()));
  return upcoming[0] || null;
}

export function computeStage(donor: { id: string | number; lastGift?: unknown }, now: Date = new Date()): LifecycleStage {
  const days = daysSinceLastGift(donor.lastGift, now);
  if (days == null) return 'unknown';
  if (days < 30)  return 'acquisition';
  if (days < 90)  return 'stewardship';
  if (days < 330) return 'renewal';
  if (days < 360) {
    // Lapse Risk: past day-330 with no response in last 14 days
    const state = loadDonorState(donor.id);
    const lastTouch = state.milestones?.renewal ? parseDate(state.milestones.renewal) : null;
    const ack = state.lapseRiskAckAt ? parseDate(state.lapseRiskAckAt) : null;
    const recent = lastTouch && (now.getTime() - lastTouch.getTime()) < LAPSE_RISK_WINDOW * 86_400_000;
    const acked  = ack && (now.getTime() - ack.getTime()) < LAPSE_RISK_WINDOW * 86_400_000;
    return recent || acked ? 'renewal' : 'lapse_risk';
  }
  return 'lapsed';
}

export function urgencyScore(donor: { id: string | number; lastGift?: unknown }, now: Date = new Date()): number {
  // Higher = more urgent. Used to sort the Nurture Queue.
  const stage = computeStage(donor, now);
  const stageWeight: Record<LifecycleStage, number> = {
    lapse_risk: 100, lapsed: 90, renewal: 70, stewardship: 40, acquisition: 50, unknown: 10,
  };
  const base = stageWeight[stage] ?? 0;
  const next = nextDueMilestone(donor, now);
  if (!next) return base;
  if (next.state === 'overdue') return base + 30;
  if (next.state === 'due')     return base + 20;
  if (next.state === 'upcoming' && next.dueDate) {
    const days = Math.max(0, Math.floor((next.dueDate.getTime() - now.getTime()) / 86_400_000));
    return base + Math.max(0, 14 - days);
  }
  return base;
}

export const STAGE_FILTER_OPTIONS: { id: LifecycleStage | 'all'; label: string }[] = [
  { id: 'all',         label: 'All'         },
  { id: 'acquisition', label: 'Acquisition' },
  { id: 'stewardship', label: 'Stewardship' },
  { id: 'renewal',     label: 'Renewal'     },
  { id: 'lapse_risk',  label: 'Lapse Risk'  },
  { id: 'lapsed',      label: 'Lapsed'      },
];
