import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiFetch } from '../../api/client';

type InboxItem = {
  kind: 'intent' | 'compliance_doc';
  title?: string;
  subtitle?: string;
  pill?: string;
  severity?: 'low' | 'medium' | 'high';
  primary_action?: { label?: string; route?: string };
  ref?: { id?: string };
};

const Tasks: React.FC = () => {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
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
  };

  useEffect(() => {
    refresh();
  }, []);

  const snooze24h = async (it: InboxItem) => {
    try {
      const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const res = await apiFetch('/inbox/snooze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: it.kind, id: it.ref?.id, until }),
      });
      if (!res.ok) throw new Error('snooze');
      toast.success('Snoozed for 24h.');
      refresh();
    } catch {
      toast.error('Failed to snooze.');
    }
  };

  const markDone = async (it: InboxItem) => {
    try {
      const res = await apiFetch('/inbox/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: it.kind, id: it.ref?.id }),
      });
      if (!res.ok) throw new Error('resolve');
      toast.success('Done.');
      refresh();
    } catch {
      toast.error('Failed to mark done.');
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: '1rem' }}>
        <div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>Tasks</div>
          <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
            Your unified inbox across fundraising, compliance, and agent approvals.
          </div>
        </div>
        <button className="btn btn-secondary" onClick={refresh} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loading && items.length === 0 ? (
        <div style={{ padding: '1rem', color: 'var(--color-text-tertiary)' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: '1rem', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-lg)', background: 'white' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Nothing pending</div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
            When something needs attention, it will appear here with one-click actions.
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((it, idx) => (
            <div
              key={idx}
              style={{
                padding: '0.875rem',
                border: '1px solid var(--color-border-light)',
                borderRadius: 'var(--radius-lg)',
                background: 'white',
                display: 'flex',
                gap: '1rem',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="flex items-center gap-2" style={{ marginBottom: 4, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{it.title || 'Task'}</div>
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
              </div>

              <div className="flex gap-2" style={{ flexShrink: 0 }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    if (it.primary_action?.route) window.location.hash = it.primary_action.route;
                  }}
                >
                  {it.primary_action?.label || 'Open'}
                </button>
                <button className="btn btn-secondary" onClick={() => snooze24h(it)}>
                  Snooze
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ color: 'var(--color-success)', borderColor: 'var(--color-success)' }}
                  onClick={() => markDone(it)}
                >
                  Done
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Tasks;

