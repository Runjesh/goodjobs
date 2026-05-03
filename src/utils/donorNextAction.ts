import type { Donor } from '../store/useStore';

export type NextActionBand = 'high' | 'mid' | 'low';

export interface NextAction {
  band: NextActionBand;
  /** One-line label rendered next to the donor row. */
  label: string;
  /** WhatsApp template id to seed the composer with. */
  templateId: 'thank' | 'reactivate' | 'impact' | 'event';
  /** Suggested ask amount (₹). Only present for high band. */
  suggestedAmount?: number;
}

/**
 * Derive a band + suggested next action for a donor.
 * Prefers an authoritative score (e.g. backend propensity) when provided;
 * otherwise falls back to a recency + lifetime-value heuristic so every
 * row has a directional CTA.
 */
export function deriveNextAction(donor: Donor, score?: number): NextAction {
  let band: NextActionBand;
  if (typeof score === 'number') {
    band = score >= 80 ? 'high' : score >= 50 ? 'mid' : 'low';
  } else {
    band = inferBand(donor);
  }

  if (band === 'high') {
    const suggested = suggestAmount(donor);
    return {
      band,
      label: `Ready for renewal ask · ₹${suggested.toLocaleString('en-IN')}`,
      templateId: 'reactivate',
      suggestedAmount: suggested,
    };
  }
  if (band === 'mid') {
    return {
      band,
      label: 'Send Day-30 impact update',
      templateId: 'impact',
    };
  }
  return {
    band,
    label: 'Stewardship: schedule call',
    templateId: 'thank',
  };
}

function inferBand(d: Donor): NextActionBand {
  const last = parseDate(d.lastGift);
  const daysSince = last ? Math.floor((Date.now() - last) / 86_400_000) : 999;
  // Major donors and recurring with recent activity → high (likely to renew).
  if (d.type === 'Major Donor' || (d.type === 'Recurring' && daysSince < 90)) return 'high';
  // Stale-but-not-dead → mid.
  if (daysSince < 240) return 'mid';
  return 'low';
}

function suggestAmount(d: Donor): number {
  // Suggest the donor's prior average gift, rounded up to a friendly increment.
  const base = d.totalGiven > 0 ? Math.max(1000, Math.round(d.totalGiven / 4)) : 5000;
  // Round to nearest 500.
  return Math.ceil(base / 500) * 500;
}

function parseDate(iso: string): number | null {
  if (!iso || iso === 'N/A') return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}
