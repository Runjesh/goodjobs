import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { isTrialExpired } from '../../utils/trial';
import './TrialBanner.css';

/**
 * Persistent top-of-page banner shown once the 30-day trial expires.
 * Reminds the user they're on Starter limits and surfaces the upgrade CTA.
 */
const TrialExpiredBanner: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!user?.trial) return null;
  // Hide once the user has explicitly chosen a paid tier.
  if (user.subscriptionTier && user.subscriptionTier !== 'trial' && user.subscriptionTier !== 'starter') {
    return null;
  }
  if (!isTrialExpired(user.trial)) return null;

  return (
    <div className="trial-expired-banner" role="status">
      <div className="trial-expired-banner-icon"><Lock size={16} /></div>
      <div className="trial-expired-banner-body">
        <strong>Your 30-day trial has ended.</strong>
        <span>You're on the Starter plan — AI Copilot, WhatsApp, and unlimited records are paused. Upgrade to keep them.</span>
      </div>
      <button
        className="trial-expired-banner-cta"
        onClick={() => navigate('/settings?tab=billing')}
      >
        Choose a plan <ArrowRight size={14} />
      </button>
    </div>
  );
};

export default TrialExpiredBanner;
