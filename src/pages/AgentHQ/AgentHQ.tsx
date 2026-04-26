import React, { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Bot, CheckCircle, ShieldAlert, Activity, Cpu, XCircle, Check, Eye,
  Search, Settings, Sliders, Pause, Play, BarChart2
} from 'lucide-react';
import toast from 'react-hot-toast';
import './AgentHQ.css';
import { apiFetch } from '../../api/client';

type QueueItem = {
  id: string;
  directive: string;
  intent_type?: string;
  risk_level?: string;
  status: string;
  action_card?: any;
  created_at?: string;
  agent_confidence?: number;
  auto_resolve_hours?: number | null;
};

const AgentHQ: React.FC = () => {
  const [approvals, setApprovals] = useState<QueueItem[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'queue' | 'metrics' | 'config'>('queue');
  const [configs, setConfigs] = useState<any[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [summary, setSummary] = useState<{
    pending_approvals: number;
    agent_streaks?: { name: string; correct_in_row: number; rejections_30d: number }[];
    alerts?: { severity: string; message: string }[];
    auto_approve_max_inr?: number | null;
  } | null>(null);
  const [thresholdInr, setThresholdInr] = useState('');
  const [batchRunning, setBatchRunning] = useState(false);
  const [logSearch, setLogSearch] = useState('');

  const loadApprovals = async () => {
    setApprovalsLoading(true);
    try {
      const res = await apiFetch('/intent/queue?status=queued&limit=50');
      if (!res.ok) throw new Error('queue failed');
      const data = await res.json();
      setApprovals(Array.isArray(data.items) ? data.items : []);
    } catch {
      toast.error('Failed to load intent queue.');
    } finally {
      setApprovalsLoading(false);
    }
  };

  useEffect(() => {
    loadApprovals();
    (async () => {
      try {
        const res = await apiFetch('/agent-hq/summary');
        if (res.ok) {
          const data = await res.json();
          setAgents(Array.isArray(data.agents) ? data.agents : []);
          setSummary(data);
          if (data.auto_approve_max_inr != null) setThresholdInr(String(data.auto_approve_max_inr));
        }
      } catch {
        // ignore
      }
      try {
        const res = await apiFetch('/agent-hq/audit');
        if (res.ok) {
          const data = await res.json();
          setAuditLogs(Array.isArray(data.logs) ? data.logs : []);
        }
      } catch {
        // ignore
      }
      // config is not persisted yet; keep empty state rather than dummy values
      setConfigs([]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApprove = async (id: string) => {
    try {
      const res = await apiFetch(`/intent/queue/${encodeURIComponent(id)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' }),
      });
      if (!res.ok) throw new Error('approve failed');
      const execRes = await apiFetch(`/intent/queue/${encodeURIComponent(id)}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: false }),
      });
      if (!execRes.ok) throw new Error('execute failed');
      const execData = await execRes.json();
      toast.success('Executed.');
      setApprovals(prev => prev.filter(a => a.id !== id));
      console.log('Execution result:', execData);
    } catch {
      toast.error('Failed to approve/execute.');
    }
  };

  const handleBatchApprove = async () => {
    if (approvals.length === 0) return;
    setBatchRunning(true);
    let ok = 0;
    try {
      for (const a of approvals) {
        try {
          const res = await apiFetch(`/intent/queue/${encodeURIComponent(a.id)}/decision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: 'approved' }),
          });
          if (!res.ok) continue;
          const execRes = await apiFetch(`/intent/queue/${encodeURIComponent(a.id)}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dry_run: false }),
          });
          if (execRes.ok) ok += 1;
        } catch {
          /* continue */
        }
      }
      toast.success(`Approved & executed ${ok} / ${approvals.length}.`);
      await loadApprovals();
    } finally {
      setBatchRunning(false);
    }
  };

  const saveThreshold = async () => {
    const n = parseInt(thresholdInr.replace(/,/g, ''), 10);
    if (Number.isNaN(n) || n < 0) {
      toast.error('Enter a valid rupee amount.');
      return;
    }
    try {
      const res = await apiFetch('/agent-hq/prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_approve_max_inr: n }),
      });
      if (!res.ok) throw new Error('prefs');
      toast.success('Auto-approve threshold saved (session).');
    } catch {
      toast.error('Could not save threshold.');
    }
  };

  const handleReject = async (id: string) => {
    try {
      const res = await apiFetch(`/intent/queue/${encodeURIComponent(id)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'rejected' }),
      });
      if (!res.ok) throw new Error('reject failed');
      toast.success('Rejected.');
      setApprovals(prev => prev.filter(a => a.id !== id));
    } catch {
      toast.error('Failed to reject.');
    }
  };

  const filteredLogs = auditLogs.filter((l: any) =>
    !logSearch ||
    (l.type || '').toString().toLowerCase().includes(logSearch.toLowerCase()) ||
    (l.created_at || '').toString().toLowerCase().includes(logSearch.toLowerCase())
  );

  const auditScrollRef = useRef<HTMLDivElement>(null);
  const auditVirtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => auditScrollRef.current,
    estimateSize: () => 44,
    overscan: 14,
  });

  return (
    <div className="agent-hq-container">
      {summary?.alerts && summary.alerts.length > 0 && (
        <div
          className="card"
          style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            borderLeft: '4px solid var(--color-warning)',
            background: 'var(--color-bg-card)',
          }}
        >
          {summary.alerts.map((al, i) => (
            <div key={i} style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
              <strong style={{ color: 'var(--color-warning)' }}>Agent check:</strong> {al.message}
            </div>
          ))}
        </div>
      )}
      <div className="page-header">
        <div>
          <h1 className="page-title text-gradient flex items-center gap-2">
            <Cpu size={28} /> GoodJobs Copilot (Agent HQ)
          </h1>
          <p className="page-subtitle">Monitor autonomous actions, approve high-stakes tasks, and configure agent behaviour.</p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={async () => {
            toast('Triggering Board Briefing Agent...', { icon: '🤖' });
            try {
              const res = await apiFetch('/trigger/board-brief', { method: 'POST' });
              if (!res.ok) toast.error('Failed to trigger board brief.');
              else toast.success('Board briefing triggered.');
            } catch {
              toast.error('Failed to trigger board brief (backend not reachable).');
            }
          }}
        >
          <Bot size={16} /> Run Morning Brief Now
        </button>
      </div>

      <div className="agent-stats-grid">
        <div className="agent-stat-card">
          <div className="stat-label"><Activity size={16} color="var(--color-primary)" /> Autonomous Actions (30d)</div>
          <div className="stat-value">—</div>
        </div>
        <div className="agent-stat-card">
          <div className="stat-label"><CheckCircle size={16} color="var(--color-success)" /> Admin Hours Saved</div>
          <div className="stat-value">—</div>
        </div>
        <div className="agent-stat-card">
          <div className="stat-label"><ShieldAlert size={16} color="var(--color-warning)" /> Pending Approvals</div>
          <div className="stat-value">{approvals.length}</div>
        </div>
        <div className="agent-stat-card">
          <div className="stat-label"><Bot size={16} color="#8b5cf6" /> Active Agents</div>
          <div className="stat-value">{agents.length || 0}</div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-2" style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border-light)', paddingBottom: 0 }}>
        {[
          { id: 'queue', label: '⚡ HITL Queue', count: approvals.length },
          { id: 'metrics', label: '📊 Performance' },
          { id: 'config', label: '⚙️ Agent Config' },
        ].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id as any)}
            style={{ padding: '0.625rem 1.25rem', fontWeight: 600, fontSize: '0.875rem', background: 'none', border: 'none', borderBottom: activeTab === t.id ? '2px solid var(--color-primary)' : '2px solid transparent', color: activeTab === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)', cursor: 'pointer', marginBottom: '-1px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {t.label}
            {(t as any).count !== undefined && (t as any).count > 0 && (
              <span style={{ background: 'var(--color-danger)', color: 'white', borderRadius: '99px', fontSize: '0.7rem', padding: '0 6px', lineHeight: '18px' }}>{(t as any).count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="main-agent-grid">
        <div className="flex-col gap-6 flex">

          {/* HITL Queue Tab */}
          {activeTab === 'queue' && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title flex items-center gap-2">
                  <ShieldAlert size={18} color="var(--color-warning)" /> Human-in-the-Loop (HITL) Action Queue
                </h3>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-primary"
                    style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}
                    type="button"
                    disabled={batchRunning || approvals.length === 0}
                    onClick={() => void handleBatchApprove()}
                  >
                    {batchRunning ? 'Working…' : `Approve & run all (${approvals.length})`}
                  </button>
                  <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={loadApprovals} disabled={approvalsLoading}>
                    {approvalsLoading ? 'Loading…' : 'Refresh'}
                  </button>
                </div>
              </div>
              <div className="card-body">
                <div className="approval-list">
                  {approvals.map(approval => (
                    <div key={approval.id} className={`approval-card ${approval.risk_level === 'High' ? 'high-stakes' : 'standard'}`}>
                      <div className="approval-header">
                        <div className="approval-title">{approval.action_card?.summary || approval.directive}</div>
                        <div className="approval-meta">{approval.created_at ? new Date(approval.created_at).toLocaleString() : ''} • {approval.id}</div>
                      </div>
                      <div className="flex items-center gap-2" style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 600 }}>
                        <Bot size={12} /> {approval.intent_type || approval.action_card?.intent_type || 'intent'} • Risk:{' '}
                        {approval.risk_level || approval.action_card?.risk_level || '—'}
                        {typeof approval.agent_confidence === 'number' && (
                          <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                            · {(approval.agent_confidence * 100).toFixed(0)}% confident
                            {approval.agent_confidence >= 0.9
                              ? ' — low risk; safe to batch-approve with peers above'
                              : ''}
                            {approval.auto_resolve_hours != null
                              ? ` · auto-resolves in ~${approval.auto_resolve_hours}h if no one touches it`
                              : ''}
                          </span>
                        )}
                      </div>
                      <div className="approval-body" style={{ whiteSpace: 'pre-wrap' }}>
                        {approval.directive}
                      </div>
                      <div className="approval-actions">
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.375rem 0.75rem' }}
                          onClick={() => {
                            try {
                              navigator.clipboard?.writeText(JSON.stringify(approval.action_card || {}, null, 2));
                              toast.success('Action card copied to clipboard.');
                            } catch {
                              toast('Unable to copy.', { icon: '📄' });
                            }
                          }}
                        >
                          <Eye size={14} /> View
                        </button>
                        <button className="btn btn-secondary" style={{ padding: '0.375rem 0.75rem', color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }} onClick={() => handleReject(approval.id)}>
                          <XCircle size={14} /> Reject
                        </button>
                        <button className="btn btn-success" style={{ padding: '0.375rem 0.75rem' }} onClick={() => handleApprove(approval.id)}>
                          <Check size={14} /> Approve & Execute
                        </button>
                      </div>
                    </div>
                  ))}
                  {!approvalsLoading && approvals.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-tertiary)' }}>
                      ✅ No pending actions requiring human approval.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Performance Metrics Tab */}
          {activeTab === 'metrics' && (
            <div className="card">
              <div className="card-header"><h3 className="card-title flex items-center gap-2"><BarChart2 size={18} color="var(--color-primary)" /> Agent Performance Metrics</h3></div>
              <div style={{ padding: '0 1.5rem 1.5rem', color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
                {summary?.agent_streaks && summary.agent_streaks.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                    {summary.agent_streaks.map((s, i) => (
                      <li key={i} style={{ marginBottom: 8 }}>
                        <strong>{s.name}</strong>: {s.correct_in_row} successful runs (heuristic) · rejections (30d):{' '}
                        {s.rejections_30d}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span style={{ color: 'var(--color-text-tertiary)' }}>Streaks will appear as intents execute.</span>
                )}
                <p style={{ marginTop: 12, fontSize: '0.85rem', color: 'var(--color-text-tertiary)' }}>
                  Full metrics pipeline not wired — audit log below is authoritative.
                </p>
              </div>
            </div>
          )}

          {/* Config Tab */}
          {activeTab === 'config' && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title flex items-center gap-2"><Sliders size={18} color="var(--color-primary)" /> Agent Configuration & Thresholds</h3>
              </div>
              <div style={{ padding: '0 1.5rem 1.5rem', color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
                <p style={{ marginBottom: 12 }}>Auto-approve lightweight gifts below this threshold (session-only demo):</p>
                <div className="flex gap-2 items-center flex-wrap">
                  <span style={{ fontSize: '0.85rem' }}>₹</span>
                  <input
                    type="text"
                    className="input-field"
                    style={{ maxWidth: 140 }}
                    value={thresholdInr}
                    onChange={e => setThresholdInr(e.target.value)}
                    placeholder="e.g. 25000"
                  />
                  <button className="btn btn-primary" type="button" onClick={() => void saveThreshold()}>
                    Save threshold
                  </button>
                </div>
                <p style={{ marginTop: 12, fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>
                  Production would persist per-agent rules; this stores an in-memory hint for the current backend process.
                </p>
              </div>
            </div>
          )}

          {/* Audit Log — always visible */}
          <div className="card">
            <div className="card-header flex justify-between items-center">
              <h3 className="card-title">Immutable Audit Log</h3>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--color-text-tertiary)' }} />
                <input type="text" className="input-field" placeholder="Search logs..." value={logSearch}
                  onChange={e => setLogSearch(e.target.value)}
                  style={{ padding: '0.5rem 1rem 0.5rem 2rem', fontSize: '0.75rem', width: '100%', maxWidth: '200px' }} />
              </div>
            </div>
            <div
              ref={auditScrollRef}
              style={{
                maxHeight: 'min(55vh, 440px)',
                overflow: 'auto',
                border: '1px solid var(--color-border-light)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '72px minmax(120px, 140px) minmax(72px, 100px) 1fr',
                  gap: '0.5rem',
                  padding: '0.55rem 0.75rem',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                  color: 'var(--color-text-tertiary)',
                  borderBottom: '1px solid var(--color-border-light)',
                  position: 'sticky',
                  top: 0,
                  background: 'var(--color-bg-card)',
                  zIndex: 1,
                }}
              >
                <span>ID</span>
                <span>Time</span>
                <span>Type</span>
                <span>Payload</span>
              </div>
              {filteredLogs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '1.25rem', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
                  No logs yet.
                </div>
              ) : (
                <div style={{ height: auditVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                  {auditVirtualizer.getVirtualItems().map(vr => {
                    const log = filteredLogs[vr.index];
                    return (
                      <div
                        key={log.id}
                        data-index={vr.index}
                        ref={auditVirtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${vr.start}px)`,
                        }}
                      >
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '72px minmax(120px, 140px) minmax(72px, 100px) 1fr',
                            gap: '0.5rem',
                            padding: '0.45rem 0.75rem',
                            alignItems: 'center',
                            fontSize: '0.78rem',
                            borderBottom: '1px solid var(--color-border-light)',
                          }}
                        >
                          <span style={{ fontFamily: 'monospace', color: 'var(--color-text-tertiary)' }}>{log.id}</span>
                          <span style={{ whiteSpace: 'nowrap', fontSize: '0.72rem' }}>
                            {log.created_at ? new Date(log.created_at).toLocaleString() : '—'}
                          </span>
                          <span style={{ fontWeight: 500 }}>{log.type || 'event'}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {(log.payload || '').toString()}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex-col gap-6 flex">
          <div className="card">
            <div className="card-header"><h3 className="card-title">Active Agent Roster</h3></div>
            <div className="card-body">
              <div className="agent-roster-list">
                {agents.map((agent: string | { id?: string; name?: string; module?: string }, idx: number) => {
                  const name = typeof agent === 'string' ? agent : agent?.name || 'Agent';
                  const id = typeof agent === 'string' ? `${agent}-${idx}` : agent?.id || `${idx}`;
                  const moduleLabel = typeof agent === 'string' ? 'Copilot' : agent?.module || '—';
                  const cfg = configs.find((c: any) => c.name === name);
                  return (
                    <div key={id} className="agent-roster-item">
                      <div className="agent-avatar"><Bot size={18} /></div>
                      <div className="flex-1">
                        <div className="agent-name">{name}</div>
                        <div className="agent-module">{moduleLabel}</div>
                      </div>
                      <div className={`agent-status-indicator`} style={{ background: cfg?.paused ? 'var(--color-warning)' : '' }} title={cfg?.paused ? 'Paused' : 'Online & Active'}></div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="card" style={{ background: 'var(--color-bg-main)' }}>
            <div className="card-body">
              <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>AI Transparency Principles</h4>
              <ul style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <li><strong>Empathy Stays Human:</strong> Agents never handle crisis response or major donor relationship building.</li>
                <li><strong>Audit-First:</strong> Every action is logged immutably for FCRA and donor compliance.</li>
                <li><strong>Language Inclusive:</strong> AI outputs support Hindi and 8 regional languages.</li>
                <li><strong>Configurable Autonomy:</strong> You control exactly when agents act vs. ask for permission.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentHQ;
