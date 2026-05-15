import { useStore, type MisReviewIntent } from '../store/useStore';
import { programIdFromName, type ProgramBudget } from './programFinance';
import { decideMisReviewOnServer, MIS_RATION_KIT_COST_INR } from './misReviewApi';

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
