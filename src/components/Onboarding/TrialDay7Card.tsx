import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, X, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  daysSinceStart, daysLeftInTrial, isTrialExpired,
  NUDGE_DAY_7, NUDGE_DAY_28,
} from '../../utils/trial';
import './TrialBanner.css';

const DISMISS_KEY = 'gj_trial_day7_dismissed_v1';

function isDismissed(userId: string): boolean {
  try {
    const m = JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}');
    return !!m[userId];
  } catch { return false; }
}

function markDismissed(userId: string) {
  try {
    const m = JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}');
    m[userId] = Date.now();
    localStorage.setItem(DISMISS_KEY, JSON.stringify(m));
  } catch { /* ignore */ }
}

/**
 * Day-7 informational card on the Today screen — encourages exploring
 * Pro-only features before the trial runs down. Hidden once dismissed,
 * after day 28 (modal takes over), or after expiry.
 */
const TrialDay7Card: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(() => (user ? isDismissed(user.id) : true));

  if (!user?.trial || hidden) return null;
  if (isTrialExpired(user.trial)) return null;

  const since = daysSinceStart(user.trial);
  const left = daysLeftInTrial(user.trial);
  if (since < NUDGE_DAY_7 || since >= NUDGE_DAY_28) return null;

  const handleDismiss = () => {
    markDismissed(user.id);
    setHidden(true);
  };

  return (
    <div className="trial-day7-card" role="status">
      <div className="trial-day7-card-icon"><Sparkles size={18} /></div>
      <div className="trial-day7-card-body">
        <strong>You're {since} days into your free trial — {left} day{left === 1 ? '' : 's'} to go.</strong>
        <p>
          Try the AI Copilot to draft a funder report, or wire up WhatsApp so field staff
          can log services this week. These features pause when the trial ends.
        </p>
      </div>
      <div className="trial-day7-card-actions">
        <button
          className="trial-day7-card-cta"
          onClick={() => navigate('/agent-hq')}
        >
          Try AI Copilot <ArrowRight size={14} />
        </button>
        <button
          className="trial-day7-card-dismiss"
          onClick={handleDismiss}
          aria-label="Dismiss this card"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export default TrialDay7Card;
