import { markMilestoneDone } from './donorLifecycle';
import type { Task, TaskOnCompleteAction } from './tasks';

/**
 * Minimal store surface the dispatcher needs. Anything passing the matching
 * shape (the real `useStore.getState()` does) will work, which keeps the
 * dispatcher unit-testable without spinning up zustand.
 */
/**
 * Minimal store surface the dispatcher needs.
 *
 * Method shorthand syntax is intentional: TypeScript treats method-shorthand
 * parameters as bivariant, which lets the real `useStore` (whose
 * `setComplianceDocs` takes the stricter `ComplianceDocument[]`) satisfy this
 * interface without forcing the dispatcher to import every entity shape.
 */
export interface TaskDispatcherStore {
  complianceDocs: ReadonlyArray<{ id: string; status?: string; details?: Record<string, unknown> }>;
  setComplianceDocs(docs: Array<{ id: string; status?: string; details?: Record<string, unknown> }>): void;
  csrCards: ReadonlyArray<{ id: string | number; col?: string; details?: Record<string, unknown> }>;
  updateCSRCard(id: string | number, data: Record<string, unknown>): void;
  beneficiaries: ReadonlyArray<{ id: string; details?: Record<string, unknown> }>;
  updateBeneficiary(id: string, data: Record<string, unknown>): void;
}

export interface DispatchResult {
  ok: boolean;
  reason?: string;
}

/**
 * Apply a task's `onCompleteAction` to the store. Each handler is one short
 * function so adding a new action type is a one-line switch arm.
 */
export function dispatchOnComplete(
  action: TaskOnCompleteAction | undefined,
  store: TaskDispatcherStore,
  now: Date = new Date(),
): DispatchResult {
  if (!action) return { ok: true };

  switch (action.type) {
    case 'donor_touchpoint': {
      // Donor lifecycle state lives in localStorage, scoped per tenant — see
      // donorLifecycle.ts. We just mark the milestone done; the CRM/Today
      // surfaces will pick up the change on next render.
      markMilestoneDone(action.donorId, action.milestoneId, now);
      return { ok: true };
    }
    case 'compliance_review': {
      const doc = store.complianceDocs.find(d => d.id === action.docId);
      if (!doc) return { ok: false, reason: 'compliance doc not found' };
      const next = store.complianceDocs.map(d =>
        d.id === action.docId
          ? {
              ...d,
              status: 'Valid',
              details: {
                ...(d.details ?? {}),
                lastReviewedAt: now.toISOString(),
              },
            }
          : d,
      );
      store.setComplianceDocs(next);
      return { ok: true };
    }
    case 'grant_stage_advance': {
      const grant = store.csrCards.find(c => String(c.id) === String(action.grantId));
      if (!grant) return { ok: false, reason: 'grant not found' };
      store.updateCSRCard(grant.id, {
        col: action.toStage,
        details: {
          ...(grant.details ?? {}),
          lastReportAdvancedAt: now.toISOString(),
        },
        last_activity_at: now.toISOString(),
      });
      return { ok: true };
    }
    case 'beneficiary_followup': {
      const ben = store.beneficiaries.find(b => b.id === action.beneficiaryId);
      if (!ben) return { ok: false, reason: 'beneficiary not found' };
      store.updateBeneficiary(action.beneficiaryId, {
        details: {
          ...(ben.details ?? {}),
          lastFollowUpAt: now.toISOString(),
          nextFollowUpAt: action.nextDate ?? undefined,
        },
      });
      return { ok: true };
    }
    default: {
      // Exhaustiveness — adding a new action type without a handler should
      // surface here at compile time.
      const _exhaustive: never = action;
      void _exhaustive;
      return { ok: false, reason: 'unknown action type' };
    }
  }
}

/** Convenience used by Tasks.tsx — dispatches and returns the result. */
export function applyTaskCompletion(
  task: Task,
  store: TaskDispatcherStore,
  now: Date = new Date(),
): DispatchResult {
  return dispatchOnComplete(task.onCompleteAction, store, now);
}
