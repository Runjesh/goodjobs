import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, AlertTriangle, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { daysLeftInTrial, isTrialExpired, effectiveTier } from '../../utils/trial';
import './TrialPill.css';

/**
 * Compact header pill that surfaces trial status. Click → routes to Settings/billing
 * (the upgrade flow itself is built in Task #5).
 */
const TrialPill: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!user?.trial) return null;

  // If user has already chosen a paid tier, hide the pill.
  if (user.subscriptionTier && user.subscriptionTier !== 'trial' && user.subscriptionTier !== 'starter') {
    return null;
  }

  const expired = isTrialExpired(user.trial);
  const left = daysLeftInTrial(user.trial);
  const tier = effectiveTier(user.trial);

  const variant: 'ok' | 'warn' | 'urgent' | 'expired' =
    expired ? 'expired'
    : left <= 3 ? 'urgent'
    : left <= 9 ? 'warn'
    : 'ok';

  const label = expired
    ? `Trial ended · on ${tier === 'starter' ? 'Starter' : 'Free'}`
    : `Trial: ${left} day${left === 1 ? '' : 's'} left`;

  const Icon = expired ? Lock : variant === 'urgent' ? AlertTriangle : Sparkles;

  return (
    <button
      type="button"
      className={`trial-pill trial-pill--${variant}`}
      onClick={() => navigate('/settings?tab=billing')}
      title={expired
        ? 'Your trial has ended — upgrade to unlock all features.'
        : `Your 30-day trial — ${left} day${left === 1 ? '' : 's'} remaining. Click to upgrade.`}
    >
      <Icon size={13} />
      <span>{label}</span>
      {!expired && <span className="trial-pill-cta">Upgrade →</span>}
      {expired && <span className="trial-pill-cta">Choose plan →</span>}
    </button>
  );
};

export default TrialPill;
