import type { Beneficiary, ComplianceDocument, CSRCard } from '../store/useStore';
import type { GrantBudgetHead, JournalExpense } from './grantBudgetHeads';
import { selectGrantUtilisation } from './grantBudgetHeads';
import type { ComplianceGrantLink } from './complianceGrant';
import type { ProgramGrantLink } from './programGrantLink';
import { selectGrantProgramRollups } from './programGrantLink';
import type { BeneficiaryOutcome } from './outcomes';

export interface GrantHealthMetrics {
  budgetUtilisedPct: number;
  budgetLabel: string;
  daysToNextReport: number | null;
  nextReportDue: string | null;
  complianceMissing: number;
  complianceLabel: string;
  beneficiariesReached: number;
  outcomeReadinessPct: number;
  outcomeLabel: string;
}

const REQUIRED_COMPLIANCE_TYPES = ['grant_report'];

function daysUntil(iso: string, now = Date.now()): number | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - now) / 86_400_000);
}

export function computeGrantHealthMetrics(args: {
  grantId: string;
  card?: CSRCard;
  nextReportDue?: string;
  grantBudgetHeads: GrantBudgetHead[];
  journalEntries: JournalExpense[];
  complianceLinks: ComplianceGrantLink[];
  complianceDocs: ComplianceDocument[];
  programGrantLinks: ProgramGrantLink[];
  beneficiaries: { id: string; program: string }[];
  customPrograms: string[];
  beneficiaryOutcomes: BeneficiaryOutcome[];
  now?: number;
}): GrantHealthMetrics {
  const now = args.now ?? Date.now();
  const gid = String(args.grantId);

  const util = selectGrantUtilisation(gid, args.grantBudgetHeads, args.journalEntries);
  const budgetUtilisedPct = util.utilisationPct;
  const budgetLabel =
    util.totalAllocated > 0
      ? `${budgetUtilisedPct}% of ${Math.round(util.totalAllocated).toLocaleString('en-IN')} allocated`
      : 'No budget heads yet';

  const reportDue =
    args.nextReportDue ||
    args.card?.report_due_date ||
    null;
  const daysToNextReport = reportDue ? daysUntil(reportDue, now) : null;

  const docById = new Map(args.complianceDocs.map(d => [d.id, d]));
  const linked = args.complianceLinks
    .filter(l => String(l.grantId) === gid)
    .map(l => docById.get(l.complianceDocId))
    .filter((d): d is ComplianceDocument => !!d);

  const missingCompliance = linked.filter(
    d => d.status === 'Expired' || d.status === 'Expiring Soon' || !d.expiry,
  ).length;
  const hasGrantReport = linked.some(d => d.type === 'grant_report');
  const complianceMissing =
    missingCompliance + (hasGrantReport ? 0 : REQUIRED_COMPLIANCE_TYPES.length);

  const rollups = selectGrantProgramRollups(gid, {
    links: args.programGrantLinks,
    beneficiaries: args.beneficiaries as Beneficiary[],
    customPrograms: args.customPrograms,
    outcomes: args.beneficiaryOutcomes,
    periodDays: 90,
    now,
  });
  const beneficiariesReached = rollups.reduce((s, r) => s + r.beneficiaryCount, 0);
  const outcomeReadinessPct =
    rollups.length === 0
      ? 0
      : Math.round(rollups.reduce((s, r) => s + r.reportReadinessPct, 0) / rollups.length);

  return {
    budgetUtilisedPct,
    budgetLabel,
    daysToNextReport,
    nextReportDue: reportDue,
    complianceMissing,
    complianceLabel:
      complianceMissing === 0
        ? 'Reporting on track'
        : `${complianceMissing} item${complianceMissing > 1 ? 's' : ''} need attention`,
    beneficiariesReached,
    outcomeReadinessPct,
    outcomeLabel:
      rollups.length === 0
        ? 'Link a programme'
        : `${outcomeReadinessPct}% outcome readiness`,
  };
}
