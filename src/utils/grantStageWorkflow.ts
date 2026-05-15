import { apiFetch } from '../api/client';
import type { ReportRecord } from '../data/reportsCatalogue';
import type { CSRCard, ComplianceDocument } from '../store/useStore';
import type { GrantBudgetHead } from './grantBudgetHeads';
import type { GrantTranche } from './grantLifecycle';
import type { ProgramGrantLink } from './programGrantLink';
import type { ComplianceGrantLink } from './complianceGrant';
import type { Task } from './tasks';
import { programIdFromName } from './programFinance';
import { emitAppRefresh } from './events';

export type CsrPipelineCol = 'prospecting' | 'pitch' | 'diligence' | 'mou' | 'live' | 'closed';

const TRANSITION_KEYS: Record<string, string> = {
  'prospecting→pitch': 'prospecting→pitch',
  'pitch→diligence': 'pitch→diligence',
  'diligence→mou': 'diligence→mou',
  'mou→live': 'mou→live',
};

export function transitionKey(fromCol: string, toCol: string): string | null {
  return TRANSITION_KEYS[`${fromCol}→${toCol}`] ?? null;
}

export interface GrantStageWorkflowDeps {
  upsertTask: (t: Task) => void;
  addComplianceDoc: (doc: Omit<ComplianceDocument, 'uploadedAt'> & { id?: string }) => void;
  addComplianceGrantLink: (link: ComplianceGrantLink) => void;
  upsertGrantBudgetHead: (h: GrantBudgetHead) => void;
  addProgramGrantLink: (link: ProgramGrantLink) => void;
  upsertGrantReport: (r: ReportRecord) => void;
  updateCSRCard: (id: number | string, data: Partial<CSRCard>) => void;
  grantTranches: GrantTranche[];
  programGrantLinks: ProgramGrantLink[];
  complianceGrantLinks: ComplianceGrantLink[];
  complianceDocs: ComplianceDocument[];
  grantBudgetHeads: GrantBudgetHead[];
  beneficiaries: { program: string }[];
  customPrograms: string[];
}

export interface GrantStageTransitionResult {
  transition: string;
  tasksCreated: number;
  liveBundleApplied?: boolean;
  reportStubId?: string;
}

const DILIGENCE_CHECKLIST = [
  'Audited financial statements (last 2 years)',
  'Board resolution authorising partnership',
  'FCRA / CSR-1 registration copies',
  'MoU draft aligned to Schedule VII',
  'PAN and 80G certificates',
];

function defaultBudgetHeads(grantId: string, amount: number): GrantBudgetHead[] {
  const splits = [
    { label: 'Programme delivery', pct: 0.6, order: 1 },
    { label: 'M&E + reporting', pct: 0.1, order: 2 },
    { label: 'Capacity building', pct: 0.15, order: 3 },
    { label: 'Admin (cap 15%)', pct: 0.15, order: 4 },
  ];
  return splits.map((s, i) => ({
    id: `gbh-${grantId}-${i}`,
    grantId: String(grantId),
    label: s.label,
    allocatedAmount: Math.round(amount * s.pct),
    sortOrder: s.order,
  }));
}

function resolveProgramLabel(card: CSRCard, beneficiaries: { program: string }[], customPrograms: string[]): string | null {
  const project = (card.project || '').trim();
  if (!project) return null;
  const pid = programIdFromName(project);
  const known =
    beneficiaries.some(b => programIdFromName(b.program || '') === pid) ||
    customPrograms.some(c => programIdFromName(c) === pid);
  return known ? project : project;
}

async function ensureFinanceGrantRecord(card: CSRCard): Promise<void> {
  try {
    await apiFetch('/finance/grants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: String(card.id),
        name: card.project || card.company,
        total: Number(card.amount) || 0,
        spent: 0,
        status: 'On Track',
        company: card.company,
      }),
    });
  } catch { /* CSR card id remains canonical grant id */ }
}

function applyProspectingToPitch(card: CSRCard, deps: GrantStageWorkflowDeps, now: Date): number {
  const gid = String(card.id);
  deps.upsertTask({
    id: `grant-proposal:${gid}`,
    title: `Draft proposal — ${card.company}`,
    description: `Prepare a tailored proposal for "${card.project || card.company}" before the pitch meeting.`,
    priority: 'high',
    status: 'open',
    sourceType: 'agent',
    sourceAgent: 'Grant workflow',
    sourceIntentId: `grant-proposal:${gid}`,
    relatedEntityType: 'grant',
    relatedEntityId: gid,
    dueAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    meta: { link: `/grants/${encodeURIComponent(gid)}` },
  });
  return 1;
}

function applyPitchToDiligence(card: CSRCard, deps: GrantStageWorkflowDeps, now: Date): number {
  const gid = String(card.id);
  deps.upsertTask({
    id: `grant-diligence-docs:${gid}`,
    title: `Document checklist — ${card.company}`,
    description: 'Collect diligence documents before MoU execution.',
    priority: 'high',
    status: 'open',
    sourceType: 'agent',
    sourceAgent: 'Grant workflow',
    sourceIntentId: `grant-diligence-docs:${gid}`,
    relatedEntityType: 'grant',
    relatedEntityId: gid,
    dueAt: new Date(now.getTime() + 10 * 86_400_000).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    meta: {
      link: `/grants/${encodeURIComponent(gid)}`,
      checklist: DILIGENCE_CHECKLIST,
    },
  });
  return 1;
}

function applyDiligenceToMou(card: CSRCard, deps: GrantStageWorkflowDeps, now: Date): number {
  const gid = String(card.id);
  deps.upsertTask({
    id: `grant-mou-signoff:${gid}`,
    title: `MoU review & sign-off — ${card.company}`,
    description: 'Legal and ED review before MoU is executed and the grant goes live.',
    priority: 'urgent',
    status: 'open',
    sourceType: 'agent',
    sourceAgent: 'Grant workflow',
    sourceIntentId: `grant-mou-signoff:${gid}`,
    relatedEntityType: 'grant',
    relatedEntityId: gid,
    dueAt: new Date(now.getTime() + 5 * 86_400_000).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    meta: { link: `/grants/${encodeURIComponent(gid)}` },
  });
  return 1;
}

function applyMouToLive(
  card: CSRCard,
  deps: GrantStageWorkflowDeps,
  now: Date,
): { tasks: number; reportStubId?: string } {
  const gid = String(card.id);
  let tasks = 0;

  void ensureFinanceGrantRecord(card);

  const programLabel = resolveProgramLabel(card, deps.beneficiaries, deps.customPrograms);
  if (programLabel) {
    const pid = programIdFromName(programLabel);
    const linkId = `pgl-${gid}-${pid}`;
    if (!deps.programGrantLinks.some(l => l.id === linkId || (String(l.grantId) === gid && l.programId === pid))) {
      deps.addProgramGrantLink({
        id: linkId,
        programId: pid,
        grantId: gid,
        role: 'primary',
        createdAt: now.toISOString(),
      });
    }
  }

  const hasReportDoc = deps.complianceGrantLinks.some(l => {
    if (String(l.grantId) !== gid) return false;
    const doc = deps.complianceDocs.find(d => d.id === l.complianceDocId);
    return doc?.type === 'grant_report';
  });

  const nextTranche = deps.grantTranches
    .filter(t => String(t.grantId) === gid && t.status !== 'released')
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate))[0];
  const dueDateRaw =
    card.report_due_date ||
    nextTranche?.expectedDate ||
    new Date(now.getTime() + 90 * 86_400_000).toISOString().slice(0, 10);
  const expiryIso = dueDateRaw.slice(0, 10);

  if (!hasReportDoc) {
    const newDocId = `doc-mou-live-${gid}`;
    deps.addComplianceDoc({
      id: newDocId,
      name: `${card.company} — Grant Report`,
      type: 'grant_report',
      status: 'Expiring Soon',
      expiry: expiryIso,
    });
    deps.addComplianceGrantLink({
      id: `cgl-mou-live-${gid}`,
      grantId: gid,
      complianceDocId: newDocId,
      reason: 'Auto-created on MoU → Live; reporting cadence started',
    });

    const quarterlyDue = new Date(now.getTime() + 90 * 86_400_000).toISOString().slice(0, 10);
    deps.addComplianceDoc({
      id: `doc-quarterly-${gid}`,
      name: `${card.company} — Quarterly narrative`,
      type: 'grant_report',
      status: 'Valid',
      expiry: quarterlyDue,
    });
    deps.addComplianceGrantLink({
      id: `cgl-quarterly-${gid}`,
      grantId: gid,
      complianceDocId: `doc-quarterly-${gid}`,
      reason: 'Quarterly reporting cadence',
    });
  }

  const amount = Number(card.amount) || 0;
  const existingHeads = deps.grantBudgetHeads.filter(h => String(h.grantId) === gid);
  if (existingHeads.length === 0 && amount > 0) {
    for (const h of defaultBudgetHeads(gid, amount)) {
      deps.upsertGrantBudgetHead(h);
    }
  }

  const ownerDue = new Date(now.getTime() + 86_400_000).toISOString();
  deps.upsertTask({
    id: `grant-live-priority:${gid}`,
    title: `Kick off programme delivery — ${card.project || card.company}`,
    description: `Grant is live. Align field team, budget heads, and first reporting milestone (${expiryIso}).`,
    priority: 'urgent',
    status: 'open',
    sourceType: 'agent',
    sourceAgent: 'Grant workflow',
    sourceIntentId: `grant-live-priority:${gid}`,
    relatedEntityType: 'grant',
    relatedEntityId: gid,
    assignee: card.agent || undefined,
    dueAt: ownerDue,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    meta: { link: `/grants/${encodeURIComponent(gid)}`, source: 'grant_workflow' },
  });
  tasks += 1;

  deps.upsertTask({
    id: `grant-live-report:${gid}`,
    title: `Submit grant report — ${card.company}`,
    description: `File the grant report and upload the executed MoU by ${expiryIso}.`,
    priority: 'high',
    status: 'open',
    sourceType: 'agent',
    sourceAgent: 'Grant workflow',
    sourceIntentId: `grant-live-report:${gid}`,
    relatedEntityType: 'grant',
    relatedEntityId: gid,
    dueAt: new Date(dueDateRaw).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    meta: { link: `/compliance?alert=true` },
  });
  tasks += 1;

  const reportId = `rpt-grant-${gid}`;
  const programmeId = programLabel ? programIdFromName(programLabel) : undefined;
  const stub: ReportRecord = {
    id: reportId,
    title: `Funder report — ${card.company} · ${card.project || 'Grant'}`,
    type: 'funder',
    status: 'draft',
    date: now.toISOString().slice(0, 10),
    funder: card.company,
    programmeName: programLabel || undefined,
    programmeId,
  };
  deps.upsertGrantReport(stub);

  deps.updateCSRCard(card.id, {
    report_due_date: expiryIso,
    last_activity_at: now.toISOString(),
  });

  return { tasks, reportStubId: reportId };
}

/**
 * Run side effects for a CSR pipeline column change. Call after `moveCSRCard`.
 */
export function applyGrantStageTransition(args: {
  card: CSRCard;
  fromCol: string;
  toCol: string;
  deps: GrantStageWorkflowDeps;
}): GrantStageTransitionResult {
  const key = transitionKey(args.fromCol, args.toCol);
  if (!key) {
    return { transition: 'none', tasksCreated: 0 };
  }

  const now = new Date();
  const iso = now.toISOString();
  args.deps.updateCSRCard(args.card.id, {
    stage_entered_at: iso,
    last_activity_at: iso,
  });

  let tasksCreated = 0;
  let liveBundleApplied = false;
  let reportStubId: string | undefined;

  switch (key) {
    case 'prospecting→pitch':
      tasksCreated = applyProspectingToPitch(args.card, args.deps, now);
      break;
    case 'pitch→diligence':
      tasksCreated = applyPitchToDiligence(args.card, args.deps, now);
      break;
    case 'diligence→mou':
      tasksCreated = applyDiligenceToMou(args.card, args.deps, now);
      break;
    case 'mou→live': {
      const live = applyMouToLive(args.card, args.deps, now);
      tasksCreated = live.tasks;
      reportStubId = live.reportStubId;
      liveBundleApplied = true;
      break;
    }
    default:
      break;
  }

  if (tasksCreated > 0 || liveBundleApplied) {
    emitAppRefresh();
  }

  return { transition: key, tasksCreated, liveBundleApplied, reportStubId };
}

export function buildGrantStageWorkflowDeps(
  getState: () => {
    upsertTaskByIntent: (t: Task) => void;
    addComplianceDoc: GrantStageWorkflowDeps['addComplianceDoc'];
    addComplianceGrantLink: GrantStageWorkflowDeps['addComplianceGrantLink'];
    upsertGrantBudgetHead: GrantStageWorkflowDeps['upsertGrantBudgetHead'];
    addProgramGrantLink: GrantStageWorkflowDeps['addProgramGrantLink'];
    upsertGrantReport: GrantStageWorkflowDeps['upsertGrantReport'];
    updateCSRCard: GrantStageWorkflowDeps['updateCSRCard'];
    grantTranches: GrantTranche[];
    programGrantLinks: ProgramGrantLink[];
    complianceGrantLinks: ComplianceGrantLink[];
    complianceDocs: ComplianceDocument[];
    grantBudgetHeads: GrantBudgetHead[];
    beneficiaries: { program: string }[];
    customPrograms: string[];
  },
): GrantStageWorkflowDeps {
  const s = getState();
  return {
    upsertTask: s.upsertTaskByIntent,
    addComplianceDoc: s.addComplianceDoc,
    addComplianceGrantLink: s.addComplianceGrantLink,
    upsertGrantBudgetHead: s.upsertGrantBudgetHead,
    addProgramGrantLink: s.addProgramGrantLink,
    upsertGrantReport: s.upsertGrantReport,
    updateCSRCard: s.updateCSRCard,
    grantTranches: s.grantTranches,
    programGrantLinks: s.programGrantLinks,
    complianceGrantLinks: s.complianceGrantLinks,
    complianceDocs: s.complianceDocs,
    grantBudgetHeads: s.grantBudgetHeads,
    beneficiaries: s.beneficiaries,
    customPrograms: s.customPrograms,
  };
}
