import React, { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { findPlan, normalizeTier } from '../../utils/trial';

const ACKED_KEY = 'gj_welcome_acked_v1';

function readAcked(): Set<string> {
  try {
    const raw = localStorage.getItem(ACKED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeAcked(s: Set<string>): void {
  try {
    localStorage.setItem(ACKED_KEY, JSON.stringify([...s]));
  } catch {
    /* non-fatal */
  }
}

/**
 * Persistent post-upgrade welcome banner. Shown once per successful payment
 * (keyed by Razorpay payment id) on every page until the user dismisses it.
 *
 * Mounted in Layout above the page outlet so the celebration follows the user
 * wherever they go after checking out — not just on the Plans tab. A toast is
 * still fired by PlansSection at the moment of payment; the banner stays
 * around so the moment of "I just upgraded" reads as significant in the UI.
 */
const WelcomeBanner: React.FC = () => {
  const { user } = useAuth();
  const paymentId = user?.billing?.razorpayPaymentId;
  const status = user?.billing?.status;
  const tier = normalizeTier(user?.subscriptionTier);

  const [acked, setAcked] = useState<Set<string>>(() => readAcked());

  // Re-read acked when the payment id changes (e.g. another upgrade).
  useEffect(() => {
    setAcked(readAcked());
  }, [paymentId]);

  // Hide if: no payment yet, currently past-due (PastDueBanner takes over), or
  // user has already dismissed this exact payment id.
  if (!paymentId) return null;
  if (status === 'past_due' || status === 'canceled') return null;
  if (tier === 'starter' || tier === 'trial') return null;
  if (acked.has(paymentId)) return null;

  const plan = findPlan(tier);
  const planName = plan?.name ?? tier;

  const dismiss = () => {
    const next = new Set(acked);
    next.add(paymentId);
    writeAcked(next);
    setAcked(next);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '0.7rem 1rem', margin: '0 0 0.75rem 0',
        background: 'linear-gradient(90deg, #ecfdf5, #f0fdfa)',
        border: '1px solid #99f6e4',
        borderRadius: '10px',
        color: '#065f46',
        fontSize: '0.85rem',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 32, height: 32, borderRadius: 8,
          background: '#0F766E', color: '#fff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}
      >
        <Sparkles size={16} />
      </div>
      <div style={{ flex: 1, lineHeight: 1.35 }}>
        <strong style={{ color: '#065f46' }}>You're on {planName}.</strong>{' '}
        <span style={{ color: '#0f766e' }}>
          AI Copilot, WhatsApp data entry and unlimited beneficiaries are now live for your team.
        </span>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss welcome banner"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#065f46', padding: 4, display: 'inline-flex', alignItems: 'center',
          borderRadius: 6,
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
};

export default WelcomeBanner;
