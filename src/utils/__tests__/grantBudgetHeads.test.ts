import { describe, it, expect } from 'vitest';
import {
  selectGrantUtilisation,
  budgetSanity,
  type GrantBudgetHead,
  type JournalExpense,
} from '../grantBudgetHeads';

const heads: GrantBudgetHead[] = [
  { id: 'h1', grantId: '3', label: 'Programme delivery', allocatedAmount: 600_000, sortOrder: 1 },
  { id: 'h2', grantId: '3', label: 'M&E + reporting',     allocatedAmount: 100_000, sortOrder: 2 },
  { id: 'h3', grantId: '3', label: 'Admin (cap 15%)',     allocatedAmount: 150_000, sortOrder: 3 },
  { id: 'hX', grantId: '2', label: 'Other grant head',    allocatedAmount: 999_999, sortOrder: 1 },
];

const exp = (
  id: string,
  amount: number,
  tag?: { grantId: string; budgetHeadId: string },
  entryType: JournalExpense['entryType'] = 'Expense',
): JournalExpense => ({
  id, amount, entryType, date: '2026-01-01', description: id,
  grantTag: tag,
});

describe('selectGrantUtilisation', () => {
  it('sums tagged expenses per head, ignores untagged + other-grant + non-expense', () => {
    const expenses: JournalExpense[] = [
      exp('e1', 100_000, { grantId: '3', budgetHeadId: 'h1' }),
      exp('e2',  50_000, { grantId: '3', budgetHeadId: 'h2' }),
      exp('e3',  75_000), // untagged → ignored
      exp('e4',  80_000, { grantId: '2', budgetHeadId: 'hX' }), // other grant
      exp('e5',  25_000, { grantId: '3', budgetHeadId: 'h-gone' }), // orphan
      exp('e6', 999_999, { grantId: '3', budgetHeadId: 'h1' }, 'Income'),    // not an expense
      exp('e7', 999_999, { grantId: '3', budgetHeadId: 'h1' }, 'Transfer'),  // not an expense
    ];
    const u = selectGrantUtilisation('3', heads, expenses);
    const byId = Object.fromEntries(u.rows.map(r => [r.headId, r]));
    expect(byId.h1.spent).toBe(100_000);
    expect(byId.h1.remaining).toBe(500_000);
    expect(byId.h1.utilisationPct).toBe(17);
    expect(byId.h2.spent).toBe(50_000);
    expect(byId.h3.spent).toBe(0);
    expect(u.orphanSpent).toBe(25_000);
    expect(u.totalAllocated).toBe(850_000);
    expect(u.totalSpent).toBe(175_000);
    expect(u.totalRemaining).toBe(675_000);
    expect(u.utilisationPct).toBe(21);
  });

  it('returns zero rows for a grant with no heads', () => {
    const u = selectGrantUtilisation('999', heads, []);
    expect(u.rows).toEqual([]);
    expect(u.totalAllocated).toBe(0);
    expect(u.utilisationPct).toBe(0);
    expect(u.orphanSpent).toBe(0);
  });

  it('matches grantId regardless of string/number type via String() coercion', () => {
    const expenses: JournalExpense[] = [
      exp('e1', 1000, { grantId: '3', budgetHeadId: 'h1' }),
    ];
    const u = selectGrantUtilisation('3', heads, expenses);
    expect(u.totalSpent).toBe(1000);
  });

  it('treats negative amounts as positive spend (refund accounting comes later)', () => {
    const u = selectGrantUtilisation(
      '3', heads,
      [exp('eA', -5_000, { grantId: '3', budgetHeadId: 'h1' })],
    );
    expect(u.rows.find(r => r.headId === 'h1')!.spent).toBe(5_000);
  });

  it('ignores Income entries even when tagged to a grant head', () => {
    const expenses: JournalExpense[] = [
      exp('inc', 9_999_999, { grantId: '3', budgetHeadId: 'h1' }, 'Income'),
    ];
    const u = selectGrantUtilisation('3', heads, expenses);
    expect(u.totalSpent).toBe(0);
    expect(u.rows.find(r => r.headId === 'h1')!.spent).toBe(0);
  });
});

describe('budgetSanity', () => {
  it('flags under-allocation and reports the gap', () => {
    const s = budgetSanity(1_000_000, [
      { id: 'a', grantId: '3', label: 'A', allocatedAmount: 600_000 },
      { id: 'b', grantId: '3', label: 'B', allocatedAmount: 200_000 },
    ]);
    expect(s.status).toBe('under');
    expect(s.unallocated).toBe(200_000);
    expect(s.overAllocated).toBe(0);
  });

  it('flags fully-allocated when totals tie', () => {
    const s = budgetSanity(500_000, [
      { id: 'a', grantId: '3', label: 'A', allocatedAmount: 500_000 },
    ]);
    expect(s.status).toBe('fully_allocated');
    expect(s.unallocated).toBe(0);
  });

  it('flags over-allocation and reports the overage', () => {
    const s = budgetSanity(500_000, [
      { id: 'a', grantId: '3', label: 'A', allocatedAmount: 400_000 },
      { id: 'b', grantId: '3', label: 'B', allocatedAmount: 200_000 },
    ]);
    expect(s.status).toBe('over');
    expect(s.overAllocated).toBe(100_000);
    expect(s.unallocated).toBe(0);
  });

  it('handles missing/zero grant total gracefully', () => {
    const s = budgetSanity(0, [
      { id: 'a', grantId: '3', label: 'A', allocatedAmount: 100_000 },
    ]);
    expect(s.status).toBe('over');
    expect(s.overAllocated).toBe(100_000);
  });

  it('returns no_grant_total when nothing is set up at all', () => {
    const s = budgetSanity(0, []);
    expect(s.status).toBe('no_grant_total');
  });
});
