import type { ComplianceDocument, CSRCard } from '../store/useStore';

/**
 * Connection between a grant (CSR card) and the compliance document(s) the
 * funder requires (FCRA, 12A, 80G, CSR-1, etc.). When the doc moves to
 * "Expiring Soon" or "Expired", the grant flips to at-risk and an action
 * item appears in the Agent HQ HITL queue with a "Renew first" CTA.
 */
export interface ComplianceGrantLink {
  id: string;
  grantId: string;
  complianceDocId: string;
  /** Why the funder needs this doc — surfaced in tooltips. */
  reason?: string;
}

export type AtRiskTone = 'red' | 'yellow';

export interface AtRiskGrant {
  grant: CSRCard;
  doc: ComplianceDocument;
  link: ComplianceGrantLink;
  daysToExpiry: number;
  tone: AtRiskTone;
}

function daysUntil(dateIso: string, now = Date.now()): number {
  const t = new Date(dateIso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return Math.ceil((t - now) / 86_400_000);
}

/**
 * Returns every grant whose linked doc is expiring (≤30d) or already expired.
 * Sorted with the most urgent (smallest daysToExpiry) first.
 */
export function selectAtRiskGrants(
  links: ComplianceGrantLink[],
  grants: CSRCard[],
  docs: ComplianceDocument[],
  now = Date.now(),
): AtRiskGrant[] {
  const grantById = new Map(grants.map(g => [String(g.id), g]));
  const docById   = new Map(docs.map(d => [d.id, d]));
  const out: AtRiskGrant[] = [];

  for (const link of links) {
    const grant = grantById.get(String(link.grantId));
    const doc   = docById.get(link.complianceDocId);
    if (!grant || !doc) continue;
    const days = daysUntil(doc.expiry, now);
    const expiring = doc.status === 'Expiring Soon' || (days >= 0 && days <= 30);
    const expired  = doc.status === 'Expired' || days < 0;
    if (!expiring && !expired) continue;
    out.push({
      grant,
      doc,
      link,
      daysToExpiry: days,
      tone: expired ? 'red' : 'yellow',
    });
  }
  return out.sort((a, b) => a.daysToExpiry - b.daysToExpiry);
}
