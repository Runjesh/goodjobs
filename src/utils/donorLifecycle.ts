import type { Donor } from '../store/useStore';

/** Total giving above this (INR) — shown as “Major” in CRM giving-stage hints. */
export const DONOR_MAJOR_THRESHOLD_INR = 500_000;

const MS_PER_DAY = 86_400_000;
const EV_HYDRATED = 'goodjobs:lifecycle-hydrated';
const LS_LAPSE_ACK = 'gj.donor_lapse_risk_ack.v1';
const LS_MILESTONES = 'gj.donor_milestones.v1';

export type MilestoneId = 'thankyou' | 'impact' | 'fullimpact' | 'renewal';

export type MilestoneState = 'done' | 'due' | 'overdue' | 'upcoming' | 'skipped';

export interface Milestone {
  id: MilestoneId;
  label: string;
  description: string;
  state: MilestoneState;
  dueDate: Date | null;
  doneDate: Date | null;
}

export type LifecycleStage =
  | 'acquisition'
  | 'stewardship'
  | 'renewal'
  | 'lapse_risk'
  | 'lapsed'
  | 'unknown';

function emitHydrated() {
  try {
    window.dispatchEvent(new CustomEvent(EV_HYDRATED));
  } catch {
    /* ignore */
  }
}

function readAckSet(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_LAPSE_ACK);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeAckSet(ids: Set<string>) {
  try {
    localStorage.setItem(LS_LAPSE_ACK, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

type MilestoneStore = Record<string, Partial<Record<MilestoneId, { doneAt?: string; skipped?: boolean }>>>;

function readMilestones(): MilestoneStore {
  try {
    const raw = localStorage.getItem(LS_MILESTONES);
    const o = raw ? (JSON.parse(raw) as MilestoneStore) : {};
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

function writeMilestones(store: MilestoneStore) {
  try {
    localStorage.setItem(LS_MILESTONES, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

/** Parse donor.lastGift — ISO, "N/A", or relative demo strings. */
export function daysSinceLastGift(lastGift: string, now = new Date()): number {
  const s = (lastGift || '').trim();
  if (!s || s === 'N/A') return 9999;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const t = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Math.max(0, Math.floor((now.getTime() - t) / MS_PER_DAY));
  }
  const lower = s.toLowerCase();
  if (lower.includes('min') || lower.includes('hour') || lower.includes('ago')) return 0;
  if (lower.includes('day') && /\d/.test(s)) {
    const n = parseInt(s.replace(/\D/g, ''), 10);
    if (!Number.isNaN(n)) return Math.min(n, 9999);
  }
  return 365;
}

function anchorDate(donor: Donor, now: Date): Date {
  const s = (donor.lastGift || '').trim();
  if (s && s !== 'N/A') {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (iso) {
      return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    }
  }
  return new Date(now.getTime() - daysSinceLastGift(donor.lastGift, now) * MS_PER_DAY);
}

function offsetDays(anchor: Date, days: number): Date {
  return new Date(anchor.getTime() + days * MS_PER_DAY);
}

export function computeTouchpoints(donor: Donor, now = new Date()): Milestone[] {
  const id = String(donor.id);
  const store = readMilestones()[id] || {};
  const anchor = anchorDate(donor, now);

  const defs: { id: MilestoneId; label: string; description: string; day: number }[] = [
    { id: 'thankyou', label: 'Thank-you', description: 'Within a week of the gift', day: 7 },
    { id: 'impact', label: 'Impact update', description: 'Day-30 stewardship', day: 30 },
    { id: 'fullimpact', label: 'Full impact story', description: 'Day-90 deep engagement', day: 90 },
    { id: 'renewal', label: 'Renewal conversation', description: 'Day-180 renewal window', day: 180 },
  ];

  return defs.map(def => {
    const due = offsetDays(anchor, def.day);
    const rec = store[def.id];
    const base = { id: def.id, label: def.label, description: def.description, dueDate: due, doneDate: null as Date | null };
    if (rec?.skipped) {
      return { ...base, state: 'skipped' as const };
    }
    if (rec?.doneAt) {
      const doneDate = new Date(rec.doneAt);
      return { ...base, state: 'done' as const, doneDate };
    }
    if (now.getTime() > due.getTime() + MS_PER_DAY) {
      return { ...base, state: 'overdue' as const };
    }
    if (now.getTime() >= due.getTime() - 0.5 * MS_PER_DAY) {
      return { ...base, state: 'due' as const };
    }
    return { ...base, state: 'upcoming' as const };
  });
}

export function nextDueMilestone(donor: Donor, now = new Date()): { state: 'due' | 'overdue' } | null {
  for (const m of computeTouchpoints(donor, now)) {
    if (m.state === 'due' || m.state === 'overdue') {
      return { state: m.state };
    }
  }
  return null;
}

export function markMilestoneDone(donorId: string | number, milestoneId: MilestoneId) {
  const id = String(donorId);
  const all = readMilestones();
  const row = { ...(all[id] || {}) };
  row[milestoneId] = { doneAt: new Date().toISOString() };
  all[id] = row;
  writeMilestones(all);
  emitHydrated();
}

export function markMilestoneSkipped(donorId: string | number, milestoneId: MilestoneId) {
  const id = String(donorId);
  const all = readMilestones();
  const row = { ...(all[id] || {}) };
  row[milestoneId] = { skipped: true };
  all[id] = row;
  writeMilestones(all);
  emitHydrated();
}

/** Sort key for nurture queue — higher = more urgent. */
export function urgencyScore(donor: Donor, now = new Date()): number {
  const days = daysSinceLastGift(donor.lastGift, now);
  let s = Math.min(1000, days * 3);
  const m = nextDueMilestone(donor, now);
  if (m?.state === 'overdue') s += 200;
  else if (m?.state === 'due') s += 80;
  s += Math.min(200, (Number(donor.totalGiven) || 0) / 50000);
  return s;
}

/**
 * Pipeline stage for CRM filters / badges — derived from recency + touchpoints,
 * not from the static `donor.type` CRM label.
 */
export function computeStage(donor: Donor, now = new Date()): LifecycleStage {
  const days = daysSinceLastGift(donor.lastGift, now);
  if (days > 365) return 'lapsed';
  if (days > 180) return 'lapse_risk';
  const tp = computeTouchpoints(donor, now);
  if (tp.some(m => m.id === 'renewal' && (m.state === 'due' || m.state === 'overdue'))) return 'renewal';
  if (days > 120) return 'renewal';
  if (days > 45) return 'stewardship';
  if (days <= 45) return 'acquisition';
  return 'unknown';
}

export function subscribeLifecycleHydrated(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const fn = () => cb();
  window.addEventListener(EV_HYDRATED, fn);
  return () => window.removeEventListener(EV_HYDRATED, fn);
}

export function ackLapseRisk(donorId: string | number): void {
  const s = readAckSet();
  s.add(String(donorId));
  writeAckSet(s);
  emitHydrated();
}

/** CRM “giving stage” ribbon — New / Active / Lapsing / Lapsed / Major. */
export type DonorLifecycleStage = 'New' | 'Active' | 'Lapsing' | 'Lapsed' | 'Major';

export function computeDonorLifecycleStage(donor: Donor, now = new Date()): DonorLifecycleStage {
  const total = Number(donor.totalGiven) || 0;
  if (total >= DONOR_MAJOR_THRESHOLD_INR) return 'Major';
  const days = daysSinceLastGift(donor.lastGift, now);
  if (days <= 90) return 'New';
  if (days <= 180) return 'Active';
  if (days <= 365) return 'Lapsing';
  return 'Lapsed';
}

export function donorNeedsContactAttention(donor: Donor, daysThreshold = 60, now = new Date()): boolean {
  const meta = (donor.meta || {}) as Record<string, unknown>;
  const lastTouch = meta.last_touchpoint_at;
  if (typeof lastTouch === 'string' && /^\d{4}-\d{2}-\d{2}/.test(lastTouch)) {
    const t = Date.parse(lastTouch.slice(0, 10));
    if (!Number.isNaN(t)) {
      const days = Math.floor((now.getTime() - t) / MS_PER_DAY);
      return days >= daysThreshold;
    }
  }
  return daysSinceLastGift(donor.lastGift, now) >= daysThreshold;
}

export const STAGE_META: Record<LifecycleStage | 'unknown', { label: string; description: string; color: string; bg: string }> = {
  acquisition: {
    label: 'Acquisition',
    description: 'New or very recent giver — establish rhythm',
    color: '#059669',
    bg: '#ecfdf5',
  },
  stewardship: {
    label: 'Stewardship',
    description: 'Active relationship — impact updates',
    color: '#0891b2',
    bg: '#ecfeff',
  },
  renewal: {
    label: 'Renewal',
    description: 'Renewal window — schedule ask',
    color: '#d97706',
    bg: '#fffbeb',
  },
  lapse_risk: {
    label: 'Lapse risk',
    description: 'No gift in 6–12 months — intervene',
    color: '#ea580c',
    bg: '#fff7ed',
  },
  lapsed: {
    label: 'Lapsed',
    description: '12+ months since last gift',
    color: '#b91c1c',
    bg: '#fef2f2',
  },
  unknown: {
    label: 'Unknown',
    description: 'Insufficient timeline data',
    color: '#64748b',
    bg: '#f1f5f9',
  },
};

export const STAGE_FILTER_OPTIONS: { id: LifecycleStage | 'all'; label: string }[] = [
  { id: 'all', label: 'All stages' },
  { id: 'acquisition', label: 'Acquisition' },
  { id: 'stewardship', label: 'Stewardship' },
  { id: 'renewal', label: 'Renewal' },
  { id: 'lapse_risk', label: 'Lapse risk' },
  { id: 'lapsed', label: 'Lapsed' },
];
