import React, { useMemo, useState } from 'react';
import { CheckSquare, Plus, Check, Clock, X, ChevronDown, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../../store/useStore';
import { isVisibleToday, type Task, type TaskRelatedEntityType } from '../../utils/tasks';
import { useAuth } from '../../context/AuthContext';

interface Props {
  entityType: TaskRelatedEntityType;
  entityId: string;
  /** Optional label shown in the "Add task" placeholder. */
  entityLabel?: string;
  /** Hide the wrapper title — useful when caller already supplies one. */
  compact?: boolean;
}

function fmtDue(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const RecordTasksPanel: React.FC<Props> = ({ entityType, entityId, entityLabel, compact }) => {
  const { user } = useAuth();
  const userId = (user as { id?: string } | null | undefined)?.id ?? '';

  const tasks         = useStore(s => s.tasks);
  const addTask       = useStore(s => s.addTask);
  const completeTask  = useStore(s => s.completeTask);
  const snoozeTask    = useStore(s => s.snoozeTask);
  const dismissTask   = useStore(s => s.dismissTask);

  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [showSnoozed, setShowSnoozed] = useState(false);

  const myTasks = useMemo(() => {
    return tasks.filter(t =>
      t.relatedEntityType === entityType &&
      String(t.relatedEntityId) === String(entityId)
    );
  }, [tasks, entityType, entityId]);

  const visible = useMemo(() => {
    return myTasks.filter(t => {
      if (showSnoozed) return t.status !== 'done' && t.status !== 'dismissed';
      return isVisibleToday(t);
    });
  }, [myTasks, showSnoozed]);

  const hiddenSnoozedCount = useMemo(
    () => myTasks.filter(t => t.status === 'snoozed').length,
    [myTasks]
  );

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) { toast.error('Task title required.'); return; }
    const now = new Date().toISOString();
    const t: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      assignee: userId || undefined,
      status: 'open',
      sourceType: 'manual',
      relatedEntityType: entityType,
      relatedEntityId: String(entityId),
      createdAt: now,
      updatedAt: now,
    };
    addTask(t);
    setNewTitle('');
    setShowAdd(false);
    toast.success('Task added.');
  };

  const doComplete = (t: Task) => {
    const result = completeTask(t.id);
    if (!result) {
      toast.error('Could not complete: linked record was not found.');
      return;
    }
    toast.success('Task completed.');
  };

  const doSnooze = (t: Task, hours = 24) => {
    const until = new Date(Date.now() + hours * 3_600_000).toISOString();
    snoozeTask(t.id, until);
    toast.success(`Snoozed for ${hours}h.`);
  };

  const doDismiss = (t: Task) => {
    dismissTask(t.id);
    toast.success('Dismissed.');
  };

  const placeholder = entityLabel
    ? `New task for ${entityLabel}…`
    : 'New task…';

  return (
    <div
      style={{
        marginTop: '0.4rem',
        padding: '0.6rem 0.75rem',
        background: 'var(--color-bg-main)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border-light)',
      }}
    >
      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: visible.length || showAdd ? '0.5rem' : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <CheckSquare size={13} /> Open tasks
            {visible.length > 0 && (
              <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
                · {visible.length}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            {hiddenSnoozedCount > 0 && (
              <button
                type="button"
                onClick={() => setShowSnoozed(s => !s)}
                className="btn btn-secondary"
                style={{ padding: '0.2rem 0.55rem', fontSize: '0.7rem' }}
                title="Toggle snoozed"
              >
                {showSnoozed ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                Snoozed ({hiddenSnoozedCount})
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAdd(s => !s)}
              className="btn btn-secondary"
              style={{ padding: '0.2rem 0.55rem', fontSize: '0.7rem' }}
              title="Add a task linked to this record"
            >
              <Plus size={11} /> Add task
            </button>
          </div>
        </div>
      )}

      {showAdd && (
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: '0.4rem', marginBottom: visible.length ? '0.5rem' : 0 }}>
          <input
            type="text"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder={placeholder}
            autoFocus
            style={{
              flex: 1,
              padding: '0.35rem 0.5rem',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border-light)',
              fontSize: '0.8rem',
            }}
          />
          <button type="submit" className="btn btn-primary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}>
            Add
          </button>
          <button
            type="button"
            onClick={() => { setShowAdd(false); setNewTitle(''); }}
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
          >
            Cancel
          </button>
        </form>
      )}

      {visible.length === 0 && !showAdd ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
          No open tasks for this {entityType}. Add one to track follow-ups against this record.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {visible.map(t => {
            const due = fmtDue(t.dueAt);
            const isSnoozed = t.status === 'snoozed';
            return (
              <li
                key={t.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem',
                  padding: '0.45rem 0.55rem',
                  background: 'var(--color-bg-card)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border-light)',
                  opacity: isSnoozed ? 0.7 : 1,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {t.title}
                    {t.priority === 'urgent' && (
                      <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: '#fef2f2', color: '#DC2626', border: '1px solid #fecaca' }}>URGENT</span>
                    )}
                    {t.priority === 'high' && (
                      <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a' }}>HIGH</span>
                    )}
                    {isSnoozed && (
                      <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' }}>SNOOZED</span>
                    )}
                  </div>
                  {(t.description || due) && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                      {due && <>Due {due}{t.description ? ' · ' : ''}</>}
                      {t.description}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button
                    type="button"
                    title="Snooze 24h"
                    aria-label="Snooze 24h"
                    onClick={() => doSnooze(t)}
                    className="btn btn-secondary"
                    style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem' }}
                  >
                    <Clock size={11} />
                  </button>
                  <button
                    type="button"
                    title="Dismiss"
                    aria-label="Dismiss"
                    onClick={() => doDismiss(t)}
                    className="btn btn-secondary"
                    style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem' }}
                  >
                    <X size={11} />
                  </button>
                  <button
                    type="button"
                    title="Complete"
                    aria-label="Complete"
                    onClick={() => doComplete(t)}
                    className="btn btn-secondary"
                    style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem', color: 'var(--color-success)', borderColor: 'var(--color-success)' }}
                  >
                    <Check size={11} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default RecordTasksPanel;
