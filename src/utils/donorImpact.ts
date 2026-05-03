import type { Donor, Campaign, Transaction } from '../store/useStore';
import type { BeneficiaryOutcome } from './outcomes';
import { aggregateByProgram } from './outcomes';
import { programIdFromName } from './programFinance';

/**
 * Walks the chain donor → transactions → campaigns → programmes → outcomes
 * so the user can answer "what did this donor's money actually achieve?".
 *
 * Heuristic for campaign → programme: we use Campaign.cause as a programme
 * label (slugified). NGOs rarely have a strict mapping today, so a softer
 * link is acceptable for the trail; later we can promote this to an explicit
 * `campaignProgramLinks` table if the data warrants it.
 */

export interface CampaignContribution {
  campaign: Campaign;
  totalGiven: number;
  giftCount: number;
  /** Programme labels this campaign funded (best-effort from cause). */
  programLabels: string[];
}

export interface DonorImpactTrail {
  donor: Donor;
  campaigns: CampaignContribution[];
  programmes: {
    programId: string;
    programLabel: string;
    beneficiariesMeasured: number;
    avgImprovementPct: number;
    sroiScore: number;
  }[];
  totalRecorded: number;
  totalCampaignsFunded: number;
}

export function buildDonorImpactTrail(
  donor: Donor,
  transactions: Transaction[],
  campaigns: Campaign[],
  outcomes: BeneficiaryOutcome[],
): DonorImpactTrail {
  const myTx = transactions.filter(t => String(t.donorId) === String(donor.id));
  const totalRecorded = myTx.reduce((s, t) => s + Number(t.amount ?? 0), 0);

  // Group transactions by campaign id.
  const byCampaign = new Map<string, Transaction[]>();
  for (const t of myTx) {
    const key = String(t.campaignId || '_unattributed');
    const arr = byCampaign.get(key) ?? [];
    arr.push(t);
    byCampaign.set(key, arr);
  }

  const campaignContribs: CampaignContribution[] = [];
  const programLabelsTouched = new Set<string>();

  byCampaign.forEach((txs, campaignId) => {
    const campaign = campaigns.find(c => String(c.id) === campaignId);
    if (!campaign) return;
    const labels = campaign.cause
      ? campaign.cause.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    labels.forEach(l => programLabelsTouched.add(l));
    campaignContribs.push({
      campaign,
      totalGiven: txs.reduce((s, t) => s + Number(t.amount ?? 0), 0),
      giftCount: txs.length,
      programLabels: labels,
    });
  });

  // Aggregate outcomes filtered to the programmes this donor's money touched.
  const aggregateAll = aggregateByProgram(outcomes);
  const touchedIds = new Set(Array.from(programLabelsTouched).map(programIdFromName));
  const programmes = aggregateAll
    .filter(a => touchedIds.has(a.programId))
    .map(a => ({
      programId: a.programId,
      programLabel: a.programId.replace(/-/g, ' '),
      beneficiariesMeasured: a.beneficiaryCount,
      avgImprovementPct: a.avgImprovementPct,
      sroiScore: a.sroiScore,
    }));

  return {
    donor,
    campaigns: campaignContribs.sort((a, b) => b.totalGiven - a.totalGiven),
    programmes,
    totalRecorded,
    totalCampaignsFunded: campaignContribs.length,
  };
}
