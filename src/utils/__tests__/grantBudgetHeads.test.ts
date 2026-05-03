import { describe, it, expect } from 'vitest';
import {
  selectGrantUtilisation,
  budgetSanity,
  type GrantBudgetHead,
  type GrantTag,
} from '../grantBudgetHeads';

const heads: GrantBudgetHead[] = [
  { id: 'h1', grantId: '3', label: 'Programme delivery', allocatedAmount: 600_000, sortOrder: 1 },
  { id: 'h2', grantId: '3', label: 'M&E + reporting',     allocatedAmount: 100_000, sortOrder: 2 },
  { id: 'h3', grantId: '3', label: 'Admin (cap 15%)',     allocatedAmount: 150_000, sortOrder: 3 },
  { id: 'hX', grantId: '2', label: 'Other grant head',    allocatedAmount: 999_999, sortOrder: 1 },
];

describe('selectGrantUtilisation', () => {
  it('sums tagged transactions per head, ignores untagged + other-grant tx', () => {
    const tx = [
      { id: 't1', amount: 100_000 }, // tagged → h1
      { id: 't2', amount: 50_000 },  // tagged → h2
      { id: 't3', amount: 75_000 },  // untagged → ignored
      { id: 't4', amount: 80_000 },  // tagged → other grant '2', ignored for grant '3'
      { id: 't5', amount: 25_000 },  // tagged → grant '3' but removed head 'h-gone' → orphan
    ];
    const tags: Record<string, GrantTag> = {
      t1: { grantId: '3', budgetHeadId: 'h1' },
      t2: { grantId: '3', budgetHeadId: 'h2' },
      t4: { grantId: '2', budgetHeadId: 'hX' },
      t5: { grantId: '3', budgetHeadId: 'h-gone' },
    };
    const u = selectGrantUtilisation('3', heads, tx, tags);
    const byId = Object.fromEntries(u.rows.map(r => [r.headId, r]));
    expect(byId.h1.spent).toBe(100_000);
    expect(byId.h1.remaining).toBe(500_000);
    expect(byId.h1.utilisationPct).toBe(17);
    expect(byId.h2.spent).toBe(50_000);
    expect(byId.h3.spent).toBe(0);
    expect(u.orphanSpent).toBe(25_000);
    expect(u.totalAllocated).toBe(850_000);
    expect(u.totalSpent).toBe(175_000); // 100k + 50k + 25k orphan
    expect(u.totalRemaining).toBe(675_000);
    expect(u.utilisationPct).toBe(21);
  });

  it('returns zero rows + zero totals for a grant with no heads', () => {
    const u = selectGrantUtilisation('999', heads, [], {});
    expect(u.rows).toEqual([]);
    expect(u.totalAllocated).toBe(0);
    expect(u.utilisationPct).toBe(0);
    expect(u.orphanSpent).toBe(0);
  });

  it('matches grantId regardless of string/number type', () => {
    const tx = [{ id: 9, amount: 1000 }];
    const tags: Record<string, GrantTag> = { '9': { grantId: '3', budgetHeadId: 'h1' } };
    const u = selectGrantUtilisation('3', heads, tx, tags);
    expect(u.totalSpent).toBe(1000);
  });

  it('treats negative tx amounts as positive spend (refund accounting comes later)', () => {
    const u = selectGrantUtilisation(
      '3', heads,
      [{ id: 'tA', amount: -5_000 }],
      { tA: { grantId: '3', budgetHeadId: 'h1' } },
    );
    expect(u.rows.find(r => r.headId === 'h1')!.spent).toBe(5_000);
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
