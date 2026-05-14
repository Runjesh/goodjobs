import React from 'react';
import { motion } from 'framer-motion';
import { Lock, ArrowRight, X, Sparkles } from 'lucide-react';
import { ModalOverlay } from '../ui/ModalOverlay';
import { findPlan, formatINR } from '../../utils/trial';
import './ContextualUpgradePrompt.css';

export interface ContextualUpgradePromptProps {
  open: boolean;
  onClose: () => void;
  /** What the user just tried to do (e.g. "Add another beneficiary"). */
  blockedAction: string;
  /** Headline shown above the next-tier benefit (defaults to limit copy). */
  reason: string;
  /** Bullet list of what unlocking the next tier gets them. */
  nextBenefits: string[];
  /** Tier the user should upgrade *to*. */
  targetTier: 'growth' | 'scale';
  /** Called when user clicks "Upgrade now" — host opens Plans modal / Razorpay. */
  onUpgrade: () => void;
}

const ContextualUpgradePrompt: React.FC<ContextualUpgradePromptProps> = ({
  open, onClose, blockedAction, reason, nextBenefits, targetTier, onUpgrade,
}) => {
  if (!open) return null;
  const plan = findPlan(targetTier);
  const price = plan ? formatINR(plan.priceMonthly) : '';

  return (
    <ModalOverlay onBackdropClick={onClose} elevated>
      <motion.div
        className="ctx-upgrade-modal"
        role="dialog"
        aria-labelledby="ctx-upgrade-title"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="ctx-upgrade-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <div className="ctx-upgrade-icon" aria-hidden="true"><Lock size={22} /></div>
        <div className="ctx-upgrade-eyebrow">{blockedAction} is on a higher plan</div>
        <h3 id="ctx-upgrade-title" className="ctx-upgrade-title">{reason}</h3>

        <div className="ctx-upgrade-benefits">
          <div className="ctx-upgrade-benefits-label">
            <Sparkles size={13} /> Upgrade to {plan?.name ?? targetTier} to unlock:
          </div>
          <ul>
            {nextBenefits.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>

        <div className="ctx-upgrade-price">
          <strong>{price}</strong>
          <span>/month · cancel any time</span>
        </div>

        <div className="ctx-upgrade-actions">
          <button className="ctx-upgrade-cta-secondary" onClick={onClose}>
            Maybe later
          </button>
          <button className="ctx-upgrade-cta-primary" onClick={onUpgrade}>
            Upgrade now <ArrowRight size={14} />
          </button>
        </div>
      </motion.div>
    </ModalOverlay>
  );
};

export default ContextualUpgradePrompt;
