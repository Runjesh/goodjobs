import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTier } from '../../hooks/useTier';
import { useAuth } from '../../context/AuthContext';
import { findPlan } from '../../utils/trial';
import toast from 'react-hot-toast';
import './PastDueBanner.css';

/**
 * Shown above main content when the org's subscription payment is past due.
 * Surfaces the days remaining before hard-downgrade and a one-click retry CTA
 * that re-opens Razorpay for the same plan/cycle.
 */
const PastDueBanner: React.FC = () => {
  const { user, updateUser } = useAuth();
  const { billing, pastDue, daysUntilHardDowngrade, openUpgrade, chosenTier } = useTier();

  if (!pastDue || !billing) return null;

  const plan = findPlan(chosenTier ?? 'growth');
  const daysCopy =
    daysUntilHardDowngrade <= 0
      ? 'Grace period ended — Starter limits now apply.'
      : `Auto-downgrades in ${daysUntilHardDowngrade} day${daysUntilHardDowngrade === 1 ? '' : 's'}.`;

  const handleRetry = () => {
    openUpgrade({
      targetTier: (chosenTier === 'scale' || chosenTier === 'enterprise') ? 'scale' : 'growth',
      cycle: billing.billingCycle,
      source: 'past_due_banner',
    });
  };

  const handleDismissForSession = () => {
    // Soft-dismiss for this tab; banner returns on reload.
    toast('Reminder muted for this session.', { icon: '🔕', duration: 2000 });
    sessionStorage.setItem('gj_pastdue_muted', '1');
    if (user) updateUser({}); // force re-render
  };

  if (sessionStorage.getItem('gj_pastdue_muted') === '1') return null;

  return (
    <div className="pastdue-banner" role="status">
      <div className="pastdue-banner-icon"><AlertTriangle size={16} /></div>
      <div className="pastdue-banner-body">
        <strong>Payment failed for your {plan?.name ?? 'subscription'} plan.</strong>
        <span>{daysCopy}</span>
      </div>
      <button className="pastdue-banner-cta" onClick={handleRetry}>
        <RefreshCw size={13} /> Retry payment
      </button>
      <button className="pastdue-banner-dismiss" onClick={handleDismissForSession} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
};

export default PastDueBanner;
