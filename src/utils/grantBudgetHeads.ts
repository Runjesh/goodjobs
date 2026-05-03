/**
 * Grant budget heads (Session 4 / Audit P0 #3).
 *
 * Each grant has a list of budget heads (Programme delivery, M&E, Admin, etc.)
 * with an allocated amount. Finance transactions can be tagged to a
 * `(grantId, budgetHeadId)` pair so utilisation per head is real, not mocked.
 *
 * The selector here turns three inputs (the grant's heads, every transaction,
 * and a `txId → tag` map) into a row-per-head utilisation breakdown the
 * GrantDetail screen renders directly.
 */

export interface GrantBudgetHead {
  id: string;
  /** CSR card id (string or number stringified). */
  grantId: string;
  label: string;
  allocatedAmount: number;
  sortOrder?: number;
  notes?: string;
}

export interface GrantTag {
  grantId: string;
  budgetHeadId: string;
}

export interface BudgetHeadUtilisation {
  headId: string;
  label: string;
  allocated: number;
  spent: number;
  remaining: number;
  /** 0–100, can exceed 100 when overspent. */
  utilisationPct: number;
}

export interface GrantUtilisation {
  rows: BudgetHeadUtilisation[];
  totalAllocated: number;
  totalSpent: number;
  totalRemaining: number;
  /** 0–100, can exceed 100. */
  utilisationPct: number;
  /** Spend tagged to this grant but to a head that's been removed (or never existed). */
  orphanSpent: number;
}

interface TxLite {
  id: string | number;
  amount: number;
}

/**
 * Sums tagged transactions per budget head and returns a render-ready breakdown.
 *  - Untagged transactions are ignored.
 *  - Transactions tagged to other grants are ignored.
 *  - Transactions tagged to a removed head are bucketed into `orphanSpent` so
 *    the number doesn't silently disappear from the grant total.
 */
export function selectGrantUtilisation(
  grantId: string,
  heads: GrantBudgetHead[],
  transactions: TxLite[],
  tagsById: Record<string, GrantTag>,
): GrantUtilisation {
  const myHeads = heads
    .filter(h => String(h.grantId) === String(grantId))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const headIds = new Set(myHeads.map(h => h.id));
  const spentByHead = new Map<string, number>();
  let orphanSpent = 0;

  for (const t of transactions) {
    const tag = tagsById[String(t.id)];
    if (!tag) continue;
    if (String(tag.grantId) !== String(grantId)) continue;
    const amt = Math.abs(Number(t.amount) || 0);
    if (headIds.has(tag.budgetHeadId)) {
      spentByHead.set(tag.budgetHeadId, (spentByHead.get(tag.budgetHeadId) || 0) + amt);
    } else {
      orphanSpent += amt;
    }
  }

  const rows: BudgetHeadUtilisation[] = myHeads.map(h => {
    const spent = spentByHead.get(h.id) || 0;
    const allocated = Number(h.allocatedAmount) || 0;
    return {
      headId: h.id,
      label: h.label,
      allocated,
      spent,
      remaining: allocated - spent,
      utilisationPct: allocated > 0 ? Math.round((spent / allocated) * 100) : 0,
    };
  });

  const totalAllocated = rows.reduce((s, r) => s + r.allocated, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0) + orphanSpent;
  const totalRemaining = totalAllocated - totalSpent;
  const utilisationPct = totalAllocated > 0 ? Math.round((totalSpent / totalAllocated) * 100) : 0;

  return { rows, totalAllocated, totalSpent, totalRemaining, utilisationPct, orphanSpent };
}

export type BudgetSanityStatus = 'under' | 'fully_allocated' | 'over' | 'no_grant_total';

export interface BudgetSanity {
  grantTotal: number;
  totalAllocated: number;
  unallocated: number;
  overAllocated: number;
  status: BudgetSanityStatus;
}

/**
 * "₹4.2L allocated of ₹5L grant — ₹0.8L unallocated" type sanity check.
 * Surfaces over-allocation as a separate field so the UI can warn loudly.
 */
export function budgetSanity(grantTotal: number, heads: GrantBudgetHead[]): BudgetSanity {
  const totalAllocated = heads.reduce((s, h) => s + (Number(h.allocatedAmount) || 0), 0);
  if (!Number.isFinite(grantTotal) || grantTotal <= 0) {
    return {
      grantTotal: 0,
      totalAllocated,
      unallocated: 0,
      overAllocated: totalAllocated,
      status: totalAllocated > 0 ? 'over' : 'no_grant_total',
    };
  }
  if (totalAllocated > grantTotal) {
    return {
      grantTotal,
      totalAllocated,
      unallocated: 0,
      overAllocated: totalAllocated - grantTotal,
      status: 'over',
    };
  }
  if (totalAllocated === grantTotal) {
    return { grantTotal, totalAllocated, unallocated: 0, overAllocated: 0, status: 'fully_allocated' };
  }
  return {
    grantTotal,
    totalAllocated,
    unallocated: grantTotal - totalAllocated,
    overAllocated: 0,
    status: 'under',
  };
}
