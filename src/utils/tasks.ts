import type { MilestoneId } from './donorLifecycle';

/**
 * Cross-module Task model. A task is a real, persistent object that can come
 * from a person (manual), an agent (intent), or a recurring rule. It can be
 * tied to a record in another module (donor / grant / beneficiary / etc.) and
 * can mutate that record on completion via `onCompleteAction`.
 *
 * The Tasks page becomes an inbox _onto_ this model; it is not the model
 * itself. The dashboard, per-record relationship panels, and field-worker
 * views all read from the same `tasks` slice.
 */

export type TaskStatus = 'open' | 'snoozed' | 'done' | 'dismissed';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskSourceType = 'manual' | 'agent' | 'recurring' | 'inbox';
export type TaskRecurrence = 'none' | 'daily' | 'weekly' | 'monthly';

export type TaskRelatedEntityType =
  | 'donor'
  | 'grant'
  | 'beneficiary'
  | 'compliance'
  | 'csr'
  | 'campaign'
  | 'volunteer';

export type TaskOnCompleteAction =
  | { type: 'donor_touchpoint'; donorId: string; milestoneId: MilestoneId }
  | { type: 'compliance_review'; docId: string }
  | { type: 'grant_stage_advance'; grantId: string; toStage: string }
  | { type: 'beneficiary_followup'; beneficiaryId: string; nextDate?: string };

export interface Task {
  id: string;
  title: string;
  description?: string;
  /** User id or role string the task is assigned to. */
  assignee?: string;
  /** ISO timestamp the task is due. */
  dueAt?: string;
  priority?: TaskPriority;
  status: TaskStatus;
  sourceType: TaskSourceType;
  /** For agent-sourced tasks, which agent generated it. */
  sourceAgent?: string;
  /** Idempotency key for agent / inbox / recurring upserts. */
  sourceIntentId?: string;
  relatedEntityType?: TaskRelatedEntityType;
  relatedEntityId?: string;
  onCompleteAction?: TaskOnCompleteAction;
  recurrence?: TaskRecurrence;
  /** ISO timestamp; while > now and status='snoozed' the task is hidden. */
  snoozeUntil?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  /** Free-form metadata. Inbox-sourced tasks stash the original inbox row
   *  here so kind-specific inline UI (FCRA tag picker, WhatsApp send,
   *  intent approve & run, …) can keep working on top of the slice. */
  meta?: Record<string, unknown>;
}

const DAY = 86_400_000;

export function nextRecurrenceDueAt(rule: TaskRecurrence, from: Date = new Date()): string | undefined {
  if (!rule || rule === 'none') return undefined;
  const t = new Date(from.getTime());
  if (rule === 'daily')   return new Date(t.getTime() + DAY).toISOString();
  if (rule === 'weekly')  return new Date(t.getTime() + 7 * DAY).toISOString();
  if (rule === 'monthly') {
    const m = new Date(t.getTime());
    m.setMonth(m.getMonth() + 1);
    return m.toISOString();
  }
  return undefined;
}

/** Build the next-instance task for a recurrence on completion. */
export function buildRecurringNextInstance(t: Task, now: Date = new Date()): Task | null {
  if (!t.recurrence || t.recurrence === 'none') return null;
  const dueAt = nextRecurrenceDueAt(t.recurrence, now);
  return {
    ...t,
    id: `${t.id}__r${now.getTime()}`,
    status: 'open',
    snoozeUntil: undefined,
    completedAt: undefined,
    dueAt,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    // sourceIntentId stays the same so it remains idempotent across re-imports,
    // but we add an instance suffix so the slice doesn't dedupe against the
    // just-completed prior instance.
    sourceIntentId: t.sourceIntentId ? `${t.sourceIntentId}#${now.getTime()}` : undefined,
  };
}

/** Returns true if the task should be visible in "Today" right now. */
export function isVisibleToday(t: Task, now: Date = new Date()): boolean {
  if (t.status === 'done' || t.status === 'dismissed') return false;
  if (t.status === 'snoozed') {
    if (!t.snoozeUntil) return false;
    return new Date(t.snoozeUntil).getTime() <= now.getTime();
  }
  return true;
}
