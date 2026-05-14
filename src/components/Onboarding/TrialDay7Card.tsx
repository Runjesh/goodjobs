import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, X, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  daysSinceStart, daysLeftInTrial, isTrialExpired,
  nudgeFired, withNudgeFired,
  NUDGE_DAY_7,
} from '../../utils/trial';
import './TrialBanner.css';

// Card is shown for a tight 7-day window starting on day 7. After day 13
// the day-21 toast / day-28 modal take over so the Today screen doesn't
// get cluttered with stale "you're early in your trial" copy.
const DAY7_CARD_WINDOW_END = 14;

/**
 * Day-7 informational card on the Today screen — encourages exploring
 * Pro-only features before the trial runs down. Hidden once dismissed,
 * after day 28 (modal takes over), or after expiry. Dismissal is stored
 * in the org-scoped trial.nudges.day7 field so all roles within the
 * same NGO see a consistent state.
 */
const TrialDay7Card: React.FC = () => {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();

  if (!user?.trial) return null;
  if (isTrialExpired(user.trial)) return null;
  if (nudgeFired(user.trial, 'day7')) return null;

  const since = daysSinceStart(user.trial);
  const left = daysLeftInTrial(user.trial);
  if (since < NUDGE_DAY_7 || since >= DAY7_CARD_WINDOW_END) return null;

  const handleDismiss = () => {
    updateUser({ trial: withNudgeFired(user.trial!, 'day7') });
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
