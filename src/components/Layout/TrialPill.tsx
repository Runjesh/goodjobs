import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, AlertTriangle, Lock, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { daysLeftInTrial, isTrialExpired, effectiveTier } from '../../utils/trial';
import './TrialPill.css';

const LOCKED_FEATURES = [
  'AI Copilot (agent runs)',
  'AI Reports beyond 2/month',
  'Advanced analytics & exports',
  'Bulk WhatsApp outreach',
  'Multi-user roles (>2 seats)',
];

const TrialPillTooltip: React.FC<{
  expired: boolean;
  onUpgrade: () => void;
}> = ({ expired, onUpgrade }) => (
  <div className="trial-pill-tooltip">
    <div className="trial-pill-tooltip-title">
      {expired ? 'Trial ended — choose a plan' : 'What locks at Starter (free tier)'}
    </div>
    <ul className="trial-pill-tooltip-list">
      {LOCKED_FEATURES.map((f) => (
        <li key={f}>
          <Lock size={10} />
          <span>{f}</span>
        </li>
      ))}
    </ul>
    <p className="trial-pill-tooltip-note">
      All your data is preserved on any plan — nothing is deleted on downgrade.
    </p>
    <button
      type="button"
      className="trial-pill-tooltip-upgrade"
      onClick={(e) => { e.stopPropagation(); onUpgrade(); }}
    >
      Upgrade now <ChevronRight size={12} />
    </button>
  </div>
);

const TrialPill: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!user?.trial) return null;

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

  const handleUpgrade = () => {
    setOpen(false);
    navigate('/settings?tab=billing');
  };

  return (
    <div
      ref={wrapRef}
      className="trial-pill-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={`trial-pill trial-pill--${variant}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Icon size={13} />
        <span>{label}</span>
        {!expired && <span className="trial-pill-cta">Upgrade →</span>}
        {expired && <span className="trial-pill-cta">Choose plan →</span>}
      </button>
      {open && (
        <TrialPillTooltip expired={expired} onUpgrade={handleUpgrade} />
      )}
    </div>
  );
};

export default TrialPill;
