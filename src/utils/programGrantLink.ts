import type { ProgramBudget } from './programFinance';
import { budgetUtilization } from './programFinance';
import type { GrantTranche } from './grantLifecycle';
import type { ComplianceGrantLink } from './complianceGrant';
import type { ComplianceDocument } from '../store/useStore';

/**
 * Explicit edge between a programme (slugified id) and a grant (CSR card id).
 *
 * Replaces the implicit, single-edge link that lived on `ProgramBudget.grantId`
 * with a many-to-many table so a programme can be co-funded by multiple grants
 * and a grant can fund multiple programmes — the bidirectional relationship
 * the audit asked for.
 */
export interface ProgramGrantLink {
  id: string;
  /** Slugified program id (use programIdFromName when creating). */
  programId: string;
  /** CSRCard id (string or number stringified). */
  grantId: string;
  /** Optional % of the grant earmarked for this programme. */
  allocationPct?: number;
  /** Role on this programme — 'primary' funder, 'co-funder', etc. */
  role?: 'primary' | 'co-funder' | string;
  createdAt?: string;
}

export type GrantHealthStatus = 'healthy' | 'at_risk' | 'overdue';

export interface GrantHealth {
  /** 0–100, capped at 100 in the underlying util but we surface the raw % too. */
  utilisationPct: number;
  /** ISO date of the next non-released tranche, or null if none. */
  nextReportDue: string | null;
  status: GrantHealthStatus;
}

export function selectGrantsForProgram(
  links: ProgramGrantLink[],
  programId: string,
): ProgramGrantLink[] {
  return links.filter(l => l.programId === programId);
}

export function selectProgramsForGrant(
  links: ProgramGrantLink[],
  grantId: string,
): ProgramGrantLink[] {
  return links.filter(l => String(l.grantId) === String(grantId));
}

interface HealthInputs {
  budgets: ProgramBudget[];
  tranches: GrantTranche[];
  complianceLinks: ComplianceGrantLink[];
  docs: ComplianceDocument[];
  now?: number;
}

/**
 * Combines the three Session-1/2 signals into a single triple a panel row can
 * render in one line:
 *   - utilisationPct  ← programBudgets.spent / planned
 *   - nextReportDue   ← earliest non-released grantTranche
 *   - status band     ← compliance + tranche due-date + overspend rules
 */
export function grantHealthForProgram(
  programId: string,
  grantId: string,
  inp: HealthInputs,
): GrantHealth {
  const now = inp.now ?? Date.now();

  // Prefer a budget that's explicitly tagged with this grantId; otherwise fall
  // back to any budget for this programme so we still show *something*.
  const budget =
    inp.budgets.find(b => b.programId === programId && String(b.grantId ?? '') === String(grantId))
    || inp.budgets.find(b => b.programId === programId);
  const utilisationPct = budget ? Math.round(budgetUtilization(budget) * 100) : 0;
  const overspent = budget ? budget.spent > budget.planned && budget.planned > 0 : false;

  const upcoming = inp.tranches
    .filter(t => String(t.grantId) === String(grantId) && t.status !== 'released')
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  const nextReportDue = upcoming[0]?.expectedDate ?? null;

  const docById = new Map(inp.docs.map(d => [d.id, d]));
  const linkedDocs = inp.complianceLinks
    .filter(l => String(l.grantId) === String(grantId))
    .map(l => docById.get(l.complianceDocId))
    .filter((d): d is ComplianceDocument => !!d);

  let status: GrantHealthStatus = 'healthy';

  if (nextReportDue) {
    const days = Math.ceil((new Date(nextReportDue).getTime() - now) / 86_400_000);
    if (days < 0) status = 'overdue';
    else if (days <= 14) status = 'at_risk';
  }

  for (const d of linkedDocs) {
    const days = Math.ceil((new Date(d.expiry).getTime() - now) / 86_400_000);
    if (d.status === 'Expired' || days < 0) {
      status = 'overdue';
    } else if ((d.status === 'Expiring Soon' || days <= 30) && status === 'healthy') {
      status = 'at_risk';
    }
  }

  if (overspent && status !== 'overdue') status = 'at_risk';

  return { utilisationPct, nextReportDue, status };
}
