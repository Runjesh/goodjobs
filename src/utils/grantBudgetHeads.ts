/**
 * Grant budget heads (Session 4 / Audit P0 #3).
 *
 * Each grant has a list of budget heads (Programme delivery, M&E, Admin, etc.)
 * with an allocated amount. Finance JOURNAL EXPENSES (booked outflows, not
 * donor receipts) can be tagged to a `(grantId, budgetHeadId)` pair so
 * utilisation per head is real, not mocked.
 *
 * The selector here turns three inputs (the grant's heads, every booked
 * journal expense, and an optional override `expenseId → tag` map for
 * pre-tag-on-entity backwards compatibility) into a row-per-head
 * utilisation breakdown the GrantDetail screen renders directly.
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

/**
 * A booked finance expense — the source-of-truth for utilisation math.
 * Receipts/incoming donor transactions are NOT included here.
 */
export interface JournalExpense {
  id: string;
  date: string;
  amount: number;
  description: string;
  fund?: string;
  /** Only `Expense` rows count toward utilisation; other types are ignored. */
  entryType: 'Expense' | 'Income' | 'Transfer';
  /** Where this expense lands in a grant's budget. */
  grantTag?: GrantTag;
  /**
   * Cross-module join: direct grant association independent of `grantTag`.
   * Set whenever the user picks a grant, even without picking a budget head.
   * Enables grant utilisation queries without requiring a budget head to exist.
   */
  grantId?: string;
  /**
   * Cross-module join: which programme this income/expense belongs to.
   * Drives live budget-vs-actuals in ProgramBudgetBar and report data pulls.
   */
  programmeId?: string;
  /**
   * Cross-module join: which CRM donor this income came from.
   * Enables giving-history tab on the donor profile and 80G auto-fill.
   */
  donorId?: string;
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

/**
 * Sums tagged JOURNAL EXPENSES per budget head. Only `entryType === 'Expense'`
 * rows count — incomes/transfers are ignored even if tagged.
 *
 *  - Untagged expenses are ignored.
 *  - Expenses tagged to other grants are ignored.
 *  - Expenses tagged to a removed head are bucketed into `orphanSpent` so
 *    the number doesn't silently disappear from the grant total.
 */
export function selectGrantUtilisation(
  grantId: string,
  heads: GrantBudgetHead[],
  expenses: JournalExpense[],
): GrantUtilisation {
  const myHeads = heads
    .filter(h => String(h.grantId) === String(grantId))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const headIds = new Set(myHeads.map(h => h.id));
  const spentByHead = new Map<string, number>();
  let orphanSpent = 0;

  for (const e of expenses) {
    if (e.entryType !== 'Expense') continue;
    const amt = Math.abs(Number(e.amount) || 0);

    const tag = e.grantTag;
    if (tag && String(tag.grantId) === String(grantId)) {
      // Fully-tagged expense: has both grantId + budgetHeadId via grantTag.
      if (headIds.has(tag.budgetHeadId)) {
        spentByHead.set(tag.budgetHeadId, (spentByHead.get(tag.budgetHeadId) || 0) + amt);
      } else {
        orphanSpent += amt;
      }
    } else if (!tag && e.grantId && String(e.grantId) === String(grantId)) {
      // Partially-tagged expense: only the top-level grantId is set (no
      // budget head selected). Count as orphan spend so the total is still
      // accurate even when the user skips the budget-head step.
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
