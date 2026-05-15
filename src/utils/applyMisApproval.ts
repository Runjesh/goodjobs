import { useStore, type MisReviewIntent } from '../store/useStore';
import { programIdFromName, type ProgramBudget } from './programFinance';
import { decideMisReviewOnServer, MIS_RATION_KIT_COST_INR } from './misReviewApi';
import type { BeneficiaryOutcome } from './outcomes';

function publishOutcomeFromMis(intent: MisReviewIntent, merged: MisReviewIntent['extracted']): void {
  const metric = (merged.metric || '').trim();
  if (!metric) return;
  const store = useStore.getState();
  const nameKey = (merged.beneficiary || '').toLowerCase().trim();
  const ben = nameKey
    ? store.beneficiaries.find(b => {
        const n = b.name.toLowerCase().trim();
        return n === nameKey || n.includes(nameKey) || nameKey.includes(n);
      })
    : undefined;
  if (!ben) return;
  const programName = merged.program || ben.program;
  const programId = programIdFromName(programName);
  const raw = String(merged.value ?? '').replace(/[^\d.]/g, '');
  const current = raw ? parseFloat(raw) : 1;
  const baseline = Number.isFinite(current) && current > 0 ? Math.max(0, current - 1) : 0;
  const outcome: BeneficiaryOutcome = {
    id: `out-mis-${intent.id}`,
    beneficiaryId: ben.id,
    programId,
    metric: metric.toLowerCase().replace(/\s+/g, '_'),
    metricLabel: metric,
    baseline,
    current: Number.isFinite(current) ? current : 1,
    higherIsBetter: true,
    measuredAt: new Date().toISOString().slice(0, 10),
    note: `Published from field MIS review`,
  };
  store.upsertBeneficiaryOutcome(outcome);
}

function budgetIncrementForIntent(intent: MisReviewIntent): number {
  const text = `${intent.narrative} ${intent.extracted.metric ?? ''}`.toLowerCase();
  if (/ration|kit|food|grocery|supplies/.test(text)) return MIS_RATION_KIT_COST_INR;
  return 0;
}

export async function applyMisApproval(
  intent: MisReviewIntent,
  status: MisReviewIntent['status'],
  extracted?: MisReviewIntent['extracted'],
): Promise<void> {
  const merged = extracted ?? intent.extracted;
  const inc = status === 'approved' || status === 'edited' ? budgetIncrementForIntent({ ...intent, extracted: merged }) : 0;
  await decideMisReviewOnServer(intent.id, status, merged, inc || undefined);
  useStore.getState().decideMisReviewIntent(intent.id, status, extracted);

  if (status === 'approved' || status === 'edited') {
    publishOutcomeFromMis(intent, merged);
  }

  if ((status === 'approved' || status === 'edited') && inc > 0 && merged.program) {
    const programId = programIdFromName(merged.program);
    const store = useStore.getState();
    const existing = store.programBudgets.find(b => b.programId === programId);
    const next: ProgramBudget = existing
      ? { ...existing, spent: existing.spent + inc }
      : {
          programId,
          label: merged.program,
          planned: Math.max(inc * 20, 50000),
          spent: inc,
          restricted: false,
        };
    store.upsertProgramBudget(next);
  }
}
