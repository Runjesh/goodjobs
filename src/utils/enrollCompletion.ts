import type { EnrollFormData } from '../pages/Programs/EnrollBeneficiaryModal';
import type { Beneficiary } from '../store/useStore';
import type { Task } from './tasks';
import { readToCForProgram } from './tocStorage';

export interface EnrollSourceContext {
  misIntentId?: string;
  fieldNote?: string;
}

export interface EnrollCompletionSnapshot {
  beneficiaryId: string;
  beneficiaryName: string;
  program: string;
  consentCaptured: boolean;
  aadhaarVerified: boolean;
  householdLinked: boolean;
  documentsComplete: boolean;
  docsSkipped: boolean;
  hasToCOutcomes: boolean;
  sourceFieldNote?: string;
  sourceMisIntentId?: string;
}

export function deriveEnrollCompletion(
  form: EnrollFormData,
  beneficiaryId: string,
  source?: EnrollSourceContext,
): EnrollCompletionSnapshot {
  const toc = readToCForProgram(form.program);
  const hasToCOutcomes = toc.some(n => n.type === 'outcome' || n.type === 'impact');
  const documentsComplete =
    (!!form.docAadhaar && !!form.docPhoto) ||
    (!form.docsSkipped && !!form.idDocRef.trim());
  return {
    beneficiaryId,
    beneficiaryName: form.name.trim(),
    program: form.program,
    consentCaptured: !!form.consentGiven,
    aadhaarVerified: !!form.aadhaar,
    householdLinked: !!(form.householdHead.trim() || form.householdId),
    documentsComplete,
    docsSkipped: !!form.docsSkipped,
    hasToCOutcomes,
    sourceFieldNote: source?.fieldNote,
    sourceMisIntentId: source?.misIntentId,
  };
}

export function buildTimelineForEnroll(
  form: EnrollFormData,
  source?: EnrollSourceContext,
): { at: string; type: string; text: string }[] {
  const events: { at: string; type: string; text: string }[] = [
    {
      at: new Date().toISOString(),
      type: 'enrollment',
      text: `Enrolled in ${form.program}${form.enrollmentDate ? ` (${form.enrollmentDate})` : ''}.`,
    },
  ];
  if (form.consentGiven) {
    events.push({
      at: new Date().toISOString(),
      type: 'consent',
      text: `DPDP consent captured (${form.consentLanguage}).`,
    });
  }
  if (source?.fieldNote) {
    events.push({
      at: new Date().toISOString(),
      type: 'field_mis',
      text: source.fieldNote,
    });
  }
  return events;
}

export function mergeTimelineIntoDetails(
  existing: Record<string, unknown> | undefined,
  events: { at: string; type: string; text: string }[],
): Record<string, unknown> {
  const prev = Array.isArray(existing?.timeline) ? (existing!.timeline as typeof events) : [];
  return {
    ...(existing || {}),
    timeline: [...events, ...prev].slice(0, 40),
  };
}

export function buildPostEnrollTasks(
  snap: EnrollCompletionSnapshot,
  form: EnrollFormData,
): Task[] {
  const now = new Date().toISOString();
  const due3Days = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const dueWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const tasks: Task[] = [];
  const bid = snap.beneficiaryId;
  const name = snap.beneficiaryName;

  if (form.consentGiven && (form.docsSkipped || !snap.documentsComplete)) {
    tasks.push({
      id: `enroll-docs:${bid}`,
      title: `Collect Aadhaar/photo for ${name}`,
      description: 'Enrollment saved with documents skipped or incomplete.',
      priority: 'normal',
      status: 'open',
      sourceType: 'agent',
      sourceAgent: 'Enrollment workflow',
      sourceIntentId: `enroll-docs:${bid}`,
      relatedEntityType: 'beneficiary',
      relatedEntityId: bid,
      dueAt: due3Days,
      recurrence: 'none',
      createdAt: now,
      updatedAt: now,
      meta: { link: `/programs?beneficiary=${encodeURIComponent(bid)}&focus=documents` },
    });
  }

  if (!snap.aadhaarVerified) {
    tasks.push({
      id: `enroll-aadhaar:${bid}`,
      title: `Verify Aadhaar for ${name}`,
      description: 'ID verification pending before MIS dashboards count this enrollment.',
      priority: 'high',
      status: 'open',
      sourceType: 'agent',
      sourceAgent: 'Enrollment workflow',
      sourceIntentId: `enroll-aadhaar:${bid}`,
      relatedEntityType: 'beneficiary',
      relatedEntityId: bid,
      dueAt: dueWeek,
      recurrence: 'none',
      createdAt: now,
      updatedAt: now,
      meta: { link: `/programs?filter=verify` },
    });
  }

  if (!snap.householdLinked) {
    tasks.push({
      id: `enroll-household:${bid}`,
      title: `Link household for ${name}`,
      priority: 'normal',
      status: 'open',
      sourceType: 'agent',
      sourceAgent: 'Enrollment workflow',
      sourceIntentId: `enroll-household:${bid}`,
      relatedEntityType: 'beneficiary',
      relatedEntityId: bid,
      dueAt: dueWeek,
      recurrence: 'none',
      createdAt: now,
      updatedAt: now,
      meta: { link: `/programs?beneficiary=${encodeURIComponent(bid)}` },
    });
  }

  if (snap.hasToCOutcomes) {
    tasks.push({
      id: `enroll-baseline:${bid}`,
      title: `Record baseline outcome for ${name}`,
      description: `Programme ${snap.program} has Theory of Change outcomes configured.`,
      priority: 'high',
      status: 'open',
      sourceType: 'agent',
      sourceAgent: 'Enrollment workflow',
      sourceIntentId: `enroll-baseline:${bid}`,
      relatedEntityType: 'beneficiary',
      relatedEntityId: bid,
      dueAt: now,
      recurrence: 'none',
      createdAt: now,
      updatedAt: now,
      meta: { link: `/programs?beneficiary=${encodeURIComponent(bid)}&action=outcome` },
      onCompleteAction: { type: 'beneficiary_followup', beneficiaryId: bid },
    });
  }

  return tasks;
}

export function applyPostEnrollWorkflow(args: {
  form: EnrollFormData;
  beneficiaryId: string;
  beneficiary: Beneficiary;
  source?: EnrollSourceContext;
  upsertTask: (t: Task) => void;
  updateBeneficiary: (id: string, data: Partial<Beneficiary>) => void;
}): EnrollCompletionSnapshot {
  const snap = deriveEnrollCompletion(args.form, args.beneficiaryId, args.source);
  const timeline = buildTimelineForEnroll(args.form, args.source);
  const details = mergeTimelineIntoDetails(args.beneficiary.details, timeline);
  if (args.source?.misIntentId) {
    details.enrollment_source = 'whatsapp_mis';
    details.source_mis_intent_id = args.source.misIntentId;
  }
  args.updateBeneficiary(args.beneficiaryId, { details });
  for (const t of buildPostEnrollTasks(snap, args.form)) {
    args.upsertTask(t);
  }
  return snap;
}
