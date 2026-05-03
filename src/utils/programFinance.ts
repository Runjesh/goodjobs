export interface ProgramBudget {
  /** Stable id of the program (we use the program name slug for now). */
  programId: string;
  /** Display label — same as program name. */
  label: string;
  /** Planned budget in INR. */
  planned: number;
  /** Actual spend recorded so far in INR. */
  spent: number;
  /** Optional grant id this budget is funded by — drives "restricted" alerts. */
  grantId?: string;
  /** ISO date the current tranche window closes. */
  windowEnd?: string;
  /** Whether the funding source is restricted (must be spent on this program). */
  restricted?: boolean;
}

export type BudgetHealth = 'on_track' | 'underspending' | 'overspending' | 'no_budget';

export function programIdFromName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * Health classification.
 *  - overspending: spent > 100% of planned
 *  - underspending: <70% spent and we're past 60% of the tranche window
 *  - on_track: otherwise
 */
export function classifyBudget(b: ProgramBudget, now = Date.now()): BudgetHealth {
  if (!b.planned || b.planned <= 0) return 'no_budget';
  const ratio = b.spent / b.planned;
  if (ratio > 1) return 'overspending';

  if (b.windowEnd && b.restricted) {
    const end = new Date(b.windowEnd).getTime();
    // assume window started ~90 days before end if not otherwise known
    const start = end - 90 * 86_400_000;
    if (end > start) {
      const elapsed = (now - start) / (end - start);
      if (elapsed > 0.6 && ratio < 0.7) return 'underspending';
    }
  }
  return 'on_track';
}

export function budgetUtilization(b: ProgramBudget): number {
  if (!b.planned || b.planned <= 0) return 0;
  return Math.min(1, b.spent / b.planned);
}

export function formatINR(n: number): string {
  if (!Number.isFinite(n)) return '₹0';
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000)    return `₹${(n / 100_000).toFixed(1)}L`;
  if (n >= 1000)       return `₹${(n / 1000).toFixed(0)}k`;
  return `₹${n.toLocaleString('en-IN')}`;
}
