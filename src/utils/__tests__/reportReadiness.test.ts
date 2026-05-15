import { describe, it, expect } from 'vitest';
import { computeReportReadiness } from '../reportReadiness';
import type { ReportRecord } from '../../data/reportsCatalogue';

const baseReport: ReportRecord = {
  id: 'rpt-grant-42',
  title: 'Q2 Funder Report',
  type: 'funder',
  status: 'draft',
  date: '2026-06-01',
  programmeName: 'Women Livelihood Center',
  programmeId: 'women-livelihood-center',
  funder: 'Tata Trusts',
};

describe('reportReadiness', () => {
  it('flags missing outcomes with MIS fix link', () => {
    const r = computeReportReadiness({
      report: baseReport,
      beneficiaries: [{ id: '1', name: 'A', program: 'Women Livelihood Center', location: 'X', aadhaar: true, familySize: 1 }],
      beneficiaryOutcomes: [],
      transactions: [],
      journalEntries: [{ programmeId: 'women-livelihood-center', grantTag: { grantId: '42' }, entryType: 'Expense', amount: -100 }],
      csrCards: [{ id: '42', company: 'Tata', project: 'P', col: 'live' } as any],
      donors: [],
    });
    const outcomes = r.items.find(i => i.id === 'outcomes');
    expect(outcomes?.met).toBe(false);
    expect(outcomes?.fixPath).toContain('tab=mis');
    expect(r.isReady).toBe(false);
    expect(r.readyLabel).toMatch(/Missing/);
  });

  it('is ready when all funder checks pass', () => {
    localStorage.setItem('goodjobs.grant.42.v1', JSON.stringify({ nextReportDue: '2026-07-01' }));
    const r = computeReportReadiness({
      report: baseReport,
      beneficiaries: [{ id: '1', name: 'A', program: 'Women Livelihood Center', location: 'X', aadhaar: true, familySize: 1 }],
      beneficiaryOutcomes: [{ programId: 'women-livelihood-center', metricLabel: 'Income', baseline: 1, current: 2 }],
      transactions: [],
      journalEntries: [{ programmeId: 'women-livelihood-center', grantTag: { grantId: '42' }, entryType: 'Expense', amount: -100 }],
      csrCards: [{ id: '42', company: 'Tata', project: 'P', col: 'live' } as any],
      donors: [],
    });
    expect(r.isReady).toBe(true);
    expect(r.readyLabel).toBe('Ready');
    localStorage.removeItem('goodjobs.grant.42.v1');
  });
});
