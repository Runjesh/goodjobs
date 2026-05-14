import { describe, expect, it, beforeEach } from 'vitest';
import {
  normalizeTier,
  effectiveTierWithBilling,
  isPastDue,
  daysUntilDowngrade,
  monthlyReportCount,
  recordReportDraft,
  makeFreshTrial,
  PAST_DUE_GRACE_DAYS,
  type BillingState,
  type TrialState,
} from '../trial';

const NGO_ID = 'ngo_test_001';

beforeEach(() => {
  window.localStorage.clear();
});

describe('normalizeTier', () => {
  it('maps legacy aliases to canonical names', () => {
    expect(normalizeTier('pro')).toBe('growth');
    expect(normalizeTier('enterprise')).toBe('scale');
  });

  it('passes canonical tiers through unchanged', () => {
    expect(normalizeTier('starter')).toBe('starter');
    expect(normalizeTier('growth')).toBe('growth');
    expect(normalizeTier('scale')).toBe('scale');
    expect(normalizeTier('trial')).toBe('trial');
  });

  it('falls back to trial when value is missing', () => {
    expect(normalizeTier(undefined)).toBe('trial');
    expect(normalizeTier(null)).toBe('trial');
  });
});

describe('isPastDue', () => {
  it('returns true only when status is past_due', () => {
    expect(isPastDue(undefined)).toBe(false);
    expect(isPastDue(null)).toBe(false);
    expect(isPastDue({ status: 'active', currentPeriodEnd: '', billingCycle: 'monthly' })).toBe(false);
    expect(isPastDue({ status: 'canceled', currentPeriodEnd: '', billingCycle: 'monthly' })).toBe(false);
    expect(isPastDue({ status: 'past_due', currentPeriodEnd: '', billingCycle: 'monthly' })).toBe(true);
  });
});

describe('daysUntilDowngrade', () => {
  const baseBilling = (over: Partial<BillingState> = {}): BillingState => ({
    status: 'active',
    currentPeriodEnd: '2099-01-01T00:00:00.000Z',
    billingCycle: 'monthly',
    ...over,
  });

  it('returns the full grace period when not past_due', () => {
    expect(daysUntilDowngrade(undefined)).toBe(PAST_DUE_GRACE_DAYS);
    expect(daysUntilDowngrade(baseBilling())).toBe(PAST_DUE_GRACE_DAYS);
  });

  it('returns the full grace period the moment a payment becomes past_due', () => {
    const now = new Date('2026-01-10T00:00:00.000Z');
    const billing = baseBilling({ status: 'past_due', pastDueSince: now.toISOString() });
    expect(daysUntilDowngrade(billing, now)).toBe(PAST_DUE_GRACE_DAYS);
  });

  it('counts down as the grace period elapses', () => {
    const since = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date('2026-01-04T00:00:00.000Z'); // 3 days later
    const billing = baseBilling({ status: 'past_due', pastDueSince: since.toISOString() });
    expect(daysUntilDowngrade(billing, now)).toBe(PAST_DUE_GRACE_DAYS - 3);
  });

  it('goes negative when the grace period has fully elapsed', () => {
    const since = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date('2026-01-15T00:00:00.000Z'); // way past grace
    const billing = baseBilling({ status: 'past_due', pastDueSince: since.toISOString() });
    expect(daysUntilDowngrade(billing, now)).toBeLessThanOrEqual(0);
  });

  it('returns full grace when past_due with no pastDueSince timestamp', () => {
    expect(daysUntilDowngrade(baseBilling({ status: 'past_due' }))).toBe(PAST_DUE_GRACE_DAYS);
  });
});

describe('effectiveTierWithBilling', () => {
  const now = new Date('2026-06-01T00:00:00.000Z');
  const activeTrial: TrialState = {
    startedAt: new Date('2026-05-25T00:00:00.000Z').toISOString(),
    endsAt: new Date('2026-06-25T00:00:00.000Z').toISOString(),
    tier: 'trial',
    nudges: {},
  };
  const expiredTrial: TrialState = {
    startedAt: new Date('2026-04-01T00:00:00.000Z').toISOString(),
    endsAt: new Date('2026-05-01T00:00:00.000Z').toISOString(),
    tier: 'trial',
    nudges: {},
  };

  it('returns trial when an active trial is the only signal', () => {
    expect(effectiveTierWithBilling(activeTrial, undefined, undefined, now)).toBe('trial');
  });

  it('drops to starter when the trial has expired and no plan was chosen', () => {
    expect(effectiveTierWithBilling(expiredTrial, undefined, undefined, now)).toBe('starter');
  });

  it('honours a chosen subscription tier and normalises legacy aliases', () => {
    expect(effectiveTierWithBilling(activeTrial, 'growth', undefined, now)).toBe('growth');
    expect(effectiveTierWithBilling(activeTrial, 'pro', undefined, now)).toBe('growth');
    expect(effectiveTierWithBilling(activeTrial, 'enterprise', undefined, now)).toBe('scale');
  });

  it('keeps the chosen paid tier while past_due is still inside the grace window', () => {
    const billing: BillingState = {
      status: 'past_due',
      currentPeriodEnd: now.toISOString(),
      billingCycle: 'monthly',
      // 2 days into a 7-day grace
      pastDueSince: new Date(now.getTime() - 2 * 86_400_000).toISOString(),
    };
    expect(effectiveTierWithBilling(activeTrial, 'growth', billing, now)).toBe('growth');
  });

  it('hard-downgrades to starter once the past_due grace expires', () => {
    const billing: BillingState = {
      status: 'past_due',
      currentPeriodEnd: now.toISOString(),
      billingCycle: 'monthly',
      pastDueSince: new Date(now.getTime() - (PAST_DUE_GRACE_DAYS + 2) * 86_400_000).toISOString(),
    };
    expect(effectiveTierWithBilling(activeTrial, 'growth', billing, now)).toBe('starter');
  });

  it('returns starter when no trial exists and no plan was chosen', () => {
    expect(effectiveTierWithBilling(undefined, undefined, undefined, now)).toBe('starter');
  });

  it('treats trial as the chosen subscription value as a no-op (uses the trial calculation)', () => {
    // subscriptionTier === 'trial' should fall through to effectiveTier(trial).
    expect(effectiveTierWithBilling(expiredTrial, 'trial', undefined, now)).toBe('starter');
    expect(effectiveTierWithBilling(activeTrial, 'trial', undefined, now)).toBe('trial');
  });
});

describe('monthlyReportCount + recordReportDraft', () => {
  it('starts at zero and ignores empty ngoId', () => {
    expect(monthlyReportCount(NGO_ID)).toBe(0);
    recordReportDraft(''); // no-op
    expect(monthlyReportCount('')).toBe(0);
  });

  it('increments after each draft within the rolling 30 days', () => {
    const now = new Date('2026-06-15T12:00:00.000Z');
    recordReportDraft(NGO_ID, now);
    recordReportDraft(NGO_ID, now);
    recordReportDraft(NGO_ID, now);
    expect(monthlyReportCount(NGO_ID, now)).toBe(3);
  });

  it('drops drafts older than 30 days from the rolling window', () => {
    const old = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date('2026-03-01T00:00:00.000Z'); // ~60 days later
    recordReportDraft(NGO_ID, old);
    recordReportDraft(NGO_ID, old);
    expect(monthlyReportCount(NGO_ID, now)).toBe(0);

    recordReportDraft(NGO_ID, now);
    expect(monthlyReportCount(NGO_ID, now)).toBe(1);
  });

  it('isolates counts per ngoId', () => {
    const now = new Date('2026-06-15T12:00:00.000Z');
    recordReportDraft('ngo_a', now);
    recordReportDraft('ngo_a', now);
    recordReportDraft('ngo_b', now);
    expect(monthlyReportCount('ngo_a', now)).toBe(2);
    expect(monthlyReportCount('ngo_b', now)).toBe(1);
  });
});

describe('makeFreshTrial (sanity)', () => {
  it('produces a 30-day window with tier=trial', () => {
    const t = makeFreshTrial(new Date('2026-06-01T00:00:00.000Z'));
    expect(t.tier).toBe('trial');
    const start = new Date(t.startedAt).getTime();
    const end = new Date(t.endsAt).getTime();
    expect(Math.round((end - start) / 86_400_000)).toBe(30);
  });
});
