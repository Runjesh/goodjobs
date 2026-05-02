// Trial state, day-of-trial math, and nudge cadence helpers.
// AuthUser carries `trial` so it lives wherever the user does.

export type SubscriptionTier = 'trial' | 'starter' | 'pro' | 'enterprise';

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

export const TRIAL_DAYS = 30;
export const NUDGE_DAY_7 = 7;
export const NUDGE_DAY_21 = 21;
export const NUDGE_DAY_28 = 28;

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
  if (state.tier !== 'trial') return state.tier;
  return isTrialExpired(state, now) ? 'starter' : 'trial';
}

/** Has nudge already fired (for any of the day-N markers)? */
export function nudgeFired(state: TrialState | undefined | null, key: keyof TrialNudgeState): boolean {
  return !!state?.nudges?.[key];
}

export function withNudgeFired(state: TrialState, key: keyof TrialNudgeState, now: Date = new Date()): TrialState {
  return { ...state, nudges: { ...state.nudges, [key]: now.getTime() } };
}

/**
 * Tier comparison data — used by the day-28 upgrade modal and the upgrade CTA target page.
 * Kept here so Task #5 can reuse the same source of truth.
 */
export interface TierPlan {
  id: Exclude<SubscriptionTier, 'trial'>;
  name: string;
  price: string;
  blurb: string;
  features: string[];
  highlighted?: boolean;
}

export const TIER_PLANS: TierPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '₹0',
    blurb: 'Free forever — for very small NGOs',
    features: [
      'Up to 50 beneficiaries',
      '1 program · 1 active campaign',
      'Manual receipts (no AI drafting)',
      'Email support',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '₹2,499/mo',
    blurb: 'Most NGOs choose this',
    highlighted: true,
    features: [
      'Unlimited beneficiaries · unlimited programs',
      'AI Copilot for reports & receipts',
      'WhatsApp field data entry',
      'CSR pipeline + grant report drafting',
      'Priority support · onboarding call',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    blurb: 'For NGOs with 50+ staff or multi-state ops',
    features: [
      'SSO + custom roles · audit log',
      'Dedicated success manager',
      'On-prem / hosted-in-region option',
      'SLA + custom integrations',
    ],
  },
];
