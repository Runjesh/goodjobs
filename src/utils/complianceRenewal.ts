import type { ComplianceDocument, CSRCard } from '../store/useStore';
import type { ComplianceGrantLink } from './complianceGrant';
import { selectAtRiskGrants } from './complianceGrant';
import type { Task } from './tasks';

export type RenewalState =
  | 'not_started'
  | 'collecting_docs'
  | 'under_review'
  | 'submitted'
  | 'renewed';

export const RENEWAL_STATE_LABELS: Record<RenewalState, string> = {
  not_started: 'Not started',
  collecting_docs: 'Collecting docs',
  under_review: 'Under review',
  submitted: 'Submitted',
  renewed: 'Renewed',
};

const RENEWAL_STEPS: Record<string, string[]> = {
  fcra: [
    'Gather last 12 months FCRA bank statements',
    'Reconcile FC-4 annual return with audited accounts',
    'Obtain CA certificate and board resolution',
    'Submit renewal on fcraonline.nic.in before expiry',
  ],
  '80g': [
    'Download current 80G registration certificate',
    'Prepare list of donations received (FY)',
    'CA verification of Form 10BD / 10BE filings',
    'File renewal application with IT department',
  ],
  default: [
    'Download the expiring certificate from Compliance vault',
    'Assign owner and set internal deadline (30 days before expiry)',
    'Collect supporting documents from Finance & Programs',
    'Submit renewal to the issuing authority',
    'Upload renewed certificate and update expiry date',
  ],
};

export function renewalStepsForDoc(docName: string, docType?: string): string[] {
  const key = `${docType || ''} ${docName}`.toLowerCase();
  if (key.includes('fcra')) return RENEWAL_STEPS.fcra;
  if (key.includes('80g') || key.includes('donor deduction')) return RENEWAL_STEPS['80g'];
  return RENEWAL_STEPS.default;
}

export function renewalTaskIntentId(docId: string, stepIndex: number): string {
  return `compliance-renewal:${docId}:step:${stepIndex}`;
}

export function renewalWorkspacePath(docId: string): string {
  return `/compliance?alert=true&doc=${encodeURIComponent(docId)}`;
}

export function daysUntilExpiry(expiry: string | undefined, now = Date.now()): number | null {
  if (!expiry) return null;
  const t = new Date(expiry).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - now) / 86_400_000);
}

export function getStoredRenewalState(doc: ComplianceDocument): RenewalState | undefined {
  const raw = doc.details?.renewalState;
  if (
    raw === 'not_started' ||
    raw === 'collecting_docs' ||
    raw === 'under_review' ||
    raw === 'submitted' ||
    raw === 'renewed'
  ) {
    return raw;
  }
  return undefined;
}

export function computeRenewalProgress(
  tasks: Task[],
  docId: string,
  stepCount: number,
): { done: number; total: number; pct: number } {
  const total = Math.max(stepCount, 1);
  let done = 0;
  for (let i = 0; i < stepCount; i++) {
    const intent = renewalTaskIntentId(docId, i);
    const t = tasks.find(x => x.id === intent || x.sourceIntentId === intent);
    if (t?.status === 'done') done += 1;
  }
  const pct = Math.round((done / total) * 100);
  return { done, total, pct };
}

/** Infer pipeline state from checklist progress when not terminal. */
export function deriveRenewalState(
  doc: ComplianceDocument,
  tasks: Task[],
  stepCount: number,
): RenewalState {
  const stored = getStoredRenewalState(doc);
  if (stored === 'renewed' || stored === 'submitted') return stored;

  const { done, total, pct } = computeRenewalProgress(tasks, doc.id, stepCount);
  if (done >= total && total > 0) return 'submitted';
  if (pct >= 60) return 'under_review';
  if (pct > 0 || doc.assigned_to) return 'collecting_docs';
  return stored ?? 'not_started';
}

export function renewalProgressLabel(pct: number, done: number, total: number): string {
  if (total <= 0) return '0%';
  return `${pct}% (${done}/${total})`;
}

export function resolveComplianceDocFromQuery(
  docs: ComplianceDocument[],
  docParam: string,
): ComplianceDocument | null {
  if (!docParam) return null;
  const raw = docParam.trim();
  const byId = docs.find(d => d.id === raw);
  if (byId) return byId;
  const needle = raw.toLowerCase();
  return (
    docs.find(d => d.name.toLowerCase() === needle) ||
    docs.find(d => d.name.toLowerCase().includes(needle)) ||
    docs.find(d => d.type.toLowerCase().includes(needle) || d.type.toLowerCase().replace(/\s+/g, '-') === needle) ||
    null
  );
}

export function linkedGrantsForDoc(
  docId: string,
  links: ComplianceGrantLink[],
  grants: CSRCard[],
  docs: ComplianceDocument[],
) {
  return selectAtRiskGrants(
    links.filter(l => l.complianceDocId === docId),
    grants,
    docs,
  );
}

export function patchDocRenewal(
  doc: ComplianceDocument,
  patch: {
    renewalState?: RenewalState;
    renewalOwner?: string;
    renewedAt?: string;
    status?: ComplianceDocument['status'];
    expiry?: string;
  },
): ComplianceDocument {
  return {
    ...doc,
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.expiry ? { expiry: patch.expiry } : {}),
    ...(patch.renewalOwner !== undefined ? { assigned_to: patch.renewalOwner || undefined } : {}),
    details: {
      ...(doc.details ?? {}),
      ...(patch.renewalState ? { renewalState: patch.renewalState } : {}),
      ...(patch.renewalOwner !== undefined ? { renewalOwner: patch.renewalOwner } : {}),
      ...(patch.renewedAt ? { renewedAt: patch.renewedAt } : {}),
    },
  };
}

export interface RenewalTaskSyncDeps {
  upsertTaskByIntent: (task: Task) => void;
  tasks: Task[];
}

export function buildRenewalStepTask(
  doc: ComplianceDocument,
  stepIndex: number,
  stepTitle: string,
  stepCount: number,
  completed: boolean,
  assignee?: string,
): Task {
  const id = renewalTaskIntentId(doc.id, stepIndex);
  const now = new Date().toISOString();
  const days = daysUntilExpiry(doc.expiry);
  return {
    id,
    title: `Renewal: ${stepTitle}`,
    description: `${doc.name} — step ${stepIndex + 1} of ${stepCount}`,
    assignee,
    priority: days != null && days <= 30 ? 'urgent' : 'high',
    status: completed ? 'done' : 'open',
    sourceType: 'agent',
    sourceAgent: 'Compliance Guardian',
    sourceIntentId: id,
    relatedEntityType: 'compliance',
    relatedEntityId: doc.id,
    onCompleteAction: { type: 'compliance_review', docId: doc.id },
    recurrence: 'none',
    createdAt: now,
    updatedAt: now,
    completedAt: completed ? now : undefined,
    meta: {
      link: renewalWorkspacePath(doc.id),
      renewalStepIndex: stepIndex,
      renewalProgressKey: doc.id,
    },
  };
}

export function ensureRenewalTasks(
  doc: ComplianceDocument,
  deps: RenewalTaskSyncDeps,
  assignee?: string,
): string[] {
  const steps = renewalStepsForDoc(doc.name, doc.type);
  const existingDone = new Set<number>();
  steps.forEach((title, i) => {
    const intent = renewalTaskIntentId(doc.id, i);
    const prior = deps.tasks.find(t => t.id === intent || t.sourceIntentId === intent);
    const completed = prior?.status === 'done';
    if (completed) existingDone.add(i);
    if (!prior) {
      deps.upsertTaskByIntent(buildRenewalStepTask(doc, i, title, steps.length, completed, assignee));
    }
  });
  return steps;
}

export function closeRenewalTasks(
  docId: string,
  stepCount: number,
  deps: RenewalTaskSyncDeps,
): void {
  const now = new Date().toISOString();
  for (let i = 0; i < stepCount; i++) {
    const intent = renewalTaskIntentId(docId, i);
    const prior = deps.tasks.find(t => t.id === intent || t.sourceIntentId === intent);
    if (!prior) continue;
    deps.upsertTaskByIntent({
      ...prior,
      status: 'done',
      updatedAt: now,
      completedAt: now,
    });
  }
}

export function applyRenewalUploadComplete(
  doc: ComplianceDocument,
  newExpiry: string,
  deps: RenewalTaskSyncDeps & {
    setComplianceDocs: (docs: ComplianceDocument[]) => void;
    complianceDocs: ComplianceDocument[];
  },
): ComplianceDocument {
  const steps = renewalStepsForDoc(doc.name, doc.type);
  closeRenewalTasks(doc.id, steps.length, deps);
  const now = new Date().toISOString();
  const next = patchDocRenewal(doc, {
    renewalState: 'renewed',
    status: 'Valid',
    expiry: newExpiry,
    renewedAt: now,
  });
  deps.setComplianceDocs(
    deps.complianceDocs.map(d => (d.id === doc.id ? next : d)),
  );
  return next;
}

export function syncRenewalStateAfterProgress(
  doc: ComplianceDocument,
  tasks: Task[],
  setComplianceDocs: (docs: ComplianceDocument[]) => void,
  complianceDocs: ComplianceDocument[],
): RenewalState {
  const steps = renewalStepsForDoc(doc.name, doc.type);
  const state = deriveRenewalState(doc, tasks, steps.length);
  const stored = getStoredRenewalState(doc);
  if (stored === 'renewed' || stored === 'submitted') return stored;
  if (state === stored) return state;
  const next = patchDocRenewal(doc, { renewalState: state });
  setComplianceDocs(complianceDocs.map(d => (d.id === doc.id ? next : d)));
  return state;
}

export function formatRenewalNotificationMessage(
  docName: string,
  daysLeft: number,
  pct: number,
  done: number,
  total: number,
): string {
  const progress = renewalProgressLabel(pct, done, total);
  const dayPart =
    daysLeft < 0
      ? `expired ${Math.abs(daysLeft)}d ago`
      : daysLeft === 0
        ? 'expires today'
        : `expires in ${daysLeft}d`;
  return `${docName} — ${dayPart} — renewal ${progress}`;
}
