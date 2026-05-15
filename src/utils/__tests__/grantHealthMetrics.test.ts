import { describe, it, expect } from 'vitest';
import { computeGrantHealthMetrics } from '../grantHealthMetrics';

describe('grantHealthMetrics', () => {
  it('computes budget and compliance signals', () => {
    const m = computeGrantHealthMetrics({
      grantId: '1',
      card: { id: 1, company: 'X', amount: 1_000_000, project: 'Health', tags: [], agent: 'A', col: 'live', date: '' },
      nextReportDue: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
      grantBudgetHeads: [
        { id: 'h1', grantId: '1', label: 'Delivery', allocatedAmount: 100, sortOrder: 1 },
      ],
      journalEntries: [
        {
          id: 'e1',
          date: '2026-05-01',
          amount: 40,
          description: 'Spend',
          entryType: 'Expense',
          grantTag: { grantId: '1', budgetHeadId: 'h1' },
        },
      ],
      complianceLinks: [],
      complianceDocs: [],
      programGrantLinks: [],
      beneficiaries: [],
      customPrograms: [],
      beneficiaryOutcomes: [],
    });
    expect(m.budgetUtilisedPct).toBe(40);
    expect(m.daysToNextReport).toBeGreaterThan(0);
    expect(m.complianceMissing).toBeGreaterThan(0);
  });
});
