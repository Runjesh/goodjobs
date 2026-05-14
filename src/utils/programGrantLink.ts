import type { ProgramBudget } from './programFinance';
import { budgetUtilization, programIdFromName } from './programFinance';
import type { GrantTranche } from './grantLifecycle';
import type { ComplianceGrantLink } from './complianceGrant';
import type { ComplianceDocument, Beneficiary } from '../store/useStore';
import type { BeneficiaryOutcome } from './outcomes';

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
    const duMs = new Date(nextReportDue).getTime();
    if (Number.isFinite(duMs)) {
      const days = Math.ceil((duMs - now) / 86_400_000);
      if (days < 0) status = 'overdue';
      else if (days <= 14) status = 'at_risk';
    }
  }

  for (const d of linkedDocs) {
    const exMs = new Date(d.expiry).getTime();
    const days = Number.isFinite(exMs) ? Math.ceil((exMs - now) / 86_400_000) : Infinity;
    if (d.status === 'Expired' || days < 0) {
      status = 'overdue';
    } else if ((d.status === 'Expiring Soon' || days <= 30) && status === 'healthy') {
      status = 'at_risk';
    }
  }

  if (overspent && status !== 'overdue') status = 'at_risk';

  return { utilisationPct, nextReportDue, status };
}

/** One row of "what does this grant fund?" — used by both the grant detail
 *  Programs panel and the CSR Kanban card summary. */
export interface GrantProgramRollup {
  programId: string;
  programLabel: string;
  beneficiaryCount: number;
  /** Service-log count over the lookback window (0 if outcomes not provided). */
  serviceLogCount: number;
  /** % of linked beneficiaries with at least one outcome in window
   *  (0 when no outcomes data is provided or no beneficiaries exist). */
  reportReadinessPct: number;
  /** Pass-through from ProgramGrantLink so callers can render badges. */
  role?: string;
  /** The originating link id (handy for keys / unlink actions). */
  linkId: string;
}

interface RollupInputs {
  links: ProgramGrantLink[];
  beneficiaries: Beneficiary[];
  customPrograms?: string[];
  outcomes?: BeneficiaryOutcome[];
  /** Lookback window for service-log + report-readiness math. */
  periodDays?: number;
  now?: number;
}

/**
 * Returns one rollup row per programme this grant funds, with live
 * beneficiary count and (optionally) service-log count + report-readiness
 * scored over `periodDays`. Pure / memo-friendly — callers wrap in useMemo.
 */
export function selectGrantProgramRollups(
  grantId: string,
  inp: RollupInputs,
): GrantProgramRollup[] {
  const periodDays = inp.periodDays ?? 90;
  const now        = inp.now ?? Date.now();
  const cutoff     = now - periodDays * 86_400_000;
  const customPrograms = inp.customPrograms ?? [];
  const outcomes       = inp.outcomes ?? [];

  const myLinks = selectProgramsForGrant(inp.links, grantId);

  return myLinks.map(l => {
    const labelFromBens =
      inp.beneficiaries.find(b => programIdFromName(b.program || '') === l.programId)?.program;
    const labelFromCustom =
      customPrograms.find(c => programIdFromName(c) === l.programId);
    const programLabel = labelFromBens || labelFromCustom || l.programId;

    const programBens = inp.beneficiaries.filter(
      b => programIdFromName(b.program || '') === l.programId,
    );
    const benIds = new Set(programBens.map(b => b.id));

    const periodOutcomes = outcomes.filter(o => {
      if (o.programId !== l.programId) return false;
      const t = new Date(o.measuredAt).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });

    const measuredBenIds = new Set(
      periodOutcomes.map(o => o.beneficiaryId).filter(id => benIds.has(id)),
    );
    const reportReadinessPct = programBens.length === 0
      ? 0
      : Math.round((measuredBenIds.size / programBens.length) * 100);

    return {
      programId: l.programId,
      programLabel,
      beneficiaryCount: programBens.length,
      serviceLogCount: periodOutcomes.length,
      reportReadinessPct,
      role: l.role,
      linkId: l.id,
    };
  });
}

/** Quick aggregate for a glance line ("funds N programmes · M beneficiaries"). */
export function summariseGrantFunding(rollups: GrantProgramRollup[]) {
  return {
    programCount: rollups.length,
    beneficiaryTotal: rollups.reduce((s, r) => s + r.beneficiaryCount, 0),
  };
}
