import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { X, Check, Sparkles, AlertTriangle } from 'lucide-react';
import { ModalOverlay } from '../ui/ModalOverlay';
import { TIER_PLANS, daysLeftInTrial, formatINR, type TrialState } from '../../utils/trial';
import './TrialUpgradeModal.css';

interface Props {
  trial: TrialState;
  onDismiss: () => void;
  /** When true, pretend it's the day-30 expired-state modal instead of day-28 nudge. */
  variant?: 'day28' | 'expired';
}

const TrialUpgradeModal: React.FC<Props> = ({ trial, onDismiss, variant = 'day28' }) => {
  const navigate = useNavigate();
  const left = daysLeftInTrial(trial);

  const isExpired = variant === 'expired';

  const handleChoose = (tierId: string) => {
    onDismiss();
    // Task #5 will own the actual upgrade flow; we link to settings/billing here.
    navigate(`/settings?tab=billing&plan=${tierId}`);
  };

  return (
    <ModalOverlay onBackdropClick={onDismiss} elevated>
      <motion.div
        className="trial-upgrade-modal"
        role="dialog"
        aria-labelledby="trial-upgrade-title"
        initial={{ opacity: 0, scale: 0.96, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="trial-upgrade-close" onClick={onDismiss} aria-label="Close">
          <X size={18} />
        </button>

        <header className={`trial-upgrade-header ${isExpired ? 'is-expired' : ''}`}>
          <div className="trial-upgrade-eyebrow">
            {isExpired
              ? <><AlertTriangle size={13} /> Trial ended</>
              : <><Sparkles size={13} /> Your trial ends in {left} day{left === 1 ? '' : 's'}</>}
          </div>
          <h2 id="trial-upgrade-title">
            {isExpired ? "You're now on the Starter plan" : 'Choose how to keep going'}
          </h2>
          <p>
            {isExpired
              ? 'We\'ve kept your data safe and switched you to the free Starter tier. Upgrade any time to unlock AI Copilot, WhatsApp, and unlimited records.'
              : 'You\'ve been on Pro features for the trial. Pick a plan that fits your NGO so nothing breaks when the trial ends.'}
          </p>
        </header>

        <div className="trial-upgrade-grid">
          {TIER_PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`trial-plan-card ${plan.highlighted ? 'is-highlight' : ''}`}
            >
              {plan.highlighted && <div className="trial-plan-badge">Recommended</div>}
              <div className="trial-plan-name">{plan.name}</div>
              <div className="trial-plan-price">
                {plan.priceMonthly === 0
                  ? 'Free'
                  : <>{formatINR(plan.priceMonthly)}<span style={{ fontSize: '0.7em', fontWeight: 400, opacity: 0.7 }}> /mo</span></>}
              </div>
              <div className="trial-plan-blurb">{plan.blurb}</div>
              <ul className="trial-plan-features">
                {plan.features.map((f) => (
                  <li key={f}><Check size={13} /> <span>{f}</span></li>
                ))}
              </ul>
              <button
                className={`trial-plan-cta ${plan.highlighted ? 'primary' : 'secondary'}`}
                onClick={() => handleChoose(plan.id)}
              >
                {plan.id === 'starter' ? 'Stay on Starter' : `Choose ${plan.name}`}
              </button>
            </div>
          ))}
        </div>

        <footer className="trial-upgrade-footer">
          {isExpired
            ? 'Your data is safe — Starter limits apply until you upgrade.'
            : 'Cancel any time · No credit card needed to continue on Starter'}
          <button className="trial-upgrade-skip" onClick={onDismiss}>
            {isExpired ? 'Maybe later' : 'Remind me closer to the end'}
          </button>
        </footer>
      </motion.div>
    </ModalOverlay>
  );
};

export default TrialUpgradeModal;
