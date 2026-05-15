import type { Campaign, Transaction } from '../store/useStore';
import { programIdFromName } from './programFinance';

/** Resolve programme labels for a campaign from explicit links, cause, or gifts. */
export function programLabelsForCampaign(
  campaign: Campaign,
  transactions: Transaction[],
  allCampaigns: Campaign[],
): string[] {
  const labels = new Set<string>();
  const details = campaign.details || {};
  const explicit = details.programIds ?? details.program_ids ?? details.programmes;
  if (Array.isArray(explicit)) {
    for (const p of explicit) {
      const s = String(p).trim();
      if (s) labels.add(s);
    }
  }
  const linked = details.linkedProgram ?? details.linked_program;
  if (typeof linked === 'string' && linked.trim()) {
    labels.add(linked.trim());
  }
  if (campaign.cause) {
    campaign.cause.split(',').map(s => s.trim()).filter(Boolean).forEach(l => labels.add(l));
  }
  const cid = String(campaign.id);
  for (const t of transactions) {
    if (String(t.campaignId) !== cid) continue;
    const pid = t.programmeId != null ? String(t.programmeId).trim() : '';
    if (!pid) continue;
    const match = allCampaigns.find(c => String(c.id) === pid);
    labels.add(match?.title ?? pid.replace(/-/g, ' '));
  }
  return [...labels];
}

export function programIdsFromLabels(labels: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const l of labels) {
    const id = programIdFromName(l);
    if (id) out.add(id);
  }
  return out;
}
