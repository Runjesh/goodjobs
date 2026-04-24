import React, { useEffect, useState } from 'react';
import {
  Bot, CheckCircle, ShieldAlert, Activity, Cpu, XCircle, Check, Eye,
  Search, Settings, Sliders, Pause, Play, BarChart2
} from 'lucide-react';
import toast from 'react-hot-toast';
import './AgentHQ.css';
import { apiFetch } from '../../api/client';

const agents = [
  { id: 1, name: 'Donor Nurture Agent', module: 'Fundraising + CRM', status: 'Active' },
  { id: 2, name: 'Campaign Intelligence Agent', module: 'Fundraising', status: 'Active' },
  { id: 3, name: 'Finance & Compliance Agent', module: 'Finance + FCRA', status: 'Active' },
  { id: 4, name: 'Grant Report Agent', module: 'Finance + MIS', status: 'Active' },
  { id: 5, name: 'CSR Pipeline Agent', module: 'CSR Pipeline', status: 'Active' },
  { id: 6, name: 'Field MIS Agent', module: 'Programs MIS', status: 'Active' },
  { id: 7, name: 'Volunteer Ops Agent', module: 'Volunteer Operations', status: 'Active' },
  { id: 8, name: 'Board Briefing Agent', module: 'Compliance HQ', status: 'Active' },
];

type QueueItem = {
  id: string;
  directive: string;
  intent_type?: string;
  risk_level?: string;
  status: string;
  action_card?: any;
  created_at?: string;
};

const auditLogs = [
  { id: 'LOG-1200', time: '10:45 AM', agent: 'Donor Nurture', action: 'Sent 80G Receipt', details: 'Auto-generated and sent to rahul@example.com for TRX-1090.', status: 'Success' },
  { id: 'LOG-1199', time: '09:30 AM', agent: 'Field MIS', action: 'Data Validation', details: 'Flagged 3 duplicate attendance records in Nashik block.', status: 'Flagged' },
  { id: 'LOG-1198', time: '06:00 AM', agent: 'Board Briefing', action: 'Morning Brief', details: 'Generated and emailed daily leadership brief to 4 trustees.', status: 'Success' },
  { id: 'LOG-1197', time: 'Yesterday', agent: 'Campaign Intelligence', action: 'Boost Copy Generated', details: 'Detected underperforming campaign — A/B copy queued for approval.', status: 'Pending' },
  { id: 'LOG-1196', time: 'Yesterday', agent: 'Finance & Compliance', action: 'FCRA Check', details: 'All 14 transactions for Oct validated against FCRA 2010 rules.', status: 'Success' },
];

const agentConfigs = [
  { id: 1, name: 'Donor Nurture Agent', autoThreshold: 100000, requiresApprovalAbove: 100000, paused: false },
  { id: 2, name: 'Campaign Intelligence Agent', autoThreshold: 0, requiresApprovalAbove: 0, paused: false },
  { id: 3, name: 'Finance & Compliance Agent', autoThreshold: 50000, requiresApprovalAbove: 500000, paused: false },
  { id: 4, name: 'Grant Report Agent', autoThreshold: 0, requiresApprovalAbove: 0, paused: false },
  { id: 5, name: 'CSR Pipeline Agent', autoThreshold: 0, requiresApprovalAbove: 0, paused: false },
  { id: 6, name: 'Field MIS Agent', autoThreshold: 0, requiresApprovalAbove: 100000, paused: false },
  { id: 7, name: 'Volunteer Ops Agent', autoThreshold: 0, requiresApprovalAbove: 0, paused: false },
  { id: 8, name: 'Board Briefing Agent', autoThreshold: 0, requiresApprovalAbove: 0, paused: false },
];

const agentMetrics = [
  { name: 'Donor Nurture', actions: 4820, success: 98.2, timeSaved: '120h' },
  { name: 'Campaign Intelligence', actions: 1240, success: 94.5, timeSaved: '42h' },
  { name: 'Finance & Compliance', actions: 3100, success: 99.8, timeSaved: '88h' },
  { name: 'Grant Report', actions: 48, success: 100, timeSaved: '36h' },
  { name: 'CSR Pipeline', actions: 890, success: 91.2, timeSaved: '28h' },
  { name: 'Field MIS', actions: 2200, success: 96.0, timeSaved: '60h' },
  { name: 'Volunteer Ops', actions: 560, success: 97.5, timeSaved: '18h' },
  { name: 'Board Briefing', actions: 30, success: 100, timeSaved: '15h' },
];

const AgentHQ: React.FC = () => {
  const [approvals, setApprovals] = useState<QueueItem[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'queue' | 'metrics' | 'config'>('queue');
  const [configs, setConfigs] = useState(agentConfigs);
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
      toast.error('Failed to approve/execute (requires ED/Admin + DB).');
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
      toast.error('Failed to reject (requires ED/Admin + DB).');
    }
  };

  const togglePause = (id: number) => {
    const agent = configs.find(c => c.id === id);
    setConfigs(prev => prev.map(c => c.id === id ? { ...c, paused: !c.paused } : c));
    toast(agent?.paused ? `${agent.name} resumed.` : `${agent?.name} paused.`, { icon: agent?.paused ? '▶️' : '⏸️' });
  };

  const updateThreshold = (id: number, field: string, value: number) => {
    setConfigs(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const filteredLogs = auditLogs.filter(l =>
    !logSearch || l.agent.toLowerCase().includes(logSearch.toLowerCase()) || l.action.toLowerCase().includes(logSearch.toLowerCase())
  );

  return (
    <div className="agent-hq-container">
      <div className="page-header">
        <div>
          <h1 className="page-title text-gradient flex items-center gap-2">
            <Cpu size={28} /> SevaSuite Copilot (Agent HQ)
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
          <div className="stat-value">12,888</div>
        </div>
        <div className="agent-stat-card">
          <div className="stat-label"><CheckCircle size={16} color="var(--color-success)" /> Admin Hours Saved</div>
          <div className="stat-value">407h</div>
        </div>
        <div className="agent-stat-card">
          <div className="stat-label"><ShieldAlert size={16} color="var(--color-warning)" /> Pending Approvals</div>
          <div className="stat-value">{approvals.length}</div>
        </div>
        <div className="agent-stat-card">
          <div className="stat-label"><Bot size={16} color="#8b5cf6" /> Active Agents</div>
          <div className="stat-value">{configs.filter(c => !c.paused).length} / 8</div>
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
                <div style={{ marginLeft: 'auto' }}>
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
                        <Bot size={12} /> {approval.intent_type || approval.action_card?.intent_type || 'intent'} • Risk: {approval.risk_level || approval.action_card?.risk_level || '—'}
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
              <div style={{ overflowX: 'auto' }}>
                <table className="audit-log-table">
                  <thead><tr><th>Agent</th><th>Actions (30d)</th><th>Success Rate</th><th>Time Saved</th><th>Status</th></tr></thead>
                  <tbody>
                    {agentMetrics.map(m => (
                      <tr key={m.name}>
                        <td style={{ fontWeight: 500 }}><span className="flex items-center gap-1"><Bot size={12} /> {m.name}</span></td>
                        <td>{m.actions.toLocaleString()}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div style={{ width: 60, height: 6, background: 'var(--color-bg-main)', borderRadius: 999, overflow: 'hidden' }}>
                              <div style={{ width: `${m.success}%`, height: '100%', background: m.success > 97 ? 'var(--color-success)' : m.success > 93 ? 'var(--color-warning)' : 'var(--color-danger)', borderRadius: 999 }}></div>
                            </div>
                            <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{m.success}%</span>
                          </div>
                        </td>
                        <td style={{ fontWeight: 600, color: 'var(--color-success)' }}>{m.timeSaved}</td>
                        <td><span className={`badge ${configs.find(c => c.name.includes(m.name.split(' ')[0]))?.paused ? 'badge-outline' : 'badge-success'}`}>{configs.find(c => c.name.includes(m.name.split(' ')[0]))?.paused ? 'Paused' : 'Active'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Config Tab */}
          {activeTab === 'config' && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title flex items-center gap-2"><Sliders size={18} color="var(--color-primary)" /> Agent Configuration & Thresholds</h3>
              </div>
              <div style={{ padding: '0 1.5rem 1.5rem' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: '1.5rem', padding: '0.75rem 1rem', background: '#eff6ff', borderRadius: 'var(--radius-md)', border: '1px solid #bfdbfe' }}>
                  💡 Configure when agents act autonomously vs. when they require human approval. Lower thresholds = more autonomy.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {configs.map(cfg => (
                    <div key={cfg.id} style={{ border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', padding: '1rem 1.25rem', background: cfg.paused ? '#fff7ed' : 'white' }}>
                      <div className="flex justify-between items-center" style={{ marginBottom: cfg.autoThreshold > 0 ? '0.75rem' : 0 }}>
                        <div className="flex items-center gap-2">
                          <Bot size={16} color={cfg.paused ? 'var(--color-warning)' : 'var(--color-primary)'} />
                          <span style={{ fontWeight: 600 }}>{cfg.name}</span>
                          {cfg.paused && <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>Paused</span>}
                        </div>
                        <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }} onClick={() => togglePause(cfg.id)}>
                          {cfg.paused ? <><Play size={13} /> Resume</> : <><Pause size={13} /> Pause</>}
                        </button>
                      </div>
                      {cfg.autoThreshold > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                          <div className="input-group" style={{ marginBottom: 0 }}>
                            <label className="input-label">Auto-execute below (₹)</label>
                            <input type="number" className="input-field" value={cfg.autoThreshold}
                              onChange={e => updateThreshold(cfg.id, 'autoThreshold', Number(e.target.value))}
                              onBlur={() => toast.success(`${cfg.name} threshold updated!`)} />
                          </div>
                          <div className="input-group" style={{ marginBottom: 0 }}>
                            <label className="input-label">Require approval above (₹)</label>
                            <input type="number" className="input-field" value={cfg.requiresApprovalAbove}
                              onChange={e => updateThreshold(cfg.id, 'requiresApprovalAbove', Number(e.target.value))}
                              onBlur={() => toast.success(`${cfg.name} threshold updated!`)} />
                          </div>
                        </div>
                      )}
                      {cfg.autoThreshold === 0 && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>All actions require human approval for this agent.</div>
                      )}
                    </div>
                  ))}
                </div>
                <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => toast.success('Agent configuration saved!', { icon: '✅' })}>
                  <Settings size={16} /> Save All Configurations
                </button>
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
                  style={{ padding: '0.5rem 1rem 0.5rem 2rem', fontSize: '0.75rem', width: '200px' }} />
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="audit-log-table">
                <thead><tr><th>Log ID</th><th>Time</th><th>Agent</th><th>Action Taken</th><th>Result</th></tr></thead>
                <tbody>
                  {filteredLogs.map(log => (
                    <tr key={log.id}>
                      <td style={{ fontFamily: 'monospace', color: 'var(--color-text-tertiary)' }}>{log.id}</td>
                      <td>{log.time}</td>
                      <td style={{ fontWeight: 500 }}><span className="flex items-center gap-1"><Bot size={12} /> {log.agent}</span></td>
                      <td>{log.action}</td>
                      <td><span className={`badge ${log.status === 'Success' ? 'badge-success' : log.status === 'Pending' ? 'badge-outline' : 'badge-warning'}`}>{log.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex-col gap-6 flex">
          <div className="card">
            <div className="card-header"><h3 className="card-title">Active Agent Roster</h3></div>
            <div className="card-body">
              <div className="agent-roster-list">
                {agents.map(agent => {
                  const cfg = configs.find(c => c.name === agent.name);
                  return (
                    <div key={agent.id} className="agent-roster-item">
                      <div className="agent-avatar"><Bot size={18} /></div>
                      <div className="flex-1">
                        <div className="agent-name">{agent.name}</div>
                        <div className="agent-module">{agent.module}</div>
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
