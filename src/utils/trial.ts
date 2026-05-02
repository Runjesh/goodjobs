// Trial state, day-of-trial math, nudge cadence, tier limits, and per-org
// billing storage. AuthUser carries `trial` so it lives wherever the user does.

// ── Subscription tiers ────────────────────────────────────────────────────────
// Canonical tier names used by the product spec are: starter / growth / scale.
// The legacy `pro` and `enterprise` strings are retained in the union so older
// AuthUser blobs in localStorage still type-check; `normalizeTier()` maps them
// to growth / scale wherever the value is consumed.
export type SubscriptionTier =
  | 'trial'
  | 'starter'
  | 'growth'
  | 'scale'
  // Legacy aliases (mapped via normalizeTier when read)
  | 'pro'
  | 'enterprise';

/** Coerce a stored or legacy tier value to its canonical name. */
export function normalizeTier(t: SubscriptionTier | undefined | null): SubscriptionTier {
  if (!t) return 'trial';
  if (t === 'pro') return 'growth';
  if (t === 'enterprise') return 'scale';
  return t;
}

export interface TrialNudgeState {
  /** Epoch-ms when day-7 info card was first surfaced/dismissed (0 = not shown). */
  day7?: number;
  /** Epoch-ms when day-21 warning toast fired. */
  day21?: number;
  /** Epoch-ms when day-28 upgrade modal fired (or dismissed). */
  day28?: number;
}

export interface TrialState {
  /** ISO string. */
  startedAt: string;
  /** ISO string — startedAt + TRIAL_DAYS. */
  endsAt: string;
  /** Current subscription tier. While in trial, stays 'trial' until expiry → 'starter'. */
  tier: SubscriptionTier;
  /** Tracks which nudges have already fired so they don't repeat. */
  nudges: TrialNudgeState;
}

// ── Billing state (paid subscriptions) ────────────────────────────────────────
export type BillingStatus = 'active' | 'past_due' | 'canceled';
export type BillingCycle = 'monthly' | 'annual';

export interface BillingState {
  status: BillingStatus;
  /** ISO string — end of current paid period (renewal or downgrade boundary). */
  currentPeriodEnd: string;
  /** ISO string — when the most recent payment failed (sets the downgrade clock). */
  pastDueSince?: string;
  /** Selected billing cadence at checkout. */
  billingCycle: BillingCycle;
  /** Razorpay payment id from the most recent successful checkout (sandbox or real). */
  razorpayPaymentId?: string;
  /** Last invoice amount in paise (for receipts/banner copy). */
  lastAmountPaise?: number;
}

export const TRIAL_DAYS = 30;
export const NUDGE_DAY_7 = 7;
export const NUDGE_DAY_21 = 21;
export const NUDGE_DAY_28 = 28;
/** Days a payment can be past_due before we hard-downgrade to Starter. */
export const PAST_DUE_GRACE_DAYS = 7;

const MS_PER_DAY = 86_400_000;

function isoAt(now: Date, addDays = 0): string {
  const d = new Date(now);
  d.setDate(d.getDate() + addDays);
  return d.toISOString();
}

export function makeFreshTrial(now: Date = new Date()): TrialState {
  return {
    startedAt: isoAt(now, 0),
    endsAt: isoAt(now, TRIAL_DAYS),
    tier: 'trial',
    nudges: {},
  };
}

/** How many full days have elapsed since trial start (clamped >= 0). */
export function daysSinceStart(state: TrialState | undefined | null, now: Date = new Date()): number {
  if (!state?.startedAt) return 0;
  const start = new Date(state.startedAt).getTime();
  const diff = now.getTime() - start;
  return Math.max(0, Math.floor(diff / MS_PER_DAY));
}

/**
 * Days remaining in trial, rounded UP so a partial day still reads as "1 day left".
 * Returns 0 once expired.
 */
export function daysLeftInTrial(state: TrialState | undefined | null, now: Date = new Date()): number {
  if (!state?.endsAt) return 0;
  const end = new Date(state.endsAt).getTime();
  const diff = end - now.getTime();
  if (diff <= 0) return 0;
  return Math.max(1, Math.ceil(diff / MS_PER_DAY));
}

export function isTrialExpired(state: TrialState | undefined | null, now: Date = new Date()): boolean {
  if (!state?.endsAt) return false;
  return new Date(state.endsAt).getTime() <= now.getTime();
}

/** What tier the user *effectively* has right now (auto-downgrade trial→starter on expiry). */
export function effectiveTier(state: TrialState | undefined | null, now: Date = new Date()): SubscriptionTier {
  if (!state) return 'starter';
  if (state.tier !== 'trial') return normalizeTier(state.tier);
  return isTrialExpired(state, now) ? 'starter' : 'trial';
}

/** Has nudge already fired (for any of the day-N markers)? */
export function nudgeFired(state: TrialState | undefined | null, key: keyof TrialNudgeState): boolean {
  return !!state?.nudges?.[key];
}

export function withNudgeFired(state: TrialState, key: keyof TrialNudgeState, now: Date = new Date()): TrialState {
  return { ...state, nudges: { ...state.nudges, [key]: now.getTime() } };
}

// ── Past-due / billing helpers ────────────────────────────────────────────────

export function isPastDue(b: BillingState | undefined | null): boolean {
  return !!b && b.status === 'past_due';
}

/** Days until past-due grace expires and we hard-downgrade. Negative when overdue. */
export function daysUntilDowngrade(b: BillingState | undefined | null, now: Date = new Date()): number {
  if (!b || b.status !== 'past_due' || !b.pastDueSince) return PAST_DUE_GRACE_DAYS;
  const since = new Date(b.pastDueSince).getTime();
  const elapsed = (now.getTime() - since) / MS_PER_DAY;
  return Math.ceil(PAST_DUE_GRACE_DAYS - elapsed);
}

/** Effective tier given trial + chosen subscription + billing status (handles past-due). */
export function effectiveTierWithBilling(
  trial: TrialState | undefined | null,
  subscriptionTier: SubscriptionTier | undefined | null,
  billing: BillingState | undefined | null,
  now: Date = new Date(),
): SubscriptionTier {
  // If billing is past-due past grace, force Starter.
  if (billing && billing.status === 'past_due' && daysUntilDowngrade(billing, now) <= 0) {
    return 'starter';
  }
  if (subscriptionTier && subscriptionTier !== 'trial') return normalizeTier(subscriptionTier);
  return effectiveTier(trial ?? null, now);
}

// ── Tier plans (single source of truth for Settings → Plans + comparison modal)

export interface TierPlan {
  id: 'starter' | 'growth' | 'scale';
  name: string;
  /** Monthly price in INR (number — formatting handled at render). 0 = free. */
  priceMonthly: number;
  /** Annual price in INR (the per-year total at the discounted rate). */
  priceAnnual: number;
  blurb: string;
  /** Bullet copy shown on plan cards. */
  features: string[];
  /** Per-feature comparison rows for the side-by-side modal. */
  compare: {
    beneficiaries: string;
    teamMembers: string;
    reportsPerMonth: string;
    aiCopilot: string;
    whatsapp: string;
    csrPipeline: string;
    grantDrafts: string;
    support: string;
  };
  highlighted?: boolean;
}

// ── Concrete tier limits (enforced in product) ────────────────────────────────
export const STARTER_BENEFICIARY_CAP = 50;
export const STARTER_PROGRAM_CAP = 1;
export const STARTER_TEAM_CAP = 3;
export const STARTER_REPORTS_PER_MONTH = 2;

export const GROWTH_BENEFICIARY_CAP: number | null = null; // unlimited
export const GROWTH_TEAM_CAP = 10;
export const GROWTH_REPORTS_PER_MONTH = 20;

export interface TierLimits {
  /** null = unlimited. */
  beneficiaries: number | null;
  programs: number | null;
  teamMembers: number | null;
  /** AI-drafted reports allowed in a rolling 30-day window. null = unlimited. */
  reportsPerMonth: number | null;
  aiAgents: boolean;
  whatsappEnabled: boolean;
}

/** Concrete feature limits per tier — single source of truth for gating. */
export function tierLimits(tier: SubscriptionTier): TierLimits {
  const t = normalizeTier(tier);
  switch (t) {
    case 'starter':
      return {
        beneficiaries: STARTER_BENEFICIARY_CAP,
        programs: STARTER_PROGRAM_CAP,
        teamMembers: STARTER_TEAM_CAP,
        reportsPerMonth: STARTER_REPORTS_PER_MONTH,
        aiAgents: false,
        whatsappEnabled: false,
      };
    case 'growth':
      return {
        beneficiaries: GROWTH_BENEFICIARY_CAP,
        programs: null,
        teamMembers: GROWTH_TEAM_CAP,
        reportsPerMonth: GROWTH_REPORTS_PER_MONTH,
        aiAgents: true,
        whatsappEnabled: true,
      };
    case 'scale':
      return {
        beneficiaries: null,
        programs: null,
        teamMembers: null,
        reportsPerMonth: null,
        aiAgents: true,
        whatsappEnabled: true,
      };
    case 'trial':
    default:
      // Full access during trial.
      return {
        beneficiaries: null,
        programs: null,
        teamMembers: null,
        reportsPerMonth: null,
        aiAgents: true,
        whatsappEnabled: true,
      };
  }
}

/** True when the tier permits adding one more beneficiary given the current count. */
export function canAddBeneficiary(tier: SubscriptionTier, currentCount: number): boolean {
  const cap = tierLimits(tier).beneficiaries;
  return cap === null || currentCount < cap;
}

/** True when the tier permits adding one more team member given the current count. */
export function canAddTeamMember(tier: SubscriptionTier, currentCount: number): boolean {
  const cap = tierLimits(tier).teamMembers;
  return cap === null || currentCount < cap;
}

// ── Per-org billing storage (so trial state survives logout/login) ──────────
// Trial belongs to the *org*, not the individual user — multiple roles within
// one NGO share one trial timer. Keyed by ngoId.

const ORG_BILLING_KEY = 'gj_org_billing_v1';

export interface OrgBilling {
  trial?: TrialState;
  subscriptionTier?: SubscriptionTier;
  billing?: BillingState;
}

type OrgBillingMap = Record<string, OrgBilling>;

function readOrgBillingMap(): OrgBillingMap {
  try {
    const raw = localStorage.getItem(ORG_BILLING_KEY);
    return raw ? (JSON.parse(raw) as OrgBillingMap) : {};
  } catch {
    return {};
  }
}

function writeOrgBillingMap(map: OrgBillingMap): void {
  try {
    localStorage.setItem(ORG_BILLING_KEY, JSON.stringify(map));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}

export function loadOrgBilling(ngoId: string): OrgBilling | undefined {
  if (!ngoId) return undefined;
  return readOrgBillingMap()[ngoId];
}

export function saveOrgBilling(ngoId: string, billing: OrgBilling): void {
  if (!ngoId) return;
  const map = readOrgBillingMap();
  map[ngoId] = { ...map[ngoId], ...billing };
  writeOrgBillingMap(map);
}

// ── Monthly report counter (rolling 30 days) ──────────────────────────────────
// Used for the Reports tier cap. Stored per-org so all roles share the count.
const REPORTS_USAGE_KEY = 'gj_reports_usage_v1';

interface ReportsUsageMap {
  /** ngoId → array of epoch-ms timestamps of AI report drafts. */
  [ngoId: string]: number[];
}

function readReportsUsage(): ReportsUsageMap {
  try {
    const raw = localStorage.getItem(REPORTS_USAGE_KEY);
    return raw ? (JSON.parse(raw) as ReportsUsageMap) : {};
  } catch {
    return {};
  }
}

function writeReportsUsage(m: ReportsUsageMap): void {
  try {
    localStorage.setItem(REPORTS_USAGE_KEY, JSON.stringify(m));
  } catch {
    /* non-fatal */
  }
}

/** Number of AI report drafts in the last 30 days for this org. */
export function monthlyReportCount(ngoId: string, now: Date = new Date()): number {
  if (!ngoId) return 0;
  const map = readReportsUsage();
  const arr = map[ngoId] ?? [];
  const cutoff = now.getTime() - 30 * MS_PER_DAY;
  return arr.filter(ts => ts >= cutoff).length;
}

/** Record a fresh AI report draft (called from Reports.handleDraftReport). */
export function recordReportDraft(ngoId: string, now: Date = new Date()): void {
  if (!ngoId) return;
  const map = readReportsUsage();
  const arr = (map[ngoId] ?? []).filter(ts => ts >= now.getTime() - 30 * MS_PER_DAY);
  arr.push(now.getTime());
  map[ngoId] = arr;
  writeReportsUsage(map);
}

// ── Plan catalog ──────────────────────────────────────────────────────────────
// Annual prices reflect a 2-month discount (≈ monthly × 10). Format in UI.
export const TIER_PLANS: TierPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    priceMonthly: 0,
    priceAnnual: 0,
    blurb: 'Free forever — for very small NGOs',
    features: [
      `Up to ${STARTER_BENEFICIARY_CAP} beneficiaries`,
      `${STARTER_PROGRAM_CAP} program · 1 active campaign`,
      `${STARTER_TEAM_CAP} team members`,
      `${STARTER_REPORTS_PER_MONTH} AI report drafts / month`,
      'Manual receipts (no AI drafting)',
      'Email support',
    ],
    compare: {
      beneficiaries: `${STARTER_BENEFICIARY_CAP}`,
      teamMembers: `${STARTER_TEAM_CAP}`,
      reportsPerMonth: `${STARTER_REPORTS_PER_MONTH}/mo`,
      aiCopilot: '—',
      whatsapp: '—',
      csrPipeline: '—',
      grantDrafts: 'Manual only',
      support: 'Email',
    },
  },
  {
    id: 'growth',
    name: 'Growth',
    priceMonthly: 2499,
    priceAnnual: 24990,
    blurb: 'Most NGOs choose this',
    highlighted: true,
    features: [
      'Unlimited beneficiaries · unlimited programs',
      `Up to ${GROWTH_TEAM_CAP} team members`,
      `${GROWTH_REPORTS_PER_MONTH} AI report drafts / month`,
      'AI Copilot for reports & receipts',
      'WhatsApp field data entry',
      'CSR pipeline + grant report drafting',
      'Priority support · onboarding call',
    ],
    compare: {
      beneficiaries: 'Unlimited',
      teamMembers: `${GROWTH_TEAM_CAP}`,
      reportsPerMonth: `${GROWTH_REPORTS_PER_MONTH}/mo`,
      aiCopilot: 'Included',
      whatsapp: 'Included',
      csrPipeline: 'Included',
      grantDrafts: 'AI-drafted',
      support: 'Priority',
    },
  },
  {
    id: 'scale',
    name: 'Scale',
    priceMonthly: 6999,
    priceAnnual: 69990,
    blurb: 'For NGOs with 50+ staff or multi-state ops',
    features: [
      'Everything in Growth, plus:',
      'Unlimited team members',
      'Unlimited AI report drafts',
      'SSO + custom roles · audit log',
      'Dedicated success manager',
      'On-prem / hosted-in-region option',
      'SLA + custom integrations',
    ],
    compare: {
      beneficiaries: 'Unlimited',
      teamMembers: 'Unlimited',
      reportsPerMonth: 'Unlimited',
      aiCopilot: 'Included',
      whatsapp: 'Included',
      csrPipeline: 'Included',
      grantDrafts: 'AI-drafted + custom',
      support: 'Dedicated CSM',
    },
  },
];

export function findPlan(id: SubscriptionTier): TierPlan | undefined {
  const norm = normalizeTier(id);
  return TIER_PLANS.find(p => p.id === norm);
}

/** Format an INR amount as ₹X,XXX (no decimals). */
export function formatINR(amount: number): string {
  if (amount === 0) return '₹0';
  return `₹${amount.toLocaleString('en-IN')}`;
}
