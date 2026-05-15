import { describe, it, expect } from 'vitest';
import type { ComplianceDocument } from '../../store/useStore';
import type { Task } from '../tasks';
import {
  computeRenewalProgress,
  deriveRenewalState,
  renewalStepsForDoc,
  renewalTaskIntentId,
  resolveComplianceDocFromQuery,
  patchDocRenewal,
  formatRenewalNotificationMessage,
} from '../complianceRenewal';

const doc: ComplianceDocument = {
  id: 'doc-fcra',
  name: 'FCRA Registration',
  type: 'FCRA',
  status: 'Expiring Soon',
  expiry: '2026-06-01',
  uploadedAt: '2025-01-01',
};

describe('complianceRenewal', () => {
  it('resolves doc by id or type slug', () => {
    expect(resolveComplianceDocFromQuery([doc], 'doc-fcra')?.id).toBe('doc-fcra');
    expect(resolveComplianceDocFromQuery([doc], 'fcra')?.id).toBe('doc-fcra');
  });

  it('computes checklist progress from tasks', () => {
    const steps = renewalStepsForDoc(doc.name, doc.type);
    const tasks: Task[] = [
      {
        id: renewalTaskIntentId(doc.id, 0),
        title: 'x',
        status: 'done',
        sourceType: 'agent',
        sourceIntentId: renewalTaskIntentId(doc.id, 0),
        createdAt: '',
        updatedAt: '',
      },
    ];
    const p = computeRenewalProgress(tasks, doc.id, steps.length);
    expect(p.done).toBe(1);
    expect(p.pct).toBeGreaterThan(0);
  });

  it('derives pipeline state from progress', () => {
    const steps = renewalStepsForDoc(doc.name, doc.type);
    expect(deriveRenewalState(doc, [], steps.length)).toBe('not_started');
    const allDone: Task[] = steps.map((_, i) => ({
      id: renewalTaskIntentId(doc.id, i),
      title: 't',
      status: 'done' as const,
      sourceType: 'agent' as const,
      sourceIntentId: renewalTaskIntentId(doc.id, i),
      createdAt: '',
      updatedAt: '',
    }));
    expect(deriveRenewalState(doc, allDone, steps.length)).toBe('submitted');
  });

  it('formats notification copy with percent', () => {
    const msg = formatRenewalNotificationMessage('FCRA', 12, 50, 2, 4);
    expect(msg).toContain('50%');
    expect(msg).toContain('2/4');
  });

  it('patches renewal metadata on doc', () => {
    const next = patchDocRenewal(doc, { renewalState: 'collecting_docs', renewalOwner: 'role:finance' });
    expect(next.details?.renewalState).toBe('collecting_docs');
    expect(next.assigned_to).toBe('role:finance');
  });
});
