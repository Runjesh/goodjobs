import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { CreditCard, Check, Sparkles, AlertTriangle, Calendar, Users, FileText, Cpu, Beaker } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTier, useUpgradeListener, type OpenUpgradeDetail } from '../../hooks/useTier';
import {
  TIER_PLANS,
  findPlan,
  formatINR,
  PAST_DUE_GRACE_DAYS,
  type TierPlan,
  type BillingCycle,
} from '../../utils/trial';
import { openRazorpayCheckout } from '../../utils/razorpay';
import PlansComparison from './PlansComparison';
import './PlansSection.css';

interface UsageBarProps {
  label: string;
  Icon: React.ElementType;
  used: number;
  cap: number | null;
  unit?: string;
}
const UsageBar: React.FC<UsageBarProps> = ({ label, Icon, used, cap, unit }) => {
  const unlimited = cap === null;
  const pct = unlimited ? 0 : Math.min(100, (used / Math.max(1, cap)) * 100);
  const danger = !unlimited && used >= cap;
  const warn = !unlimited && !danger && used / cap >= 0.8;
  const color = danger ? '#DC2626' : warn ? '#d97706' : '#0F766E';
  return (
    <div className="plans-usage-row">
      <div className="plans-usage-row-head">
        <div className="plans-usage-row-label">
          <Icon size={14} /> {label}
        </div>
        <div className="plans-usage-row-value" style={{ color }}>
          {used}
          {unlimited ? <span className="plans-usage-cap"> / unlimited</span>
                     : <span className="plans-usage-cap"> / {cap}{unit ? ` ${unit}` : ''}</span>}
        </div>
      </div>
      <div className="plans-usage-bar">
        <div className="plans-usage-bar-fill" style={{ width: `${unlimited ? 6 : pct}%`, background: unlimited ? '#94a3b8' : color }} />
      </div>
    </div>
  );
};

const PlansSection: React.FC = () => {
  const { user, updateUser } = useAuth();
  const { tier, chosenTier, limits, usage, billing, pastDue, daysUntilHardDowngrade } = useTier();

  const [modalOpen, setModalOpen] = useState(false);
  const [highlightTier, setHighlightTier] = useState<TierPlan['id'] | undefined>(undefined);
  const [initialCycle, setInitialCycle] = useState<BillingCycle>('monthly');

  // ── Open from contextual prompts firing the gj:open-upgrade event ───────────
  useUpgradeListener((detail: OpenUpgradeDetail) => {
    if (detail.targetTier) setHighlightTier(detail.targetTier);
    if (detail.cycle) setInitialCycle(detail.cycle);
    setModalOpen(true);
  });

  // ── Pick up ?tab=plans&plan=growth&cycle=annual on mount AND on history-state
  // changes (popstate/replaceState). useTier.openUpgrade uses replaceState when
  // we're already on /settings; without listening to it we'd miss intent fired
  // after the first mount.
  useEffect(() => {
    const applyFromUrl = () => {
      const url = new URL(window.location.href);
      const planParam = url.searchParams.get('plan');
      const cycleParam = url.searchParams.get('cycle');
      if (cycleParam === 'monthly' || cycleParam === 'annual') {
        setInitialCycle(cycleParam);
      }
      if (planParam === 'growth' || planParam === 'scale') {
        setHighlightTier(planParam);
        setModalOpen(true);
      }
    };
    applyFromUrl();
    window.addEventListener('popstate', applyFromUrl);
    return () => window.removeEventListener('popstate', applyFromUrl);
  }, []);

  const currentPlan = findPlan(tier);
  const periodEnd = billing?.currentPeriodEnd
    ? new Date(billing.currentPeriodEnd).toLocaleDateString('en-IN', { dateStyle: 'medium' })
    : null;

  const handleChoose = async (plan: TierPlan, cycle: BillingCycle) => {
    if (!user) return;
    if (plan.id === 'starter') {
      // Downgrade path (cancel paid plan).
      updateUser({ subscriptionTier: 'starter', billing: undefined });
      setModalOpen(false);
      toast.success('Switched to Starter plan.');
      return;
    }
    setModalOpen(false);
    const tid = toast.loading('Opening secure checkout…');
    try {
      await openRazorpayCheckout({
        plan,
        cycle,
        prefill: { name: user.name, email: user.email, contact: user.orgProfile?.phone },
        notes: { ngo_id: user.ngoId, ngo_name: user.ngoName },
        onSuccess: (paymentId) => {
          const periodMs = (cycle === 'annual' ? 365 : 30) * 86_400_000;
          updateUser({
            subscriptionTier: plan.id,
            billing: {
              status: 'active',
              currentPeriodEnd: new Date(Date.now() + periodMs).toISOString(),
              billingCycle: cycle,
              razorpayPaymentId: paymentId,
              lastAmountPaise: (cycle === 'annual' ? plan.priceAnnual : plan.priceMonthly) * 100,
            },
          });
          toast.dismiss(tid);
          toast.success(`You're on ${plan.name}! All features unlocked.`, { icon: '🎉', duration: 5000 });
        },
        onDismiss: () => {
          toast.dismiss(tid);
          toast('Checkout closed — no charge made.', { icon: '👋' });
        },
      });
    } catch (err) {
      toast.dismiss(tid);
      const msg = err instanceof Error && err.message ? err.message : 'Could not open checkout. Please try again.';
      toast.error(msg);
    }
  };

  // ── DEV-only mock helpers so QA can exercise past-due / downgrade ───────────
  const isDev = useMemo(() => {
    try { return !!import.meta.env.DEV; } catch { return false; }
  }, []);

  const mockPastDue = () => {
    if (!user) return;
    const next = {
      ...(user.billing ?? { billingCycle: 'monthly' as BillingCycle, currentPeriodEnd: new Date().toISOString() }),
      status: 'past_due' as const,
      pastDueSince: new Date().toISOString(),
    };
    updateUser({ billing: next });
    toast('Mock: payment marked past-due.', { icon: '⚠️' });
  };
  const mockResolvePastDue = () => {
    if (!user?.billing) return;
    updateUser({ billing: { ...user.billing, status: 'active', pastDueSince: undefined } });
    toast.success('Mock: payment recovered.');
  };
  const mockDowngradeNow = () => {
    if (!user) return;
    updateUser({ subscriptionTier: 'starter', billing: undefined });
    toast('Mock: downgraded to Starter.', { icon: '↘️' });
  };

  return (
    <div className="plans-section">
      <h3 className="settings-section-title">Plans & Billing</h3>

      {/* Current plan card */}
      <div className={`plans-current-card ${pastDue ? 'is-pastdue' : ''}`}>
        <div className="plans-current-header">
          <div>
            <div className="plans-current-eyebrow">Current plan</div>
            <div className="plans-current-name">
              {currentPlan?.name ?? tier}
              {pastDue && <span className="plans-current-pill">Payment failed</span>}
              {!pastDue && billing?.status === 'active' && <span className="plans-current-pill is-good">Active</span>}
              {tier === 'trial' && <span className="plans-current-pill is-good">Free trial</span>}
            </div>
            {periodEnd && (
              <div className="plans-current-period">
                <Calendar size={12} /> {pastDue ? 'Was renewing' : 'Renews'} {periodEnd}
                {billing?.billingCycle && <> · billed {billing.billingCycle}</>}
              </div>
            )}
            {pastDue && (
              <div className="plans-current-pastdue">
                <AlertTriangle size={13} />
                <span>
                  Auto-downgrade in {Math.max(0, daysUntilHardDowngrade)} day{daysUntilHardDowngrade === 1 ? '' : 's'} (grace period {PAST_DUE_GRACE_DAYS}d).
                </span>
              </div>
            )}
          </div>
          <button className="plans-current-cta" onClick={() => { setHighlightTier(undefined); setModalOpen(true); }}>
            <Sparkles size={14} /> Compare plans
          </button>
        </div>

        {/* Usage vs limits */}
        <div className="plans-usage-grid">
          <UsageBar label="Beneficiaries" Icon={Users} used={usage.beneficiaries} cap={limits.beneficiaries} />
          <UsageBar label="Team members" Icon={Users} used={usage.team} cap={limits.teamMembers} />
          <UsageBar label="AI report drafts (30d)" Icon={FileText} used={usage.reportsThisMonth} cap={limits.reportsPerMonth} />
          <div className="plans-usage-row">
            <div className="plans-usage-row-head">
              <div className="plans-usage-row-label"><Cpu size={14} /> AI Copilot</div>
              <div className="plans-usage-row-value" style={{ color: limits.aiAgents ? '#16A34A' : '#94a3b8' }}>
                {limits.aiAgents ? 'Enabled' : 'Locked'}
              </div>
            </div>
            <div className="plans-usage-bar">
              <div className="plans-usage-bar-fill"
                style={{ width: limits.aiAgents ? '100%' : '0%', background: '#16A34A' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Upgrade tiles for higher plans */}
      <div className="plans-upgrade-tiles">
        {TIER_PLANS.filter(p => p.id !== 'starter' && p.id !== chosenTier).map(p => (
          <div key={p.id} className={`plans-upgrade-tile ${p.highlighted ? 'is-highlight' : ''}`}>
            <div className="plans-upgrade-tile-name">
              {p.name}
              {p.highlighted && <span className="plans-upgrade-tile-badge">Recommended</span>}
            </div>
            <div className="plans-upgrade-tile-price">{formatINR(p.priceMonthly)}<span>/month</span></div>
            <ul>
              {p.features.slice(0, 4).map(f => <li key={f}><Check size={12} /> {f}</li>)}
            </ul>
            <button
              className="plans-upgrade-tile-cta"
              onClick={() => { setHighlightTier(p.id); setModalOpen(true); }}
            >
              <CreditCard size={13} /> Upgrade to {p.name}
            </button>
          </div>
        ))}
      </div>

      {/* DEV-only mock controls so the past-due path is testable without a backend */}
      {isDev && (
        <div className="plans-dev-tools">
          <div className="plans-dev-tools-label"><Beaker size={13} /> Dev tools (visible in dev build only)</div>
          <div className="plans-dev-tools-actions">
            {!pastDue && billing && <button onClick={mockPastDue}>Simulate past-due</button>}
            {pastDue && <button onClick={mockResolvePastDue}>Resolve past-due</button>}
            {billing && <button onClick={mockDowngradeNow}>Force downgrade to Starter</button>}
          </div>
        </div>
      )}

      {/* Invoice history (placeholder until the Razorpay webhook lands).
          We surface the last paid checkout from billing.razorpayPaymentId so
          finance teams have something to reconcile against; older invoices
          will appear here once the server-side ledger is wired up. */}
      <div className="plans-invoice-history" data-testid="plans-invoice-history">
        <div className="plans-invoice-history-head">
          <FileText size={14} /> <strong>Invoice history</strong>
        </div>
        {billing?.razorpayPaymentId ? (
          <div className="plans-invoice-row">
            <div>
              <div className="plans-invoice-row-id">{billing.razorpayPaymentId}</div>
              <div className="plans-invoice-row-meta">
                {billing.billingCycle === 'annual' ? 'Annual' : 'Monthly'} ·
                {' '}{currentPlan?.name ?? tier}
              </div>
            </div>
            <div className="plans-invoice-row-amount">
              {billing.lastAmountPaise
                ? formatINR(Math.round(billing.lastAmountPaise / 100))
                : '—'}
            </div>
          </div>
        ) : (
          <div className="plans-invoice-empty">
            No paid invoices yet. Receipts will appear here after your first checkout.
          </div>
        )}
      </div>

      <PlansComparison
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        highlightTier={highlightTier}
        initialCycle={initialCycle}
        currentTier={tier}
        onChoose={handleChoose}
      />
    </div>
  );
};

export default PlansSection;
