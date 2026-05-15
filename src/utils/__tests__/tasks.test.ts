import { beforeEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { useStore } from '../../store/useStore';
import type { Task } from '../tasks';
import { buildRecurringNextInstance, isVisibleToday, nextRecurrenceDueAt } from '../tasks';
import { dispatchOnComplete } from '../taskDispatcher';
import { inboxItemToTask, upsertInboxTask } from '../inboxToTask';

function baseTask(over: Partial<Task> = {}): Task {
  const iso = new Date('2026-05-01T10:00:00Z').toISOString();
  return {
    id: 't-1',
    title: 'Follow up',
    status: 'open',
    sourceType: 'manual',
    createdAt: iso,
    updatedAt: iso,
    ...over,
  };
}

describe('tasks slice', () => {
  beforeEach(() => {
    // setup.ts clears localStorage; reset slice state too.
    act(() => {
      useStore.setState({
        tasks: [],
        complianceDocs: [],
        csrCards: [],
        beneficiaries: [],
      });
    });
  });

  it('addTask + persists to localStorage', () => {
    const t = baseTask();
    act(() => useStore.getState().addTask(t));
    expect(useStore.getState().tasks).toHaveLength(1);
    const raw = JSON.parse(localStorage.getItem('goodjobs.tasks.v1') || '[]');
    expect(raw[0].id).toBe('t-1');
  });

  it('completeTask marks done and creates next recurring instance', () => {
    const now = new Date('2026-05-10T09:00:00Z');
    const t = baseTask({ id: 't-rec', recurrence: 'weekly' });
    act(() => useStore.getState().addTask(t));
    const holder: { value: Task | null } = { value: null };
    act(() => { holder.value = useStore.getState().completeTask('t-rec', now); });
    expect(holder.value?.status).toBe('done');
    const tasks = useStore.getState().tasks;
    expect(tasks).toHaveLength(2); // completed + next instance
    const next = tasks.find(x => x.status === 'open');
    expect(next).toBeTruthy();
    expect(next!.dueAt).toBe(new Date(now.getTime() + 7 * 86_400_000).toISOString());
  });

  it('completeTask without recurrence does not create a new instance', () => {
    act(() => useStore.getState().addTask(baseTask({ id: 't-once' })));
    act(() => { useStore.getState().completeTask('t-once'); });
    const tasks = useStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('done');
  });

  it('snoozeTask hides task from Today until snoozeUntil', () => {
    const t = baseTask({ id: 't-snooze' });
    act(() => useStore.getState().addTask(t));
    const future = new Date(Date.now() + 60_000).toISOString();
    act(() => useStore.getState().snoozeTask('t-snooze', future));
    const snoozed = useStore.getState().tasks[0];
    expect(snoozed.status).toBe('snoozed');
    expect(isVisibleToday(snoozed)).toBe(false);
    // After the snooze window has passed it becomes visible again.
    const past = { ...snoozed, snoozeUntil: new Date(Date.now() - 60_000).toISOString() };
    expect(isVisibleToday(past)).toBe(true);
  });

  it('dismissTask hides forever', () => {
    act(() => useStore.getState().addTask(baseTask({ id: 't-d' })));
    act(() => useStore.getState().dismissTask('t-d'));
    expect(useStore.getState().tasks[0].status).toBe('dismissed');
    expect(isVisibleToday(useStore.getState().tasks[0])).toBe(false);
  });
});

describe('recurrence helpers', () => {
  const base = new Date('2026-01-15T00:00:00Z');

  it('nextRecurrenceDueAt computes daily/weekly/monthly', () => {
    expect(nextRecurrenceDueAt('daily', base)).toBe(new Date('2026-01-16T00:00:00Z').toISOString());
    expect(nextRecurrenceDueAt('weekly', base)).toBe(new Date('2026-01-22T00:00:00Z').toISOString());
    expect(nextRecurrenceDueAt('monthly', base)).toBe(new Date('2026-02-15T00:00:00Z').toISOString());
    expect(nextRecurrenceDueAt('none', base)).toBeUndefined();
  });

  it('buildRecurringNextInstance keeps onCompleteAction + bumps id', () => {
    const t: Task = {
      ...baseTask({ id: 't-x', recurrence: 'daily' }),
      onCompleteAction: { type: 'compliance_review', docId: 'doc-1' },
    };
    const next = buildRecurringNextInstance(t, base);
    expect(next).toBeTruthy();
    expect(next!.id).not.toBe(t.id);
    expect(next!.status).toBe('open');
    expect(next!.onCompleteAction).toEqual(t.onCompleteAction);
  });
});

describe('dispatchOnComplete', () => {
  it('donor_touchpoint marks the milestone done in donor lifecycle storage', () => {
    const res = dispatchOnComplete(
      { type: 'donor_touchpoint', donorId: 'D-99', milestoneId: 'thankyou' },
      // donor_touchpoint doesn't use the store fields.
      { complianceDocs: [], setComplianceDocs: () => {}, csrCards: [], updateCSRCard: () => {}, beneficiaries: [], updateBeneficiary: () => {} },
      new Date('2026-05-01T00:00:00Z'),
    );
    expect(res.ok).toBe(true);
    const raw = localStorage.getItem('gj.donor_milestones.v1');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as Record<string, Record<string, { doneAt?: string }>>;
    expect(parsed['D-99']?.thankyou?.doneAt).toBeDefined();
  });

  it('compliance_review stamps lastReviewedAt and advances renewal pipeline', () => {
    const calls: any[] = [];
    const res = dispatchOnComplete(
      { type: 'compliance_review', docId: 'doc-2' },
      {
        complianceDocs: [{ id: 'doc-2', status: 'Expiring Soon' }],
        setComplianceDocs: (d) => calls.push(d),
        csrCards: [], updateCSRCard: () => {}, beneficiaries: [], updateBeneficiary: () => {},
      },
    );
    expect(res.ok).toBe(true);
    expect(calls[0][0].status).toBe('Expiring Soon');
    expect(calls[0][0].details.lastReviewedAt).toBeTruthy();
    expect(calls[0][0].details.renewalState).toBe('under_review');
  });

  it('grant_stage_advance moves CSR card column', () => {
    const updates: any[] = [];
    const res = dispatchOnComplete(
      { type: 'grant_stage_advance', grantId: '5', toStage: 'closed' },
      {
        complianceDocs: [], setComplianceDocs: () => {},
        csrCards: [{ id: 5, col: 'live' }],
        updateCSRCard: (id, data) => updates.push([id, data]),
        beneficiaries: [], updateBeneficiary: () => {},
      },
    );
    expect(res.ok).toBe(true);
    expect(updates[0][0]).toBe(5);
    expect(updates[0][1].col).toBe('closed');
  });

  it('beneficiary_followup writes nextFollowUpAt onto the beneficiary', () => {
    const updates: any[] = [];
    const res = dispatchOnComplete(
      { type: 'beneficiary_followup', beneficiaryId: 'BEN-1', nextDate: '2026-06-01' },
      {
        complianceDocs: [], setComplianceDocs: () => {},
        csrCards: [], updateCSRCard: () => {},
        beneficiaries: [{ id: 'BEN-1' }],
        updateBeneficiary: (id, data) => updates.push([id, data]),
      },
    );
    expect(res.ok).toBe(true);
    expect(updates[0][1].details.nextFollowUpAt).toBe('2026-06-01');
  });

  it('returns ok:false when the related entity is missing', () => {
    const res = dispatchOnComplete(
      { type: 'compliance_review', docId: 'missing' },
      { complianceDocs: [], setComplianceDocs: () => {}, csrCards: [], updateCSRCard: () => {}, beneficiaries: [], updateBeneficiary: () => {} },
    );
    expect(res.ok).toBe(false);
  });

  it('completeTask wires the dispatcher: marks compliance renewal step reviewed via the store', () => {
    act(() => {
      useStore.setState({
        tasks: [],
        complianceDocs: [{ id: 'doc-9', name: 'X', type: 'Test', status: 'Expiring Soon', expiry: '', uploadedAt: '' }],
      });
    });
    const t: Task = baseTask({
      id: 't-doc',
      onCompleteAction: { type: 'compliance_review', docId: 'doc-9' },
    });
    act(() => useStore.getState().addTask(t));
    act(() => { useStore.getState().completeTask('t-doc'); });
    const doc = useStore.getState().complianceDocs.find(d => d.id === 'doc-9');
    expect(doc?.status).toBe('Expiring Soon');
    expect(doc?.details?.renewalState).toBe('under_review');
    expect(doc?.details?.lastReviewedAt).toBeTruthy();
  });
});

describe('inbox → task bridge', () => {
  const item = {
    kind: 'csr_stale',
    title: 'CSR card stale',
    subtitle: '14 days no activity',
    ref: { id: 'card-7' },
    inline: { card_id: 'card-7' },
    priority: 'high',
  };

  it('inboxItemToTask uses a deterministic intent id', () => {
    const t = inboxItemToTask(item);
    expect(t.sourceIntentId).toBe('inbox:csr_stale:card-7');
    expect(t.relatedEntityType).toBe('csr');
    expect(t.relatedEntityId).toBe('card-7');
  });

  it('upsertInboxTask is idempotent on sourceIntentId', () => {
    const t1 = upsertInboxTask([], item);
    expect(t1).toHaveLength(1);
    const t2 = upsertInboxTask(t1, item);
    expect(t2).toHaveLength(1);
    expect(t2[0].sourceIntentId).toBe(t1[0].sourceIntentId);
  });

  it('upsertInboxTask preserves user state across re-imports', () => {
    const initial = upsertInboxTask([], item);
    const userEdited = initial.map(t => ({ ...t, status: 'snoozed' as const, snoozeUntil: '2099-01-01' }));
    const reimported = upsertInboxTask(userEdited, { ...item, title: 'Updated title' });
    expect(reimported).toHaveLength(1);
    expect(reimported[0].status).toBe('snoozed');
    expect(reimported[0].snoozeUntil).toBe('2099-01-01');
    expect(reimported[0].title).toBe('Updated title'); // display refreshed
  });

  it('inboxItemToTask wires onCompleteAction for known kinds', () => {
    const compliance = inboxItemToTask({
      kind: 'compliance_renewal', title: '12A renewal due', ref: { id: 'doc-9' },
    });
    expect(compliance.onCompleteAction).toEqual({ type: 'compliance_review', docId: 'doc-9' });

    // Backend currently emits `compliance_doc` — must be mapped too.
    const complianceDoc = inboxItemToTask({
      kind: 'compliance_doc', title: 'PAN expiring', ref: { id: 'doc-22' }, priority: 'High',
    });
    expect(complianceDoc.onCompleteAction).toEqual({ type: 'compliance_review', docId: 'doc-22' });
    expect(complianceDoc.relatedEntityType).toBe('compliance');
    expect(complianceDoc.priority).toBe('high');

    const beneficiary = inboxItemToTask({
      kind: 'beneficiary_followup', title: 'Check on Asha', ref: { id: 'b-1' },
    });
    expect(beneficiary.onCompleteAction).toEqual({ type: 'beneficiary_followup', beneficiaryId: 'b-1' });

    const csrReport = inboxItemToTask({
      kind: 'csr_report_due', title: 'UC due', ref: { id: 'g-7' },
    });
    expect(csrReport.onCompleteAction).toEqual({
      type: 'grant_stage_advance', grantId: 'g-7', toStage: 'report_submitted',
    });

    const donor = inboxItemToTask({
      kind: 'donor_outreach_draft', title: 'Renewal nudge', ref: { id: 'd-3' },
    });
    expect(donor.onCompleteAction).toEqual({
      type: 'donor_touchpoint', donorId: 'd-3', milestoneId: 'renewal',
    });
  });

  it('inboxItemToTask assigns a default owner role per kind, prefers explicit', () => {
    const renew = inboxItemToTask({ kind: 'compliance_renewal', title: 'x', ref: { id: 'd1' } });
    expect(renew.assignee).toBe('role:finance');
    const ben = inboxItemToTask({ kind: 'beneficiary_followup', title: 'x', ref: { id: 'b1' } });
    expect(ben.assignee).toBe('role:field');
    const explicit = inboxItemToTask({
      kind: 'donor_outreach_draft', title: 'x', ref: { id: 'd1' }, meta: { assignee: 'user-7' },
    });
    expect(explicit.assignee).toBe('user-7');
  });

  it('"Mine" filter requires strict ownership', () => {
    // Mirrors Tasks.tsx visibleTasks predicate exactly.
    const userId = 'user-1';
    const mine = (t: Task) => !!userId && t.assignee === userId;
    const owned     = baseTask({ id: 'a', assignee: 'user-1' });
    const otherUser = baseTask({ id: 'b', assignee: 'user-2' });
    const unassigned = baseTask({ id: 'c' });
    expect(mine(owned)).toBe(true);
    expect(mine(otherUser)).toBe(false);
    expect(mine(unassigned)).toBe(false);
  });

  it('inboxItemToTask still produces a stable id when ref.id is missing', () => {
    const noRef = { kind: 'finance_flag', title: 'Tag pending', subtitle: '2 lines' };
    const a = inboxItemToTask(noRef);
    const b = inboxItemToTask(noRef);
    expect(a.sourceIntentId).toBe(b.sourceIntentId);
    expect(a.sourceIntentId).toMatch(/^inbox:finance_flag:auto-/);
  });

  it('store upsertTaskByIntent matches the bridge: same intent id ⇒ no duplicate', () => {
    act(() => useStore.setState({ tasks: [] }));
    const t = inboxItemToTask(item);
    act(() => useStore.getState().upsertTaskByIntent(t));
    act(() => useStore.getState().upsertTaskByIntent(t));
    act(() => useStore.getState().upsertTaskByIntent({ ...t, title: 'Refreshed' }));
    const tasks = useStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Refreshed');
  });
});
