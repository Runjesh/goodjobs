import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Check, X, Sparkles } from 'lucide-react';
import { ModalOverlay } from '../ui/ModalOverlay';
import {
  TIER_PLANS,
  formatINR,
  type TierPlan,
  type BillingCycle,
} from '../../utils/trial';
import './PlansComparison.css';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-selects a plan card (visually highlights). */
  highlightTier?: TierPlan['id'];
  /** Initial cycle selection. */
  initialCycle?: BillingCycle;
  /** Called when user picks a paid tier — host opens Razorpay. */
  onChoose: (plan: TierPlan, cycle: BillingCycle) => void;
  /** Currently active tier — disables its own "Choose" button. */
  currentTier?: string;
  /** Headline copy override (e.g. "Pick the plan that fits"). */
  title?: string;
  /** Sub-headline copy override. */
  subtitle?: string;
}

const CompareRow: React.FC<{ label: string; values: string[] }> = ({ label, values }) => (
  <div className="plans-compare-row">
    <div className="plans-compare-label">{label}</div>
    {values.map((v, i) => (
      <div key={i} className="plans-compare-cell">
        {v === '—' ? <X size={14} className="plans-compare-x" /> :
         v === 'Included' ? <Check size={14} className="plans-compare-check" /> :
         <span>{v}</span>}
      </div>
    ))}
  </div>
);

const PlansComparison: React.FC<Props> = ({
  open,
  onClose,
  highlightTier,
  initialCycle = 'monthly',
  onChoose,
  currentTier,
  title,
  subtitle,
}) => {
  const [cycle, setCycle] = useState<BillingCycle>(initialCycle);

  useEffect(() => { if (open) setCycle(initialCycle); }, [open, initialCycle]);

  if (!open) return null;

  return (
    <ModalOverlay onBackdropClick={onClose} elevated>
      <motion.div
        className="plans-modal"
        role="dialog"
        aria-labelledby="plans-modal-title"
        initial={{ opacity: 0, scale: 0.96, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="plans-modal-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <header className="plans-modal-header">
          <div className="plans-modal-eyebrow"><Sparkles size={13} /> Choose a plan</div>
          <h2 id="plans-modal-title">{title ?? 'Pick the plan that fits your NGO'}</h2>
          <p>{subtitle ?? 'Switch between monthly and annual billing — annual saves you ~17%.'}</p>

          <div className="plans-cycle-toggle" role="tablist" aria-label="Billing cycle">
            <button
              role="tab"
              aria-selected={cycle === 'monthly'}
              className={cycle === 'monthly' ? 'is-active' : ''}
              onClick={() => setCycle('monthly')}
            >Monthly</button>
            <button
              role="tab"
              aria-selected={cycle === 'annual'}
              className={cycle === 'annual' ? 'is-active' : ''}
              onClick={() => setCycle('annual')}
            >Annual <span className="plans-cycle-save">Save 17%</span></button>
          </div>
        </header>

        <div className="plans-grid">
          {TIER_PLANS.map((plan) => {
            const price = cycle === 'annual' ? plan.priceAnnual : plan.priceMonthly;
            const isCurrent = currentTier === plan.id;
            const isHighlight = highlightTier === plan.id || (!highlightTier && plan.highlighted);
            return (
              <div
                key={plan.id}
                className={`plans-card ${isHighlight ? 'is-highlight' : ''} ${isCurrent ? 'is-current' : ''}`}
              >
                {plan.highlighted && <div className="plans-card-badge">Recommended</div>}
                {isCurrent && <div className="plans-card-current-badge">Your plan</div>}
                <div className="plans-card-name">{plan.name}</div>
                <div className="plans-card-price">
                  {price === 0 ? '₹0' : formatINR(price)}
                  <span className="plans-card-cycle">{price === 0 ? '/forever' : (cycle === 'annual' ? '/year' : '/month')}</span>
                </div>
                <div className="plans-card-blurb">{plan.blurb}</div>
                <ul className="plans-card-features">
                  {plan.features.map((f) => (
                    <li key={f}><Check size={13} /> <span>{f}</span></li>
                  ))}
                </ul>
                <button
                  className={`plans-card-cta ${isHighlight ? 'primary' : 'secondary'}`}
                  disabled={isCurrent}
                  onClick={() => onChoose(plan, cycle)}
                >
                  {isCurrent ? 'Current plan' : plan.id === 'starter' ? 'Stay on Starter' : `Choose ${plan.name}`}
                </button>
              </div>
            );
          })}
        </div>

        {/* Side-by-side comparison table */}
        <section className="plans-compare-table" aria-label="Feature comparison">
          <div className="plans-compare-row plans-compare-row--head">
            <div className="plans-compare-label">Feature</div>
            {TIER_PLANS.map(p => (
              <div key={p.id} className="plans-compare-cell plans-compare-cell--head">{p.name}</div>
            ))}
          </div>
          <CompareRow label="Beneficiaries" values={TIER_PLANS.map(p => p.compare.beneficiaries)} />
          <CompareRow label="Team members" values={TIER_PLANS.map(p => p.compare.teamMembers)} />
          <CompareRow label="AI report drafts" values={TIER_PLANS.map(p => p.compare.reportsPerMonth)} />
          <CompareRow label="AI Copilot" values={TIER_PLANS.map(p => p.compare.aiCopilot)} />
          <CompareRow label="WhatsApp data entry" values={TIER_PLANS.map(p => p.compare.whatsapp)} />
          <CompareRow label="CSR pipeline" values={TIER_PLANS.map(p => p.compare.csrPipeline)} />
          <CompareRow label="Grant report drafting" values={TIER_PLANS.map(p => p.compare.grantDrafts)} />
          <CompareRow label="Support" values={TIER_PLANS.map(p => p.compare.support)} />
        </section>

        <footer className="plans-modal-footer">
          Sandbox checkout · Razorpay test mode · No real charges
        </footer>
      </motion.div>
    </ModalOverlay>
  );
};

export default PlansComparison;
