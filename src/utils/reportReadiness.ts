import type { ReportRecord } from '../data/reportsCatalogue';
import type {
  Beneficiary,
  CSRCard,
  ComplianceDocument,
  Donor,
  Transaction,
} from '../store/useStore';

export interface ReportReadinessItem {
  id: string;
  label: string;
  met: boolean;
  fixLabel: string;
  fixPath: string;
}

export interface ReportReadinessResult {
  items: ReportReadinessItem[];
  missingCount: number;
  isReady: boolean;
  readyLabel: string;
  pct: number;
}

export interface ReportReadinessInput {
  report: ReportRecord;
  beneficiaries: Beneficiary[];
  beneficiaryOutcomes: { programId: string; metricLabel?: string }[];
  transactions: Transaction[];
  journalEntries: { programmeId?: string; grantTag?: { grantId?: string }; amount?: number; entryType?: string }[];
  csrCards: CSRCard[];
  donors: Donor[];
}

function grantIdFromReport(report: ReportRecord): string | null {
  const m = /^rpt-grant-(.+)$/.exec(report.id);
  return m ? m[1] : null;
}

function grantReportingCadenceMet(grantId: string): boolean {
  try {
    const raw = localStorage.getItem(`goodjobs.grant.${grantId}.v1`);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { nextReportDue?: string; deliverables?: unknown[] };
    if (parsed.nextReportDue) return true;
    return Array.isArray(parsed.deliverables) && parsed.deliverables.length > 0;
  } catch {
    return false;
  }
}

/** Readiness checks with deep-links to fix gaps before AI draft. */
export function computeReportReadiness(input: ReportReadinessInput): ReportReadinessResult {
  const { report, beneficiaries, beneficiaryOutcomes, transactions, journalEntries, csrCards, donors } = input;
  const progName = report.programmeName;
  const progId = report.programmeId;
  const grantId = grantIdFromReport(report);
  const grant = grantId ? csrCards.find(c => String(c.id) === String(grantId)) : undefined;

  const progBeneficiaries = progName
    ? beneficiaries.filter(b => b.program === progName)
    : beneficiaries;

  const hasProgrammeData = progBeneficiaries.length > 0;

  const hasOutcomes = progId
    ? beneficiaryOutcomes.some(o => o.programId === progId)
    : beneficiaryOutcomes.length > 0;

  const progFinance = progId
    ? journalEntries.filter(e => e.programmeId === progId)
    : journalEntries;
  const taggedFinance = progFinance.filter(e => e.grantTag?.grantId || e.programmeId);
  const expenseRows = progFinance.filter(e => e.entryType === 'Expense' || Number(e.amount) < 0);
  const untaggedExpenses = expenseRows.filter(e => !e.grantTag?.grantId);
  const financeMet =
    taggedFinance.length > 0 &&
    (untaggedExpenses.length === 0 || expenseRows.length === 0);

  const grantMetaMet =
    report.type !== 'funder'
      ? true
      : !!(grant || report.funder || grantId);

  const cadenceMet =
    report.type !== 'funder'
      ? true
      : grantId
        ? grantReportingCadenceMet(grantId)
        : !!report.date;

  const donorContextMet =
    report.type !== 'donor'
      ? true
      : donors.length > 0 || !!report.funder;

  const grantPath = grantId ? `/grants/${encodeURIComponent(grantId)}` : '/funding';

  const items: ReportReadinessItem[] = [
    {
      id: 'programme',
      label: 'Programme data available',
      met: hasProgrammeData,
      fixLabel: 'Add beneficiaries',
      fixPath: progName ? `/programs?program=${encodeURIComponent(progName)}` : '/programs?action=enroll',
    },
    {
      id: 'outcomes',
      label: 'Programme outcomes recorded',
      met: hasOutcomes,
      fixLabel: 'Record outcomes in MIS',
      fixPath: '/programs?tab=mis',
    },
    {
      id: 'finance',
      label: 'Expense tagging complete',
      met: financeMet,
      fixLabel: 'Classify transactions',
      fixPath: '/finance?view=exceptions',
    },
    {
      id: 'grant_meta',
      label: 'Grant metadata present',
      met: grantMetaMet,
      fixLabel: 'Open grant workspace',
      fixPath: grantPath,
    },
    {
      id: 'cadence',
      label: 'Reporting cadence set',
      met: cadenceMet,
      fixLabel: 'Set report schedule',
      fixPath: grantPath,
    },
    {
      id: 'donor',
      label: 'Donor / funder context present',
      met: donorContextMet,
      fixLabel: 'Open CRM donors',
      fixPath: '/crm',
    },
  ];

  const relevant =
    report.type === 'funder'
      ? items.filter(i => !['donor'].includes(i.id))
      : report.type === 'donor'
        ? items.filter(i => !['cadence', 'grant_meta'].includes(i.id))
        : items.filter(i => ['programme', 'outcomes', 'finance'].includes(i.id));

  const missingCount = relevant.filter(i => !i.met).length;
  const metCount = relevant.filter(i => i.met).length;
  const pct = relevant.length ? Math.round((metCount / relevant.length) * 100) : 0;
  const isReady = missingCount === 0;

  return {
    items: relevant,
    missingCount,
    isReady,
    readyLabel: isReady ? 'Ready' : `Missing ${missingCount} item${missingCount === 1 ? '' : 's'}`,
    pct,
  };
}

export type DraftSectionId =
  | 'executive'
  | 'beneficiaries'
  | 'outcomes'
  | 'financials'
  | 'toc'
  | 'donor';

export interface DraftSectionSource {
  id: DraftSectionId;
  title: string;
  sourceLabel: string;
  sourcePath?: string;
}

export function draftSectionSources(report: ReportRecord, input: ReportReadinessInput): DraftSectionSource[] {
  const grantId = grantIdFromReport(report);
  const grantPath = grantId ? `/grants/${encodeURIComponent(grantId)}` : undefined;
  const prog = report.programmeName;
  const all: DraftSectionSource[] = [
    { id: 'executive', title: 'Executive summary', sourceLabel: 'Programme + NGO profile', sourcePath: '/settings' },
    { id: 'beneficiaries', title: 'Beneficiary reach', sourceLabel: 'Programs MIS', sourcePath: prog ? `/programs?program=${encodeURIComponent(prog)}` : '/programs' },
    { id: 'outcomes', title: 'Outcomes vs targets', sourceLabel: 'MIS outcomes', sourcePath: '/programs?tab=mis' },
    { id: 'financials', title: 'Financial summary', sourceLabel: 'Finance journal', sourcePath: '/finance' },
    { id: 'toc', title: 'Theory of change', sourceLabel: 'Programs ToC', sourcePath: '/programs?tab=toc' },
    { id: 'donor', title: 'Donor stewardship', sourceLabel: 'CRM donors', sourcePath: '/crm' },
  ];
  if (report.type === 'donor') return all;
  return all.filter(s => s.id !== 'donor');
}

export function reportReadinessTaskIntent(reportId: string, itemId: string): string {
  return `report-readiness:${reportId}:${itemId}`;
}
