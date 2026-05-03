import React, { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Bot, CheckCircle, ShieldAlert, Activity, Cpu, XCircle, Check, Eye,
  Search, Settings, Sliders, Pause, Play, BarChart2,
  AlertOctagon, Clock, RotateCcw, LockKeyhole, TriangleAlert, Pencil, Info, Zap
} from 'lucide-react';
import toast from 'react-hot-toast';
import './AgentHQ.css';
import { apiFetch } from '../../api/client';
import { useTier } from '../../hooks/useTier';
import ContextualUpgradePrompt from '../../components/Billing/ContextualUpgradePrompt';

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

// ── Rich Intent Types ──────────────────────────────────────────────────────────
interface RichIntent {
  id: string;
  agent_name: string;
  action_type: string;
  directive: string;
  risk_level: 'critical' | 'high' | 'medium' | 'low';
  evidence_summary: string;
  impact_preview: Record<string, string>;
  reversibility: 'reversible' | 'partially_reversible' | 'irreversible';
  expires_at: string;
  created_at: string;
  is_demo?: boolean;
}

const RISK_META = {
  critical: { label: 'CRITICAL', color: '#DC2626', bg: '#fef2f2', border: '#fca5a5', Icon: AlertOctagon   },
  high:     { label: 'HIGH',     color: '#D97706', bg: '#fffbeb', border: '#fde68a', Icon: TriangleAlert  },
  medium:   { label: 'MEDIUM',   color: '#2563EB', bg: '#eff6ff', border: '#93c5fd', Icon: Info           },
  low:      { label: 'LOW',      color: '#16A34A', bg: '#f0fdf4', border: '#86efac', Icon: CheckCircle    },
} as const;

const REVERSIBILITY_META = {
  irreversible:         { label: 'IRREVERSIBLE — cannot be undone', color: '#DC2626', Icon: LockKeyhole },
  partially_reversible: { label: 'Partial rollback possible',       color: '#D97706', Icon: RotateCcw   },
  reversible:           { label: 'Fully reversible',                color: '#16A34A', Icon: RotateCcw   },
} as const;

function getMockIntents(): RichIntent[] {
  return [
    {
      id: 'mock-001',
      agent_name: 'Grant Report Agent',
      action_type: 'submit_grant_report',
      directive: 'Submit Q3 Utilisation Report for Child Nutrition Program to Tata Trusts',
      risk_level: 'high',
      evidence_summary: 'Auto-submit the Q3 utilisation report for "Child Nutrition Program" (Grant #GR-2024-07) to Tata Trusts. Report was drafted from live program data and has passed the 85% data readiness check. Funder deadline is in 6 days.',
      impact_preview: { '📄 Document': '1 UC report', '📬 Recipient': 'Tata Trusts grants@', '💰 Grant value': '₹12.5L', '📅 Period': 'Jul–Sep 2024' },
      reversibility: 'irreversible',
      expires_at: new Date(Date.now() + 3.5 * 3600000).toISOString(),
      created_at: new Date(Date.now() - 45 * 60000).toISOString(),
      is_demo: true,
    },
    {
      id: 'mock-002',
      agent_name: 'Donor Nurture Agent',
      action_type: 'send_impact_update',
      directive: 'Send personalised impact updates to 14 lapsed donors via WhatsApp',
      risk_level: 'medium',
      evidence_summary: 'Send a personalised impact update via WhatsApp to 14 donors who gave in Oct–Dec 2024 and have not received an update in 90+ days. Each message is tailored with the donor\'s specific program outcomes.',
      impact_preview: { '👥 Donors': '14 recipients', '📱 Channel': 'WhatsApp', '⏱ Send time': 'Immediately', '🔄 Action': 'Donor nurture' },
      reversibility: 'reversible',
      expires_at: new Date(Date.now() + 22 * 3600000).toISOString(),
      created_at: new Date(Date.now() - 2 * 3600000).toISOString(),
      is_demo: true,
    },
    {
      id: 'mock-003',
      agent_name: 'Compliance Guardian',
      action_type: 'send_deadline_reminder',
      directive: 'Remind ED, Program Head & Finance Officer about FCRA Return due in 7 days',
      risk_level: 'medium',
      evidence_summary: 'Send a WhatsApp reminder to 3 key staff about the FCRA Annual Return filing due in 7 days. All recipients are in the contact directory and the last reminder was sent 14 days ago.',
      impact_preview: { '👥 Recipients': '3 staff', '📱 Channel': 'WhatsApp', '⚡ Urgency': '7 days to deadline', '↩ Recall': 'Possible within 2 min' },
      reversibility: 'partially_reversible',
      expires_at: new Date(Date.now() + 20 * 3600000).toISOString(),
      created_at: new Date(Date.now() - 3600000).toISOString(),
      is_demo: true,
    },
  ];
}

function normalizeApproval(q: QueueItem): RichIntent {
  const rk = (q.risk_level?.toLowerCase() ?? 'medium') as RichIntent['risk_level'];
  return {
    id: q.id,
    agent_name: q.action_card?.agent || q.intent_type || 'Agent',
    action_type: q.intent_type || q.action_card?.intent_type || 'action',
    directive: q.action_card?.summary || q.directive,
    risk_level: ['critical', 'high', 'medium', 'low'].includes(rk) ? rk : 'medium',
    evidence_summary: q.directive,
    impact_preview: q.agent_confidence != null
      ? { '🤖 Confidence': `${(q.agent_confidence * 100).toFixed(0)}%`, '⏱ Auto-resolve': q.auto_resolve_hours ? `${q.auto_resolve_hours}h` : 'Manual only' }
      : {},
    reversibility: 'partially_reversible',
    expires_at: q.auto_resolve_hours
      ? new Date(Date.now() + q.auto_resolve_hours * 3600000).toISOString()
      : new Date(Date.now() + 24 * 3600000).toISOString(),
    created_at: q.created_at || new Date().toISOString(),
  };
}

// ── Countdown Timer ────────────────────────────────────────────────────────────
const CountdownTimer: React.FC<{ expiresAt: string }> = ({ expiresAt }) => {
  const [remaining, setRemaining] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);

  useEffect(() => {
    const update = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      if (ms <= 0) { setRemaining('Expired'); setIsUrgent(true); return; }
      setIsUrgent(ms < 4 * 3600000);
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      if (h > 0) setRemaining(`${h}h ${m}m left`);
      else setRemaining(`${m}m left`);
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return (
    <span className={`intent-countdown ${isUrgent ? 'intent-countdown--urgent' : ''}`}>
      <Clock size={11} /> {remaining}
    </span>
  );
};

// ── Intent Card ────────────────────────────────────────────────────────────────
const IntentCard: React.FC<{
  intent: RichIntent;
  onApprove: (id: string) => void;
  onReject:  (id: string) => void;
  onModify:  (id: string) => void;
}> = ({ intent, onApprove, onReject, onModify }) => {
  const risk = RISK_META[intent.risk_level] ?? RISK_META.medium;
  const rev  = REVERSIBILITY_META[intent.reversibility] ?? REVERSIBILITY_META.reversible;
  const RiskIcon = risk.Icon;
  const RevIcon  = rev.Icon;

  return (
    <div className="intent-card" style={{ borderColor: risk.border }}>
      {intent.is_demo && (
        <div className="intent-demo-banner">
          <Zap size={11} /> Demo — this is what agent intents look like when active
        </div>
      )}
      <div className="intent-card-header">
        <div className="intent-card-header-left">
          <span className="intent-risk-badge" style={{ background: risk.color }}>
            <RiskIcon size={11} /> {risk.label}
          </span>
          <span className="intent-agent-name">{intent.agent_name}</span>
        </div>
        <CountdownTimer expiresAt={intent.expires_at} />
      </div>

      <h4 className="intent-directive">{intent.directive}</h4>

      <div className="intent-evidence-pack" style={{ background: `${risk.bg}` }}>
        <div className="intent-evidence-label">What will happen</div>
        <p className="intent-evidence-text">{intent.evidence_summary}</p>
        {Object.keys(intent.impact_preview).length > 0 && (
          <div className="intent-impact-grid">
            {Object.entries(intent.impact_preview).map(([k, v]) => (
              <div key={k} className="intent-impact-cell">
                <div className="intent-impact-cell-key">{k}</div>
                <div className="intent-impact-cell-val">{v}</div>
              </div>
            ))}
          </div>
        )}
        <div className="intent-reversibility">
          <RevIcon size={12} style={{ color: rev.color }} />
          <span style={{ color: rev.color, fontWeight: 600, fontSize: '0.72rem' }}>{rev.label}</span>
        </div>
      </div>

      <div className="intent-actions">
        <button className="intent-btn intent-btn--approve" onClick={() => onApprove(intent.id)}>
          <Check size={14} /> Approve
        </button>
        <button className="intent-btn intent-btn--modify" onClick={() => onModify(intent.id)}>
          <Pencil size={13} /> Modify
        </button>
        <button className="intent-btn intent-btn--reject" onClick={() => onReject(intent.id)}>
          <XCircle size={14} /> Reject
        </button>
      </div>
    </div>
  );
};

const AgentHQ: React.FC = () => {
  // Tier gate — Starter doesn't include AI agents. We still render the UI so
  // users can see what's behind the paywall, but every action button is gated.
  const { limits: tierLims, openUpgrade: openTierUpgrade } = useTier();
  const agentsEnabled = tierLims.aiAgents;
  const [aiUpgradeOpen, setAiUpgradeOpen] = useState(false);

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

  const loadApprovals = async (opts: { showError?: boolean } = {}) => {
    setApprovalsLoading(true);
    try {
      const res = await apiFetch('/intent/queue?status=queued&limit=50');
      if (!res.ok) throw new Error('queue failed');
      const data = await res.json();
      setApprovals(Array.isArray(data.items) ? data.items : []);
    } catch {
      // Backend may be offline (frontend-only deployments). Fall back to an
      // empty queue silently on initial load; only surface a toast when the
      // user explicitly retried.
      setApprovals([]);
      if (opts.showError) toast.error('Failed to load intent queue.');
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

  // Tier gate: any actionable agent operation (approve / reject / batch / save
  // config) is blocked for Starter. We surface the upgrade prompt instead so
  // the user can't accidentally drive the queue without a paid tier.
  const requireAgents = (): boolean => {
    if (agentsEnabled) return true;
    setAiUpgradeOpen(true);
    return false;
  };

  const handleApprove = async (id: string) => {
    if (!requireAgents()) return;
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
    if (!requireAgents()) return;
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
    if (!requireAgents()) return;
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
    if (!requireAgents()) return;
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
        {agentsEnabled ? (
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
        ) : (
          <button
            className="btn btn-secondary"
            onClick={() => setAiUpgradeOpen(true)}
            style={{ opacity: 0.85 }}
            title="AI Copilot is on Growth + Scale plans"
          >
            <LockKeyhole size={16} /> Run Morning Brief — Upgrade to unlock
          </button>
        )}
      </div>

      {/* AI features locked banner — Starter plan doesn't include the agents.
          We still let users browse the queue/config so they understand the
          surface, but every actionable button is gated. */}
      {!agentsEnabled && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '0.75rem 1rem', marginBottom: '1rem',
            background: 'linear-gradient(90deg, #f0fdfa, #fff)',
            border: '1px solid #99f6e4',
            borderRadius: '10px',
          }}
        >
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: '#0F766E', color: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <LockKeyhole size={16} />
          </div>
          <div style={{ flex: 1, fontSize: '0.85rem' }}>
            <strong style={{ color: '#0F766E' }}>AI Copilot is locked on your Starter plan.</strong>
            <span style={{ color: '#64748b', display: 'block', fontSize: '0.78rem' }}>
              Upgrade to Growth to enable autonomous agents (morning brief, donor follow-ups, AI-drafted reports, WhatsApp data entry).
            </span>
          </div>
          <button
            className="btn btn-primary"
            style={{ padding: '7px 12px', fontSize: '0.78rem' }}
            onClick={() => setAiUpgradeOpen(true)}
          >
            Upgrade to Growth
          </button>
        </div>
      )}

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
                  <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={() => loadApprovals({ showError: true })} disabled={approvalsLoading}>
                    {approvalsLoading ? 'Loading…' : 'Refresh'}
                  </button>
                </div>
              </div>
              <div className="card-body">
                <div className="approval-list">
                  {approvals.map(approval => (
                    <IntentCard
                      key={approval.id}
                      intent={normalizeApproval(approval)}
                      onApprove={handleApprove}
                      onReject={handleReject}
                      onModify={() => toast('Open the Action Card to edit parameters, then re-approve.', { icon: '✏️' })}
                    />
                  ))}
                  {!approvalsLoading && approvals.length === 0 && (
                    <div>
                      <div className="intent-all-clear">
                        <CheckCircle size={18} style={{ color: '#16A34A' }} />
                        <span>All clear — no actions pending human review</span>
                      </div>
                      <div className="intent-demo-section">
                        <div className="intent-demo-section-label">
                          <Zap size={13} /> Sample intents — this is what the queue looks like when agents are active
                        </div>
                        {getMockIntents().map(intent => (
                          <IntentCard
                            key={intent.id}
                            intent={intent}
                            onApprove={() => toast.success('Demo: agents would execute this action', { icon: '✓' })}
                            onReject={() => toast('Demo: intent removed from queue', { icon: '✕' })}
                            onModify={() => toast('Demo: edit parameters before approving', { icon: '✏️' })}
                          />
                        ))}
                      </div>
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

      {/* Tier-cap prompt — opens whenever a Starter user clicks an AI feature. */}
      <ContextualUpgradePrompt
        open={aiUpgradeOpen}
        onClose={() => setAiUpgradeOpen(false)}
        blockedAction="AI Copilot & autonomous agents"
        reason="AI Copilot is included on Growth and Scale plans. Starter is limited to manual workflows."
        nextBenefits={[
          'Morning brief, donor follow-ups, AI report drafting',
          'WhatsApp field data entry',
          'Unlimited beneficiaries',
          'Priority support + onboarding call',
        ]}
        targetTier="growth"
        onUpgrade={() => {
          setAiUpgradeOpen(false);
          openTierUpgrade({ targetTier: 'growth', source: 'agenthq_locked' });
        }}
      />
    </div>
  );
};

export default AgentHQ;
