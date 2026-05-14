import type { Task, TaskRelatedEntityType, TaskOnCompleteAction } from './tasks';

/**
 * Shape of the inbox items returned by `/inbox`. Lifted from Tasks.tsx so
 * the bridge stays narrow and testable.
 */
export interface InboxItemLike {
  kind: string;
  title?: string;
  subtitle?: string;
  pill?: string;
  priority?: string;
  priority_score?: number;
  primary_action?: { label?: string; route?: string };
  ref?: { id?: string };
  meta?: Record<string, unknown>;
  inline?: Record<string, unknown> & { card_id?: string; donor_ids?: string[] };
}

/** Map an inbox `kind` to a related entity type, where it's clear. */
function entityFromKind(kind: string, item: InboxItemLike): { type?: TaskRelatedEntityType; id?: string } {
  switch (kind) {
    case 'csr_stale':
    case 'csr_win_decay':
    case 'csr_report_due':
      return { type: 'csr', id: (item.inline?.card_id as string) ?? item.ref?.id };
    case 'donor_outreach_draft': {
      const donors = item.inline?.donor_ids;
      const id = Array.isArray(donors) && donors.length > 0 ? String(donors[0]) : item.ref?.id;
      return { type: 'donor', id };
    }
    case 'finance_flag':
      return { type: 'grant', id: item.ref?.id };
    case 'compliance_renewal':
    case 'compliance_filing':
    case 'compliance_doc':
      return { type: 'compliance', id: item.ref?.id };
    case 'beneficiary_followup':
      return { type: 'beneficiary', id: item.ref?.id };
    default:
      return {};
  }
}

/** Stable fallback id when an inbox item has no ref — keeps mirroring
 *  every flag (per requirement) without producing duplicates on re-import. */
function fallbackRefId(item: InboxItemLike): string {
  const seed = `${item.title ?? ''}|${item.subtitle ?? ''}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  return `auto-${Math.abs(h).toString(36)}`;
}

/** Infer an `onCompleteAction` for known inbox kinds. Completion of these
 *  bridged tasks therefore mutates the linked record, exactly as the
 *  cross-module Task model promises. */
function actionFromKind(item: InboxItemLike, entity: { type?: TaskRelatedEntityType; id?: string }): TaskOnCompleteAction | undefined {
  if (!entity.id) return undefined;
  switch (item.kind) {
    case 'compliance_renewal':
    case 'compliance_filing':
    case 'compliance_doc':
      return { type: 'compliance_review', docId: entity.id };
    case 'csr_report_due':
      // Advance the grant stage to "report submitted" once the user marks done.
      return { type: 'grant_stage_advance', grantId: entity.id, toStage: 'report_submitted' };
    case 'beneficiary_followup':
      return { type: 'beneficiary_followup', beneficiaryId: entity.id };
    case 'donor_outreach_draft':
      // Treat completion of a renewal-outreach draft as the renewal touchpoint.
      return { type: 'donor_touchpoint', donorId: entity.id, milestoneId: 'renewal' };
    default:
      return undefined;
  }
}

/** Map inbox kind → default owner role so ownership-based filtering
 *  ("Mine" on the Tasks page) works for agent-sourced tasks. The bridge
 *  prefers an explicit assignee on the inbox payload when present. */
function assigneeFromKind(item: InboxItemLike): string | undefined {
  const explicit = (item.meta?.assignee ?? item.meta?.owner) as string | undefined;
  if (typeof explicit === 'string' && explicit) return explicit;
  switch (item.kind) {
    case 'compliance_renewal':
    case 'compliance_filing':
    case 'compliance_doc':
    case 'finance_flag':
    case 'month_end_close':
      return 'role:finance';
    case 'csr_stale':
    case 'csr_win_decay':
    case 'csr_report_due':
    case 'intent':
      return 'role:ed';
    case 'donor_outreach_draft':
      return 'role:fundraising';
    case 'beneficiary_followup':
      return 'role:field';
    default:
      return undefined;
  }
}

/** Build a Task object from an inbox item. The id is deterministic from
 *  `kind:refId` so re-imports update in place rather than duplicate. */
export function inboxItemToTask(item: InboxItemLike, now: Date = new Date()): Task {
  const refId = item.ref?.id && String(item.ref.id) !== '' ? String(item.ref.id) : fallbackRefId(item);
  const intentId = `inbox:${item.kind}:${refId}`;
  const entity = entityFromKind(item.kind, item);
  // Backend may send "High"/"Urgent"/"high"/"urgent" — normalise.
  const rawPriority = (item.priority ?? '').toString().toLowerCase();
  const priority: Task['priority'] =
    rawPriority === 'urgent' || rawPriority === 'high' ? (rawPriority as Task['priority']) : 'normal';

  return {
    id: intentId,
    title: item.title ?? `Inbox: ${item.kind}`,
    description: item.subtitle,
    status: 'open',
    sourceType: 'inbox',
    sourceIntentId: intentId,
    sourceAgent: typeof item.meta?.agent === 'string' ? (item.meta.agent as string) : undefined,
    assignee: assigneeFromKind(item),
    relatedEntityType: entity.type,
    relatedEntityId: entity.id,
    onCompleteAction: actionFromKind(item, entity),
    priority,
    recurrence: 'none',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    meta: { kind: item.kind, inbox: item },
  };
}

/**
 * Idempotent upsert: returns either an updated copy of the existing task
 * (preserving status/snooze/onCompleteAction) or a brand new task.
 *
 * Idempotency key is `sourceIntentId` so re-fetching the inbox does not
 * resurrect a task the user already completed or dismissed.
 */
export function upsertInboxTask(existing: Task[], item: InboxItemLike, now: Date = new Date()): Task[] {
  const built = inboxItemToTask(item, now);
  const idx = existing.findIndex(t => t.sourceIntentId && t.sourceIntentId === built.sourceIntentId);
  if (idx === -1) {
    return [built, ...existing];
  }
  const prior = existing[idx];
  // Preserve user state; refresh display fields only.
  const merged: Task = {
    ...prior,
    title: built.title,
    description: built.description,
    relatedEntityType: prior.relatedEntityType ?? built.relatedEntityType,
    relatedEntityId: prior.relatedEntityId ?? built.relatedEntityId,
    onCompleteAction: prior.onCompleteAction ?? built.onCompleteAction,
    priority: built.priority,
    meta: { ...(prior.meta ?? {}), ...(built.meta ?? {}) },
    updatedAt: now.toISOString(),
  };
  const next = existing.slice();
  next[idx] = merged;
  return next;
}

/** Attach a default `onCompleteAction` to an inbox-derived task when the
 *  caller knows enough to wire one. Used by Tasks.tsx when the user picks
 *  e.g. "log donor touchpoint" inline. */
export function withOnCompleteAction(t: Task, action: TaskOnCompleteAction): Task {
  return { ...t, onCompleteAction: action, updatedAt: new Date().toISOString() };
}
