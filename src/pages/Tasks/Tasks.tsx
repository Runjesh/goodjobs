import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { motion, useReducedMotion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { listItemEnterDelay } from '../../motion/variants';
import { useStore } from '../../store/useStore';
import { isVisibleToday, type Task, type TaskRelatedEntityType, type TaskRecurrence } from '../../utils/tasks';
import { inboxItemToTask, type InboxItemLike } from '../../utils/inboxToTask';

/**
 * Tasks page — a view onto the cross-module Tasks slice. Inbox flags fetched
 * from `/inbox` are mirrored into the slice via `upsertTaskByIntent` and
 * everything the page renders comes from `useStore(s => s.tasks)`.
 */

type InboxItem = InboxItemLike;

const FCRA_CATEGORIES = ['Administrative', 'Educational', 'Medical', 'General Welfare'];

type OwnerFilter = 'all' | 'mine' | 'field';
type EntityFilter = 'all' | TaskRelatedEntityType;

const ENTITY_FILTERS: { id: EntityFilter; label: string }[] = [
  { id: 'all',         label: 'All entities' },
  { id: 'donor',       label: 'Donors' },
  { id: 'grant',       label: 'Grants' },
  { id: 'csr',         label: 'CSR' },
  { id: 'beneficiary', label: 'Beneficiaries' },
  { id: 'compliance',  label: 'Compliance' },
];

const RECURRENCE_OPTIONS: { id: TaskRecurrence; label: string }[] = [
  { id: 'none',    label: 'No repeat' },
  { id: 'daily',   label: 'Daily' },
  { id: 'weekly',  label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

function entityRoute(t: Task): string | null {
  // If the task carries an explicit deep-link in meta, honour it first.
  if (t.meta?.link && typeof t.meta.link === 'string') return t.meta.link as string;
  if (!t.relatedEntityType || !t.relatedEntityId) return null;
  const id = encodeURIComponent(t.relatedEntityId);
  switch (t.relatedEntityType) {
    case 'donor':       return `/crm?donor=${id}`;
    case 'grant':       return `/grants/${id}`;
    case 'csr':         return `/csr?card=${id}`;
    case 'beneficiary': return `/programs?beneficiary=${id}`;
    case 'compliance':  return `/compliance?focus=${id}`;
    case 'campaign':    return `/funding?campaign=${id}`;
    case 'volunteer':   return `/volunteers?id=${id}`;
    default:            return null;
  }
}

const Tasks: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusIdx, setFocusIdx] = useState(0);
  const focusRowRef = useRef<HTMLDivElement | null>(null);
  const pendingDeepLinkScrollRef = useRef(false);
  const { currentRole } = useAuth();
  const canRunIntents = currentRole === 'ed';
  const reducedMotion = useReducedMotion();

  const sliceTasks         = useStore(s => s.tasks);
  const upsertTaskByIntent = useStore(s => s.upsertTaskByIntent);
  const addTask            = useStore(s => s.addTask);
  const completeTask       = useStore(s => s.completeTask);
  const snoozeTask         = useStore(s => s.snoozeTask);
  const dismissTask        = useStore(s => s.dismissTask);

  const [ownerFilter, setOwnerFilter]   = useState<OwnerFilter>('all');
  const [entityFilter, setEntityFilter] = useState<EntityFilter>('all');
  const [showSnoozed, setShowSnoozed]   = useState(false);
  const [showNewForm, setShowNewForm]   = useState(false);
  const userId = (user as { id?: string } | null | undefined)?.id ?? '';

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/inbox');
      if (!res.ok) throw new Error('inbox');
      const data = await res.json();
      const fetched: InboxItem[] = Array.isArray(data.items) ? data.items : [];
      // Mirror EVERY inbox flag into the slice — no skips. Items lacking
      // a ref id get a stable hash-derived id from inboxItemToTask().
      for (const it of fetched) {
        upsertTaskByIntent(inboxItemToTask(it));
      }
    } catch {
      toast.error('Failed to load tasks.');
    } finally {
      setLoading(false);
    }
  }, [upsertTaskByIntent]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Derived list ─────────────────────────────────────────────────────
  const visibleTasks = useMemo(() => {
    return sliceTasks.filter(t => {
      if (!showSnoozed && !isVisibleToday(t)) return false;
      if (showSnoozed && (t.status === 'done' || t.status === 'dismissed')) return false;
      // Mine = strictly owned by the current user. Tasks with no assignee
      // are visible only under "All" (or "Field worker" if applicable).
      if (ownerFilter === 'mine'  && (!userId || t.assignee !== userId)) return false;
      if (ownerFilter === 'field' && t.relatedEntityType !== 'beneficiary') return false;
      if (entityFilter !== 'all'  && t.relatedEntityType !== entityFilter) return false;
      return true;
    });
  }, [sliceTasks, showSnoozed, ownerFilter, entityFilter, userId]);

  // Deep-link focus support: ?focus=kind:refId scrolls to that task.
  useLayoutEffect(() => {
    if (loading) return;
    const raw = searchParams.get('focus');
    if (!raw) {
      setFocusIdx(i => (visibleTasks.length > 0 && i >= visibleTasks.length ? visibleTasks.length - 1 : i));
      return;
    }
    let token: string;
    try { token = decodeURIComponent(raw); } catch { token = raw; }
    const next = new URLSearchParams(searchParams);
    next.delete('focus');
    if (!visibleTasks.length) {
      setSearchParams(next, { replace: true });
      return;
    }
    const idx = visibleTasks.findIndex(t => t.sourceIntentId === `inbox:${token}` || t.id === token);
    if (idx >= 0) {
      pendingDeepLinkScrollRef.current = true;
      setFocusIdx(idx);
    }
    setSearchParams(next, { replace: true });
  }, [loading, visibleTasks, searchParams, setSearchParams]);

  useLayoutEffect(() => {
    if (loading || !visibleTasks.length || !pendingDeepLinkScrollRef.current) return;
    requestAnimationFrame(() => {
      const el = focusRowRef.current;
      if (!el || !pendingDeepLinkScrollRef.current) return;
      pendingDeepLinkScrollRef.current = false;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [focusIdx, loading, visibleTasks.length]);

  // ── Per-task actions (slice + best-effort backend sync) ──────────────
  const doComplete = useCallback((t: Task) => {
    const meta = (t.meta ?? {}) as { kind?: string; inbox?: InboxItem };
    const result = completeTask(t.id);
    if (!result) {
      // Dispatcher reported the side effect failed — task stays open.
      toast.error('Could not complete: linked record was not found.');
      return;
    }
    if (meta.kind && meta.inbox?.ref?.id) {
      apiFetch('/inbox/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: meta.kind, id: meta.inbox.ref.id }),
      }).catch(() => { /* best-effort */ });
    }
    toast.success('Task completed.');
  }, [completeTask]);

  const doSnooze = useCallback((t: Task, hours = 24) => {
    const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    snoozeTask(t.id, until);
    const meta = (t.meta ?? {}) as { kind?: string; inbox?: InboxItem };
    if (meta.kind && meta.inbox?.ref?.id) {
      apiFetch('/inbox/snooze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: meta.kind, id: meta.inbox.ref.id, until }),
      }).catch(() => { /* best-effort */ });
    }
    toast.success(`Snoozed for ${hours}h.`);
  }, [snoozeTask]);

  const doDismiss = useCallback((t: Task) => {
    dismissTask(t.id);
    toast.success('Dismissed.');
  }, [dismissTask]);

  // ── Selection / batch ────────────────────────────────────────────────
  const toggleSelect = (id: string) => setSelected(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const selectAll = () => {
    if (selected.size === visibleTasks.length) { setSelected(new Set()); return; }
    setSelected(new Set(visibleTasks.map(t => t.id)));
  };
  const batchComplete = () => {
    visibleTasks.filter(t => selected.has(t.id)).forEach(doComplete);
    setSelected(new Set());
  };
  const batchSnooze = () => {
    visibleTasks.filter(t => selected.has(t.id)).forEach(t => doSnooze(t));
    setSelected(new Set());
  };

  // ── Kind-specific inline actions (preserved from prior inbox UI) ─────
  const copyDraft = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success('Copied.'); }
    catch { toast.error('Copy failed.'); }
  };

  const logCsrTouch = async (cardId: string) => {
    try {
      const res = await apiFetch(`/csr/cards/${encodeURIComponent(cardId)}/touch`, { method: 'POST' });
      if (!res.ok) throw new Error('touch');
      toast.success('Logged touchpoint.');
    } catch { toast.error('Could not log CSR touch.'); }
  };

  const downloadUcDraft = async (company?: string, project?: string) => {
    try {
      const q = new URLSearchParams();
      if (company) q.set('company', company);
      if (project) q.set('project', project);
      const qs = q.toString();
      const res = await apiFetch(`/finance/uc.pdf${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error('uc');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'utilization_certificate_draft.pdf';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('UC draft downloaded.');
    } catch { toast.error('Failed to download UC.'); }
  };

  const sendWhatsappInline = async (t: Task) => {
    const inl = ((t.meta?.inbox as InboxItem | undefined)?.inline ?? {}) as Record<string, unknown> & { donor_ids?: string[]; template_id?: string; message?: string };
    if (!inl.donor_ids?.length) { toast.error('Nothing to send.'); return; }
    try {
      const res = await apiFetch('/crm/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'send', channel: 'whatsapp',
          donor_ids: inl.donor_ids, template_id: inl.template_id,
          message: (inl.message || '').toString(),
        }),
      });
      if (!res.ok) throw new Error('send');
      doComplete(t);
    } catch { toast.error('Send failed.'); }
  };

  const confirmFinanceTag = async (t: Task, category: string) => {
    const inboxMeta = (t.meta?.inbox as InboxItem | undefined)?.meta as { name?: string } | undefined;
    try {
      await apiFetch('/finance/journal-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: `FCRA tag — ${inboxMeta?.name || 'grant'}: ${category}`,
          amount: 0, entry_type: 'Expense', fund: 'General',
        }),
      }).catch(() => {});
      doComplete(t);
    } catch { toast.error('Could not complete finance action.'); }
  };

  const approveAndRunIntent = useCallback(async (t: Task) => {
    const inboxItem = t.meta?.inbox as InboxItem | undefined;
    const id = inboxItem?.ref?.id;
    if (!id || !canRunIntents) { toast.error('Only ED / admin can approve & run agents.'); return; }
    try {
      const dRes = await apiFetch(`/intent/queue/${encodeURIComponent(id)}/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' }),
      });
      if (!dRes.ok) throw new Error('decision');
      const xRes = await apiFetch(`/intent/queue/${encodeURIComponent(id)}/execute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: false }),
      });
      if (!xRes.ok) throw new Error('execute');
      doComplete(t);
    } catch { toast.error('Approve & run failed.'); }
  }, [canRunIntents, doComplete]);

  // ── Keyboard ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT') return;
      if (!visibleTasks.length) return;
      if (e.key === 'j' || e.key === 'J') { e.preventDefault(); setFocusIdx(i => Math.min(visibleTasks.length - 1, i + 1)); }
      else if (e.key === 'k' || e.key === 'K') { e.preventDefault(); setFocusIdx(i => Math.max(0, i - 1)); }
      else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); doComplete(visibleTasks[focusIdx]); }
      else if (e.key === 's' || e.key === 'S') { e.preventDefault(); doSnooze(visibleTasks[focusIdx]); }
      else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        const t = visibleTasks[focusIdx];
        if ((t.meta as { kind?: string })?.kind === 'intent' && canRunIntents) approveAndRunIntent(t);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visibleTasks, focusIdx, doComplete, doSnooze, approveAndRunIntent, canRunIntents]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>Tasks</div>
          <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
            Cross-module task list — sourced from agents, manual, and recurring rules. Resolve inline.
          </div>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" type="button" onClick={() => setShowNewForm(s => !s)}>
            {showNewForm ? 'Cancel' : '+ New task'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={selectAll}>
            {selected.size === visibleTasks.length && visibleTasks.length > 0 ? 'Clear selection' : 'Select all'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => refresh()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginBottom: '0.75rem' }}>
        <kbd>J</kbd>/<kbd>K</kbd> move · <kbd>D</kbd> done · <kbd>S</kbd> snooze 24h
        {canRunIntents && <> · <kbd>A</kbd> approve &amp; run focused intent</>}
      </div>

      {showNewForm && <NewTaskForm onCreate={addTask} onClose={() => setShowNewForm(false)} userId={userId} />}

      <div
        className="flex gap-2 items-center"
        style={{
          marginBottom: '0.75rem', padding: '0.5rem 0.7rem',
          borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border-light)',
          background: 'var(--color-bg-card)', flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-tertiary)' }}>FILTER</span>
        {(['all', 'mine', 'field'] as OwnerFilter[]).map(o => (
          <button
            key={o}
            type="button"
            className={`btn ${ownerFilter === o ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
            onClick={() => setOwnerFilter(o)}
          >
            {o === 'all' ? 'All' : o === 'mine' ? 'Mine' : 'Field worker'}
          </button>
        ))}
        <select
          className="btn btn-secondary"
          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
          value={entityFilter}
          onChange={e => setEntityFilter(e.target.value as EntityFilter)}
        >
          {ENTITY_FILTERS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <label style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={showSnoozed} onChange={e => setShowSnoozed(e.target.checked)} />
          Show snoozed
        </label>
        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
          {visibleTasks.length} task{visibleTasks.length === 1 ? '' : 's'}
        </span>
      </div>

      {selected.size > 0 && (
        <div
          className="flex gap-2 items-center"
          style={{
            marginBottom: '1rem', padding: '0.6rem 0.75rem',
            borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border-light)',
            background: 'var(--color-bg-main)', flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{selected.size} selected</span>
          <button className="btn btn-primary" type="button" onClick={batchComplete}>Complete all</button>
          <button className="btn btn-secondary" type="button" onClick={batchSnooze}>Snooze all 24h</button>
        </div>
      )}

      {loading && visibleTasks.length === 0 ? (
        <div className="grid gap-3" aria-busy="true">
          {[1, 2, 3].map(i => (
            <div key={i} style={{
              padding: '0.875rem', borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border-light)', background: 'var(--color-bg-card)',
            }}>
              <div style={{ height: 14, width: '55%', marginBottom: 8, borderRadius: 6, background: 'var(--color-bg-main)' }} />
              <div style={{ height: 12, width: '88%', borderRadius: 6, background: 'var(--color-bg-main)' }} />
            </div>
          ))}
        </div>
      ) : visibleTasks.length === 0 ? (
        <div style={{
          padding: '1.5rem', border: '1px solid var(--color-border-light)',
          borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-card)', textAlign: 'center',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>🎉</div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>All clear — nothing to do right now</div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
            New work will surface here automatically.
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {visibleTasks.map((t, idx) => (
            <TaskRow
              key={t.id}
              task={t}
              focused={idx === focusIdx}
              focusRef={idx === focusIdx ? focusRowRef : undefined}
              selected={selected.has(t.id)}
              onSelect={() => toggleSelect(t.id)}
              onComplete={() => doComplete(t)}
              onSnooze={(h) => doSnooze(t, h)}
              onDismiss={() => doDismiss(t)}
              onOpen={() => {
                const r = entityRoute(t);
                if (r) navigate(r);
              }}
              onApproveIntent={() => approveAndRunIntent(t)}
              onSendWhatsapp={() => sendWhatsappInline(t)}
              onConfirmFinance={(cat) => confirmFinanceTag(t, cat)}
              onCopyDraft={(text) => copyDraft(text)}
              onLogCsrTouch={(id) => logCsrTouch(id)}
              onDownloadUc={(c, p) => downloadUcDraft(c, p)}
              onMouseEnter={() => setFocusIdx(idx)}
              listIdx={idx}
              reducedMotion={!!reducedMotion}
              canRunIntents={canRunIntents}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── New-task form (with recurrence picker) ───────────────────────────────
const NewTaskForm: React.FC<{ onCreate: (t: Task) => void; onClose: () => void; userId: string }> = ({ onCreate, onClose, userId }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [recurrence, setRecurrence] = useState<TaskRecurrence>('none');
  const [entityType, setEntityType] = useState<TaskRelatedEntityType | ''>('');
  const [entityId, setEntityId] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { toast.error('Title is required.'); return; }
    const now = new Date().toISOString();
    const t: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: title.trim(),
      description: description.trim() || undefined,
      assignee: userId || undefined,
      status: 'open',
      sourceType: 'manual',
      recurrence,
      relatedEntityType: entityType || undefined,
      relatedEntityId: entityType && entityId.trim() ? entityId.trim() : undefined,
      createdAt: now,
      updatedAt: now,
    };
    onCreate(t);
    toast.success('Task created.');
    onClose();
  };

  return (
    <form
      onSubmit={submit}
      style={{
        marginBottom: '0.75rem', padding: '0.85rem',
        borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border-light)',
        background: 'var(--color-bg-card)', display: 'grid', gap: '0.5rem',
      }}
    >
      <input
        type="text" placeholder="Task title" value={title}
        onChange={e => setTitle(e.target.value)} autoFocus
        style={{ padding: '0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-light)' }}
      />
      <textarea
        placeholder="Description (optional)" value={description}
        onChange={e => setDescription(e.target.value)} rows={2}
        style={{ padding: '0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-light)' }}
      />
      <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
          Repeat:{' '}
          <select value={recurrence} onChange={e => setRecurrence(e.target.value as TaskRecurrence)} style={{ padding: '0.3rem' }}>
            {RECURRENCE_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        <label style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
          Linked to:{' '}
          <select value={entityType} onChange={e => setEntityType(e.target.value as TaskRelatedEntityType | '')} style={{ padding: '0.3rem' }}>
            <option value="">— none —</option>
            <option value="donor">Donor</option>
            <option value="grant">Grant</option>
            <option value="csr">CSR</option>
            <option value="beneficiary">Beneficiary</option>
            <option value="compliance">Compliance doc</option>
          </select>
        </label>
        {entityType && (
          <input
            type="text" placeholder="Entity id" value={entityId}
            onChange={e => setEntityId(e.target.value)}
            style={{ padding: '0.35rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-light)' }}
          />
        )}
        <div style={{ marginLeft: 'auto' }} className="flex gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Create</button>
        </div>
      </div>
    </form>
  );
};

// ── Single task row ──────────────────────────────────────────────────────
interface TaskRowProps {
  task: Task;
  focused: boolean;
  focusRef?: React.RefObject<HTMLDivElement | null>;
  selected: boolean;
  onSelect: () => void;
  onComplete: () => void;
  onSnooze: (hours: number) => void;
  onDismiss: () => void;
  onOpen: () => void;
  onApproveIntent: () => void;
  onSendWhatsapp: () => void;
  onConfirmFinance: (cat: string) => void;
  onCopyDraft: (text: string) => void;
  onLogCsrTouch: (id: string) => void;
  onDownloadUc: (company?: string, project?: string) => void;
  onMouseEnter: () => void;
  listIdx: number;
  reducedMotion: boolean;
  canRunIntents: boolean;
}

const TaskRow: React.FC<TaskRowProps> = ({
  task, focused, focusRef, selected, onSelect, onComplete, onSnooze, onDismiss, onOpen,
  onApproveIntent, onSendWhatsapp, onConfirmFinance, onCopyDraft, onLogCsrTouch, onDownloadUc,
  onMouseEnter, listIdx, reducedMotion, canRunIntents,
}) => {
  const inbox = task.meta?.inbox as InboxItem | undefined;
  const kind = (task.meta?.kind as string | undefined) ?? '';
  const inl = (inbox?.inline ?? {}) as Record<string, unknown> & {
    type?: string; suggested_category?: string; confidence?: number;
    card_id?: string; draft_message?: string; company?: string; project?: string; hint?: string;
    donor_ids?: string[];
  };
  const hasOpen = !!task.relatedEntityType && !!task.relatedEntityId;
  const isSnoozed = task.status === 'snoozed';

  return (
    <motion.div
      ref={focusRef}
      role="listitem"
      onMouseEnter={onMouseEnter}
      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{
        opacity: 1, y: 0,
        transition: reducedMotion
          ? { duration: 0 }
          : { duration: 0.28, ease: [0, 0, 0.2, 1], delay: listItemEnterDelay(listIdx) },
      }}
      style={{
        padding: '0.875rem',
        border: focused ? '2px solid var(--color-primary)' : '1px solid var(--color-border-light)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-bg-card)',
        display: 'flex', gap: '1rem', alignItems: 'flex-start',
        justifyContent: 'space-between', flexWrap: 'wrap',
        opacity: isSnoozed ? 0.7 : 1,
      }}
    >
      <div style={{ minWidth: 0, flex: '1 1 240px' }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 4, flexWrap: 'wrap' }}>
          <input type="checkbox" checked={selected} onChange={onSelect} aria-label="Select" />
          <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{task.title}</div>
          {task.recurrence && task.recurrence !== 'none' && (
            <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: 999, background: 'var(--color-bg-main)', color: 'var(--color-text-secondary)' }}>
              repeats {task.recurrence}
            </span>
          )}
          {isSnoozed && (
            <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: 999, background: 'var(--color-warning)', color: 'white' }}>
              snoozed
            </span>
          )}
          {task.sourceType === 'inbox' && kind && (
            <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: 999, background: 'var(--color-bg-main)', color: 'var(--color-text-tertiary)' }}>
              {kind}
            </span>
          )}
        </div>
        {task.description && (
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', lineHeight: 1.35 }}>
            {task.description}
          </div>
        )}
        {task.relatedEntityType && (
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
            → {task.relatedEntityType}{task.relatedEntityId ? ` · ${task.relatedEntityId}` : ''}
            {task.onCompleteAction && <> · auto-acts on complete</>}
          </div>
        )}

        {/* Kind-specific inline UI, preserved from prior inbox page. */}
        {kind === 'finance_flag' && inl.type === 'finance_classification' && (
          <div style={{ marginTop: '0.65rem' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>
              Finance Agent suggestion ({Math.round((inl.confidence || 0) * 100)}% confidence)
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <select
                className="btn btn-secondary"
                style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                defaultValue={inl.suggested_category || 'General Welfare'}
                id={`fcat-${task.id}`}
              >
                {FCRA_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button
                className="btn btn-primary" type="button"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                onClick={() => {
                  const sel = document.getElementById(`fcat-${task.id}`) as HTMLSelectElement | null;
                  onConfirmFinance(sel?.value || inl.suggested_category || 'General Welfare');
                }}
              >
                Confirm tag &amp; done
              </button>
            </div>
          </div>
        )}

        {kind === 'intent' && canRunIntents && (
          <div style={{ marginTop: '0.5rem' }}>
            <button
              className="btn btn-primary" type="button"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
              onClick={onApproveIntent}
            >
              Approve &amp; run
            </button>
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginLeft: 8 }}>
              {inl.hint || ''}
            </span>
          </div>
        )}

        {kind === 'donor_outreach_draft' && inl.type === 'crm_whatsapp' && (
          <div style={{ marginTop: '0.5rem' }}>
            <button
              className="btn btn-primary" type="button"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
              onClick={onSendWhatsapp}
            >
              Approve &amp; send WhatsApp
            </button>
          </div>
        )}

        {(kind === 'csr_win_decay' || kind === 'csr_stale') && inl.type === 'csr_followup' && inl.card_id && (
          <div style={{ marginTop: '0.65rem' }}>
            <div style={{
              fontSize: '0.8rem', color: 'var(--color-text-secondary)',
              background: 'var(--color-bg-main)', padding: '0.5rem 0.65rem',
              borderRadius: 'var(--radius-md)', marginBottom: '0.5rem',
              whiteSpace: 'pre-wrap', lineHeight: 1.35,
            }}>
              {(inl.draft_message || '').toString()}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <button
                className="btn btn-secondary" type="button"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                onClick={() => onCopyDraft((inl.draft_message || '').toString())}
              >
                Copy draft
              </button>
              <button
                className="btn btn-secondary" type="button"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                onClick={() => onLogCsrTouch(inl.card_id!)}
              >
                Log touch
              </button>
            </div>
          </div>
        )}

        {kind === 'csr_report_due' && inl.type === 'csr_uc' && (
          <div style={{ marginTop: '0.65rem' }} className="flex flex-wrap gap-2 items-center">
            <button
              className="btn btn-primary" type="button"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
              onClick={() => onDownloadUc((inl.company || '').toString(), (inl.project || '').toString())}
            >
              Download UC draft
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-2" style={{ flexShrink: 0, flexWrap: 'wrap' }}>
        {hasOpen && (
          <button className="btn btn-secondary" type="button" onClick={onOpen}>
            Open
          </button>
        )}
        <button className="btn btn-secondary" type="button" onClick={() => onSnooze(24)}>
          Snooze 24h
        </button>
        <button className="btn btn-secondary" type="button" onClick={onDismiss}>
          Dismiss
        </button>
        <button
          className="btn btn-secondary" type="button"
          style={{ color: 'var(--color-success)', borderColor: 'var(--color-success)' }}
          onClick={onComplete}
        >
          Complete
        </button>
      </div>
    </motion.div>
  );
};

export default Tasks;
