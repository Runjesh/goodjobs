// useTier — single hook every UI gate reads from.
// Wraps AuthContext + trial helpers + usage counters and exposes:
//   - the *effective* tier (handles trial expiry + past-due downgrade)
//   - concrete limits and usage for that tier
//   - billing status
//   - openUpgrade(): a stable entry-point UI components call to launch the
//     Plans modal pre-selected on a target tier.

import { useCallback, useMemo, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../store/useStore';
import {
  effectiveTierWithBilling,
  tierLimits,
  monthlyReportCount,
  isPastDue,
  daysUntilDowngrade,
  type SubscriptionTier,
  type TierLimits,
  type BillingState,
  type BillingCycle,
} from '../utils/trial';

// ── Cross-component event bus for the Plans modal ─────────────────────────────
// Settings hosts a single PlansComparisonModal and listens for these events so
// any contextual prompt anywhere in the app can pop the modal pre-selected on
// a target tier without prop-drilling.
export interface OpenUpgradeDetail {
  targetTier?: 'growth' | 'scale';
  cycle?: BillingCycle;
  /** Where the upgrade was triggered (for analytics + copy). */
  source?: string;
}

const UPGRADE_EVENT = 'gj:open-upgrade';

export function fireUpgradeEvent(detail: OpenUpgradeDetail = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<OpenUpgradeDetail>(UPGRADE_EVENT, { detail }));
}

export function useUpgradeListener(handler: (detail: OpenUpgradeDetail) => void): void {
  useEffect(() => {
    const fn = (e: Event) => {
      const ev = e as CustomEvent<OpenUpgradeDetail>;
      handler(ev.detail ?? {});
    };
    window.addEventListener(UPGRADE_EVENT, fn);
    return () => window.removeEventListener(UPGRADE_EVENT, fn);
  }, [handler]);
}

// ── Team-member tracker (no real /team API yet — use pendingInvites + self) ───
function teamMemberCount(invitesLen: number): number {
  // 1 (self) + outstanding invites. Replace with backend roster when wired.
  return 1 + invitesLen;
}

export interface TierUsage {
  beneficiaries: number;
  team: number;
  reportsThisMonth: number;
  agentsEnabled: boolean;
}

export interface UseTierResult {
  /** Effective tier (considers trial expiry + past-due downgrade). */
  tier: SubscriptionTier;
  /** Tier the user has explicitly chosen (may differ from effective during past-due grace). */
  chosenTier: SubscriptionTier | undefined;
  limits: TierLimits;
  usage: TierUsage;
  billing: BillingState | undefined;
  pastDue: boolean;
  daysUntilHardDowngrade: number;
  /** True while in 30-day free trial (not expired yet). */
  inTrial: boolean;
  /** Open the Plans modal (or navigate to Settings → Plans tab if not mounted). */
  openUpgrade: (detail?: OpenUpgradeDetail) => void;
}

export function useTier(): UseTierResult {
  const { user } = useAuth();
  const beneficiaries = useStore(s => s.beneficiaries);

  // Re-tick once a minute so past-due countdown / trial expiry refresh without
  // requiring a navigation. Cheap — only updates a single counter state.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const now = useMemo(() => new Date(), [tick, user?.trial?.endsAt, user?.billing?.pastDueSince]);

  const chosenTier = user?.subscriptionTier;
  const tier = useMemo(
    () => effectiveTierWithBilling(user?.trial, chosenTier, user?.billing, now),
    [user?.trial, chosenTier, user?.billing, now],
  );

  const limits = useMemo(() => tierLimits(tier), [tier]);

  const reportsThisMonth = useMemo(
    () => (user?.ngoId ? monthlyReportCount(user.ngoId, now) : 0),
    [user?.ngoId, now],
  );

  const usage: TierUsage = {
    beneficiaries: beneficiaries.length,
    team: teamMemberCount(user?.pendingInvites?.length ?? 0),
    reportsThisMonth,
    agentsEnabled: limits.aiAgents,
  };

  const inTrial = !!user?.trial && new Date(user.trial.endsAt).getTime() > now.getTime();

  const openUpgrade = useCallback((detail: OpenUpgradeDetail = {}) => {
    if (typeof window === 'undefined') {
      fireUpgradeEvent(detail);
      return;
    }
    // Always materialize intent in the URL so:
    //   (a) on hard navigations (other pages → Settings), PlansSection picks
    //       up the deep link on its own;
    //   (b) on soft transitions (already on /settings, even outside the Plans
    //       tab), Settings can switch tab and PlansSection can read params.
    const params = new URLSearchParams();
    params.set('tab', 'plans');
    if (detail.targetTier) params.set('plan', detail.targetTier);
    if (detail.cycle) params.set('cycle', detail.cycle);
    if (detail.source) params.set('src', detail.source);
    const targetUrl = `/settings?${params.toString()}`;

    const onSettings = window.location.pathname.startsWith('/settings');
    if (onSettings) {
      // Update URL without a full reload so React state survives.
      window.history.replaceState(null, '', targetUrl);
    } else {
      // Off-route → hard navigate; PlansSection's mount-effect handles the URL.
      window.location.assign(targetUrl);
      return; // event will be re-fired by PlansSection on mount via URL parse
    }
    fireUpgradeEvent(detail);
  }, []);

  return {
    tier,
    chosenTier,
    limits,
    usage,
    billing: user?.billing,
    pastDue: isPastDue(user?.billing),
    daysUntilHardDowngrade: daysUntilDowngrade(user?.billing, now),
    inTrial,
    openUpgrade,
  };
}
