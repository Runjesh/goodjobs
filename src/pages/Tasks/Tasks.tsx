import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { motion, useReducedMotion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { listItemEnterDelay } from '../../motion/variants';
import { tasksInboxHref } from '../../utils/inboxLinks';

type InboxItem = {
  kind: string;
  title?: string;
  subtitle?: string;
  pill?: string;
  priority?: string;
  priority_score?: number;
  primary_action?: { label?: string; route?: string };
  ref?: { id?: string };
  meta?: Record<string, unknown>;
  inline?: {
    type?: string;
    suggested_category?: string;
    confidence?: number;
    donor_ids?: string[];
    message?: string;
    template_id?: string;
    hint?: string;
    card_id?: string;
    draft_message?: string;
    company?: string;
    project?: string;
  };
};

const FCRA_CATEGORIES = ['Administrative', 'Educational', 'Medical', 'General Welfare'];

const Tasks: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusIdx, setFocusIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const focusRowRef = useRef<HTMLDivElement | null>(null);
  const pendingDeepLinkScrollRef = useRef(false);
  const role = user?.role as string | undefined;
  const canRunIntents = role === 'ed' || role === 'admin';
  const reducedMotion = useReducedMotion();

  const itemKey = useCallback((it: InboxItem, idx: number) => `${it.kind}:${it.ref?.id ?? idx}`, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/inbox');
      if (!res.ok) throw new Error('inbox');
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      toast.error('Failed to load tasks.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useLayoutEffect(() => {
    if (loading) return;
    const raw = searchParams.get('focus');
    if (!raw) {
      setFocusIdx(i => (items.length > 0 && i >= items.length ? items.length - 1 : i));
      return;
    }
    const token = decodeURIComponent(raw);
    const next = new URLSearchParams(searchParams);
    next.delete('focus');
    if (!items.length) {
      setSearchParams(next, { replace: true });
      toast.error('Inbox is empty — nothing to focus.');
      return;
    }
    const idx = items.findIndex((it, i) => itemKey(it, i) === token);
    if (idx >= 0) {
      pendingDeepLinkScrollRef.current = true;
      setFocusIdx(idx);
    } else {
      setFocusIdx(0);
      toast.error('That inbox item is gone (resolved, snoozed, or expired).');
    }
    setSearchParams(next, { replace: true });
  }, [loading, items, searchParams, setSearchParams, itemKey]);

  useLayoutEffect(() => {
    if (loading || !items.length || !pendingDeepLinkScrollRef.current) return;
    requestAnimationFrame(() => {
      const el = focusRowRef.current;
      if (!el || !pendingDeepLinkScrollRef.current) return;
      pendingDeepLinkScrollRef.current = false;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [focusIdx, loading, items.length]);

  const toggleSelect = (it: InboxItem, idx: number) => {
    const k = itemKey(it, idx);
    setSelected(prev => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  };

  const selectAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(items.map((it, i) => itemKey(it, i))));
  };

  const applyLocalRemove = (it: InboxItem, idx: number) => {
    const k = itemKey(it, idx);
    setItems(prev => prev.filter((x, i) => itemKey(x, i) !== k));
    setSelected(prev => {
      const n = new Set(prev);
      n.delete(k);
      return n;
    });
  };

  const snooze24h = useCallback(
    async (it: InboxItem, idx: number, optimistic = true) => {
      const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      if (optimistic) applyLocalRemove(it, idx);
      try {
        const res = await apiFetch('/inbox/snooze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: it.kind, id: it.ref?.id, until }),
        });
        if (!res.ok) throw new Error('snooze');
        toast.success('Snoozed for 24h.');
        if (!optimistic) refresh();
      } catch {
        toast.error('Failed to snooze.');
        refresh();
      }
    },
    [refresh, applyLocalRemove]
  );

  const markDone = useCallback(
    async (it: InboxItem, idx: number, optimistic = true) => {
      if (optimistic) applyLocalRemove(it, idx);
      try {
        const res = await apiFetch('/inbox/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: it.kind, id: it.ref?.id }),
        });
        if (!res.ok) throw new Error('resolve');
        toast.success('Done.');
        if (!optimistic) refresh();
      } catch {
        toast.error('Failed to mark done.');
        refresh();
      }
    },
    [refresh, applyLocalRemove]
  );

  const batchApproveIntents = useCallback(async () => {
    const targets = items
      .map((it, idx) => ({ it, idx }))
      .filter(({ it, idx }) => it.kind === 'intent' && selected.has(itemKey(it, idx)) && it.ref?.id);
    if (!targets.length) {
      toast.error('Select one or more agent (intent) rows.');
      return;
    }
    if (!canRunIntents) {
      toast.error('Only ED / admin can approve & run agents.');
      return;
    }
    targets.forEach(({ it, idx }) => applyLocalRemove(it, idx));
    setSelected(new Set());
    let ok = 0;
    await Promise.all(
      targets.map(async ({ it }) => {
        const id = it.ref?.id;
        if (!id) return;
        try {
          const dRes = await apiFetch(`/intent/queue/${encodeURIComponent(id)}/decision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: 'approved' }),
          });
          if (!dRes.ok) return;
          const xRes = await apiFetch(`/intent/queue/${encodeURIComponent(id)}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dry_run: false }),
          });
          if (xRes.ok) ok += 1;
        } catch {
          /* per-item */
        }
      })
    );
    toast.success(`Approved & ran ${ok} / ${targets.length} agent action(s).`);
    if (ok < targets.length) refresh();
  }, [items, selected, canRunIntents, itemKey, applyLocalRemove, refresh]);

  const approveAndRunIntent = useCallback(async (it: InboxItem, idx: number) => {
    const id = it.ref?.id;
    if (!id || !canRunIntents) {
      toast.error('Only ED / admin can approve & run agents.');
      return;
    }
    applyLocalRemove(it, idx);
    try {
      const dRes = await apiFetch(`/intent/queue/${encodeURIComponent(id)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' }),
      });
      if (!dRes.ok) throw new Error('decision');
      const xRes = await apiFetch(`/intent/queue/${encodeURIComponent(id)}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: false }),
      });
      if (!xRes.ok) throw new Error('execute');
      toast.success('Agent run completed.');
    } catch {
      toast.error('Approve & run failed.');
      refresh();
    }
  }, [canRunIntents, refresh, applyLocalRemove]);

  const copyDraft = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard.');
    } catch {
      toast.error('Copy failed.');
    }
  };

  const logCsrTouch = async (cardId: string) => {
    try {
      const res = await apiFetch(`/csr/cards/${encodeURIComponent(cardId)}/touch`, { method: 'POST' });
      if (!res.ok) throw new Error('touch');
      toast.success('Logged touchpoint — refresh Tasks to update nudges.');
    } catch {
      toast.error('Could not log CSR touch.');
    }
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
    } catch {
      toast.error('Failed to download UC.');
    }
  };

  const sendWhatsappInline = async (it: InboxItem, idx: number) => {
    const inl = it.inline;
    if (!inl?.donor_ids?.length) {
      toast.error('Nothing to send.');
      return;
    }
    applyLocalRemove(it, idx);
    try {
      const res = await apiFetch('/crm/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'send',
          channel: 'whatsapp',
          donor_ids: inl.donor_ids,
          template_id: inl.template_id,
          message: (inl.message || '').toString(),
        }),
      });
      if (!res.ok) throw new Error('send');
      await apiFetch('/inbox/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: it.kind, id: it.ref?.id }),
      });
      toast.success('WhatsApp queued and inbox cleared.');
    } catch {
      toast.error('Send failed.');
      refresh();
    }
  };

  const confirmFinanceTag = async (it: InboxItem, idx: number, category: string) => {
    applyLocalRemove(it, idx);
    try {
      const meta = (it.meta || {}) as { name?: string };
      await apiFetch('/finance/journal-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: `FCRA tag — ${meta.name || 'grant'}: ${category}`,
          amount: 0,
          entry_type: 'Expense',
          fund: 'General',
        }),
      }).catch(() => {});
      const res = await apiFetch('/inbox/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: it.kind, id: it.ref?.id }),
      });
      if (!res.ok) throw new Error('resolve');
      toast.success(`Tagged as ${category} — marked done.`);
    } catch {
      toast.error('Could not complete finance action.');
      refresh();
    }
  };

  const batchSnooze = async () => {
    const targets = items.filter((it, i) => selected.has(itemKey(it, i)));
    if (!targets.length) return;
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    setItems(prev => prev.filter((it, i) => !selected.has(itemKey(it, i))));
    setSelected(new Set());
    try {
      const res = await apiFetch('/inbox/batch-snooze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          until,
          items: targets.map(t => ({ kind: t.kind, id: t.ref?.id })),
        }),
      });
      if (!res.ok) throw new Error('batch');
      toast.success('Snoozed selected for 24h.');
    } catch {
      toast.error('Batch snooze failed.');
      refresh();
    }
  };

  const batchDone = async () => {
    const targets = items.filter((it, i) => selected.has(itemKey(it, i)));
    if (!targets.length) return;
    setItems(prev => prev.filter((it, i) => !selected.has(itemKey(it, i))));
    setSelected(new Set());
    try {
      const res = await apiFetch('/inbox/batch-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: targets.map(t => ({ kind: t.kind, id: t.ref?.id })),
        }),
      });
      if (!res.ok) throw new Error('batch');
      toast.success('Marked selected as done.');
    } catch {
      toast.error('Batch done failed.');
      refresh();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      if (!items.length) return;
      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        setFocusIdx(i => Math.min(items.length - 1, i + 1));
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        setFocusIdx(i => Math.max(0, i - 1));
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        const it = items[focusIdx];
        if (it) markDone(it, focusIdx);
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        const it = items[focusIdx];
        if (it) snooze24h(it, focusIdx);
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        const it = items[focusIdx];
        if (it?.kind === 'intent' && canRunIntents) approveAndRunIntent(it, focusIdx);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, focusIdx, canRunIntents, markDone, snooze24h, approveAndRunIntent]);

  const helpBar = useMemo(
    () => (
      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginBottom: '0.75rem' }}>
        <kbd style={{ opacity: 0.85 }}>J</kbd>/<kbd>K</kbd> move · <kbd>D</kbd> done · <kbd>S</kbd> snooze 24h
        {canRunIntents ? (
          <>
            {' '}
            · <kbd>A</kbd> approve & run (focused intent) · multi-select → Approve agents
          </>
        ) : null}
      </div>
    ),
    [canRunIntents]
  );

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }} ref={listRef}>
      <div className="flex items-center justify-between" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>Tasks</div>
          <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
            Unified inbox — highest-impact items first. Resolve inline without opening modules.
          </div>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" type="button" onClick={selectAll}>
            {selected.size === items.length && items.length > 0 ? 'Clear selection' : 'Select all'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => refresh()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {helpBar}

      {selected.size > 0 && (
        <div
          className="flex gap-2 items-center"
          style={{
            marginBottom: '1rem',
            padding: '0.6rem 0.75rem',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border-light)',
            background: 'var(--color-bg-main)',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{selected.size} selected</span>
          <button className="btn btn-primary" type="button" onClick={batchDone}>
            Done all
          </button>
          <button className="btn btn-secondary" type="button" onClick={batchSnooze}>
            Snooze all 24h
          </button>
          {canRunIntents && items.some((it, i) => it.kind === 'intent' && selected.has(itemKey(it, i))) ? (
            <button className="btn btn-primary" type="button" onClick={() => void batchApproveIntents()}>
              Approve &amp; run agents (selected)
            </button>
          ) : null}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="grid gap-3" aria-busy="true">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              style={{
                padding: '0.875rem',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-border-light)',
                background: 'var(--color-bg-card)',
              }}
            >
              <div className="skeleton-line" style={{ height: 14, width: '55%', marginBottom: 8, borderRadius: 6, background: 'var(--color-bg-main)' }} />
              <div className="skeleton-line" style={{ height: 12, width: '88%', borderRadius: 6, background: 'var(--color-bg-main)' }} />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div
          style={{
            padding: '1.5rem',
            border: '1px solid var(--color-border-light)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--color-bg-card)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>🎉</div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>All clear — agents are handling the rest</div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
            Nothing needs your attention right now. New work will surface here automatically.
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((it, idx) => {
            const k = itemKey(it, idx);
            const focused = idx === focusIdx;
            const score = it.priority_score != null ? Math.round(it.priority_score) : null;
            return (
              <motion.div
                key={k}
                ref={idx === focusIdx ? focusRowRef : undefined}
                role="listitem"
                initial={reducedMotion ? false : { opacity: 0, y: 12 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: reducedMotion
                    ? { duration: 0 }
                    : { duration: 0.28, ease: [0, 0, 0.2, 1], delay: listItemEnterDelay(idx) },
                }}
                style={{
                  padding: '0.875rem',
                  border: focused ? '2px solid var(--color-primary)' : '1px solid var(--color-border-light)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--color-bg-card)',
                  display: 'flex',
                  gap: '1rem',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                }}
                onMouseEnter={() => setFocusIdx(idx)}
              >
                <div style={{ minWidth: 0, flex: '1 1 240px' }}>
                  <div className="flex items-center gap-2" style={{ marginBottom: 4, flexWrap: 'wrap' }}>
                    <input
                      type="checkbox"
                      checked={selected.has(k)}
                      onChange={() => toggleSelect(it, idx)}
                      aria-label="Select for batch"
                    />
                    <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{it.title || 'Task'}</div>
                    {score != null && (
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          padding: '0.1rem 0.45rem',
                          borderRadius: 999,
                          background: 'var(--color-bg-main)',
                          color: 'var(--color-text-secondary)',
                        }}
                        title="Auto priority score"
                      >
                        Score {score}
                      </span>
                    )}
                    {it.pill && (
                      <span
                        style={{
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          padding: '0.15rem 0.5rem',
                          borderRadius: 999,
                          background: 'var(--color-bg-main)',
                          border: '1px solid var(--color-border-light)',
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        {it.pill}
                      </span>
                    )}
                  </div>
                  {it.subtitle && (
                    <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', lineHeight: 1.35 }}>
                      {it.subtitle}
                    </div>
                  )}

                  {it.kind === 'finance_flag' && it.inline?.type === 'finance_classification' && (
                    <div style={{ marginTop: '0.65rem' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>
                        Finance Agent suggestion ({Math.round((it.inline.confidence || 0) * 100)}% confidence)
                      </div>
                      <div className="flex flex-wrap gap-2 items-center">
                        <select
                          className="btn btn-secondary"
                          style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                          defaultValue={it.inline.suggested_category || 'General Welfare'}
                          id={`fcat-${k}`}
                        >
                          {FCRA_CATEGORIES.map(c => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn btn-primary"
                          type="button"
                          style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                          onClick={() => {
                            const sel = document.getElementById(`fcat-${k}`) as HTMLSelectElement | null;
                            confirmFinanceTag(it, idx, sel?.value || it.inline?.suggested_category || 'General Welfare');
                          }}
                        >
                          Confirm tag & done
                        </button>
                      </div>
                    </div>
                  )}

                  {it.kind === 'intent' && canRunIntents && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <button
                        className="btn btn-primary"
                        type="button"
                        style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                        onClick={() => approveAndRunIntent(it, idx)}
                      >
                        Approve & run
                      </button>
                      <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginLeft: 8 }}>
                        {it.inline?.hint || ''}
                      </span>
                    </div>
                  )}

                  {it.kind === 'donor_outreach_draft' && it.inline?.type === 'crm_whatsapp' && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <button
                        className="btn btn-primary"
                        type="button"
                        style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                        onClick={() => sendWhatsappInline(it, idx)}
                      >
                        Approve & send WhatsApp
                      </button>
                    </div>
                  )}

                  {(it.kind === 'csr_win_decay' || it.kind === 'csr_stale') && it.inline?.type === 'csr_followup' && it.inline.card_id && (
                    <div style={{ marginTop: '0.65rem' }}>
                      <div
                        style={{
                          fontSize: '0.8rem',
                          color: 'var(--color-text-secondary)',
                          background: 'var(--color-bg-main)',
                          padding: '0.5rem 0.65rem',
                          borderRadius: 'var(--radius-md)',
                          marginBottom: '0.5rem',
                          whiteSpace: 'pre-wrap',
                          lineHeight: 1.35,
                        }}
                      >
                        {(it.inline.draft_message || '').toString()}
                      </div>
                      <div className="flex flex-wrap gap-2 items-center">
                        <button
                          className="btn btn-secondary"
                          type="button"
                          style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                          onClick={() => copyDraft((it.inline?.draft_message || '').toString())}
                        >
                          Copy draft
                        </button>
                        <button
                          className="btn btn-secondary"
                          type="button"
                          style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                          onClick={() => logCsrTouch(it.inline!.card_id!)}
                        >
                          Log touch
                        </button>
                        <button
                          className="btn btn-primary"
                          type="button"
                          style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                          onClick={() => markDone(it, idx)}
                        >
                          Mark done
                        </button>
                      </div>
                    </div>
                  )}

                  {it.kind === 'csr_report_due' && it.inline?.type === 'csr_uc' && (
                    <div style={{ marginTop: '0.65rem' }} className="flex flex-wrap gap-2 items-center">
                      <button
                        className="btn btn-primary"
                        type="button"
                        style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                        onClick={() =>
                          downloadUcDraft(
                            (it.inline?.company || '').toString(),
                            (it.inline?.project || '').toString()
                          )
                        }
                      >
                        Download UC draft
                      </button>
                      <button
                        className="btn btn-secondary"
                        type="button"
                        style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                        onClick={() => navigate('/csr')}
                      >
                        Open CSR
                      </button>
                    </div>
                  )}

                  {it.kind === 'month_end_close' && (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--color-text-tertiary)' }}>
                      Checklist: grant utilization, bank reconciliation, FCRA admin cap — then mark done here.
                    </div>
                  )}
                </div>

                <div className="flex gap-2" style={{ flexShrink: 0, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => {
                      const r = it.primary_action?.route;
                      if (!r) return;
                      const p = r.startsWith('/') ? r : `/${r}`;
                      if (p === '/tasks') navigate(tasksInboxHref(it.kind, it.ref?.id));
                      else navigate(p);
                    }}
                  >
                    {it.primary_action?.label || 'Open'}
                  </button>
                  <button className="btn btn-secondary" type="button" onClick={() => snooze24h(it, idx)}>
                    Snooze
                  </button>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    style={{ color: 'var(--color-success)', borderColor: 'var(--color-success)' }}
                    onClick={() => markDone(it, idx)}
                  >
                    Done
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Tasks;
