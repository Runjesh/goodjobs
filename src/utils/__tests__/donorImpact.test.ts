import { describe, it, expect } from 'vitest';
import { buildDonorImpactTrail } from '../donorImpact';
import type { Donor, Campaign, Transaction } from '../../store/useStore';
import type { BeneficiaryOutcome } from '../outcomes';
import { programIdFromName } from '../programFinance';

const donor: Donor = {
  id: 'd1', name: 'Anita', type: 'Major', totalGiven: 0,
  lastGift: '', initial: 'A', pan: '', location: '', tags: [],
};

const campaigns: Campaign[] = [
  { id: 'c1', title: 'Girls Edu', raised: 0, goal: 0, donorsCount: 0, status: 'active', image: '', cause: 'Digital Literacy 2026' },
  { id: 'c2', title: 'Health',     raised: 0, goal: 0, donorsCount: 0, status: 'active', image: '', cause: 'Healthcare Camp' },
];

const txs: Transaction[] = [
  { id: 't1', donorId: 'd1', donorName: 'Anita', amount: 5000,  method: 'UPI', campaignId: 'c1', campaignTitle: 'Girls Edu', date: '', timestamp: 1 },
  { id: 't2', donorId: 'd1', donorName: 'Anita', amount: 3000,  method: 'UPI', campaignId: 'c1', campaignTitle: 'Girls Edu', date: '', timestamp: 2 },
  { id: 't3', donorId: 'd1', donorName: 'Anita', amount: 2000,  method: 'UPI', campaignId: 'c2', campaignTitle: 'Health',    date: '', timestamp: 3 },
  { id: 't4', donorId: 'other', donorName: 'X',  amount: 99999, method: 'UPI', campaignId: 'c1', campaignTitle: 'Girls Edu', date: '', timestamp: 4 },
];

const outcomes: BeneficiaryOutcome[] = [
  { id: 'o1', beneficiaryId: 'b1', programId: programIdFromName('Digital Literacy 2026'), metric: 'lit', metricLabel: 'Literacy', baseline: 40, current: 60, higherIsBetter: true, measuredAt: '2026-04-01' },
  { id: 'o2', beneficiaryId: 'b2', programId: programIdFromName('Digital Literacy 2026'), metric: 'lit', metricLabel: 'Literacy', baseline: 30, current: 45, higherIsBetter: true, measuredAt: '2026-04-02' },
  { id: 'o3', beneficiaryId: 'b3', programId: programIdFromName('Unrelated'),             metric: 'lit', metricLabel: 'Literacy', baseline: 10, current: 20, higherIsBetter: true, measuredAt: '2026-04-03' },
];

describe('buildDonorImpactTrail', () => {
  it('filters transactions to the donor and totals their gifts', () => {
    const trail = buildDonorImpactTrail(donor, txs, campaigns, outcomes);
    expect(trail.totalRecorded).toBe(10000);
    expect(trail.totalCampaignsFunded).toBe(2);
  });

  it('aggregates per campaign with most-given first', () => {
    const trail = buildDonorImpactTrail(donor, txs, campaigns, outcomes);
    expect(trail.campaigns[0].campaign.id).toBe('c1');
    expect(trail.campaigns[0].totalGiven).toBe(8000);
    expect(trail.campaigns[0].giftCount).toBe(2);
  });

  it('only surfaces outcomes for programmes this donor funded', () => {
    const trail = buildDonorImpactTrail(donor, txs, campaigns, outcomes);
    const ids = trail.programmes.map(p => p.programId);
    expect(ids).toContain(programIdFromName('Digital Literacy 2026'));
    expect(ids).not.toContain(programIdFromName('Unrelated'));
  });

  it('returns empty trail for a donor with no transactions', () => {
    const trail = buildDonorImpactTrail({ ...donor, id: 'ghost' }, txs, campaigns, outcomes);
    expect(trail.totalRecorded).toBe(0);
    expect(trail.campaigns).toEqual([]);
    expect(trail.programmes).toEqual([]);
  });
});
