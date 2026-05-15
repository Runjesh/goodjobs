import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Bot, CheckCircle, ShieldAlert, Activity, Cpu, XCircle, Check, Eye,
  Search, Settings, Sliders, Pause, Play, BarChart2,
  AlertOctagon, Clock, RotateCcw, LockKeyhole, TriangleAlert, Pencil, Info, Zap,
  ChevronDown, ChevronRight, X, AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import './AgentHQ.css';
import { apiFetch } from '../../api/client';
import { useTier } from '../../hooks/useTier';
import ContextualUpgradePrompt from '../../components/Billing/ContextualUpgradePrompt';
import MisReviewQueue from '../../components/AgentHQ/MisReviewQueue';
import ComplianceCascadeQueue from '../../components/AgentHQ/ComplianceCascadeQueue';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../context/AuthContext';

// ── Offline decision queue ────────────────────────────────────────────────────
const OFFLINE_QUEUE_KEY = 'goodjobs.pending_decisions';
type QueuedDecision = {
  id: string;
  decision: 'approved' | 'rejected';
  directive: string;
  agentName: string;
  risk?: string;
  queuedAt: string;
};
function getQueuedDecisions(): QueuedDecision[] {
  try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) ?? '[]'); } catch { return []; }
}
function saveQueuedDecisions(q: QueuedDecision[]): void {
  try { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q)); } catch { /* quota */ }
}
function enqueueDecision(d: QueuedDecision): void {
  const q = getQueuedDecisions();
  if (!q.find(x => x.id === d.id)) saveQueuedDecisions([...q, d]);
}
function dequeueDecision(id: string): void {
  saveQueuedDecisions(getQueuedDecisions().filter(x => x.id !== id));
}

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
interface AgentReasoning {
  triggered_by: string;
  filter_criteria: string;
  confidence: number;
  programme_or_grant?: string;
}

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
  agent_reasoning?: AgentReasoning;
}

// ── Audit Log Entry ────────────────────────────────────────────────────────────
interface AuditLogEntry {
  id: string;
  created_at: string;
  type: string;
  agent?: string;
  risk?: string;
  outcome?: 'approved' | 'rejected' | 'failed' | 'expired' | 'applied' | 'queued_offline' | string;
  payload: string;
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

// Demo intents only appear in dev builds.
const AGENT_HQ_SHOW_DEMO = (() => {
  try { return !!import.meta.env.DEV; } catch { return false; }
})();

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
      agent_reasoning: {
        triggered_by: 'Funder deadline 6 days away; data readiness crossed 85% threshold (was 72% yesterday)',
        filter_criteria: 'Grant #GR-2024-07 · status=active · UC not yet submitted · deadline within 7 days',
        confidence: 0.91,
        programme_or_grant: 'Child Nutrition Program — Tata Trusts (₹12.5L)',
      },
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
      agent_reasoning: {
        triggered_by: '14 donors crossed the 90-day lapse threshold without receiving an impact update',
        filter_criteria: 'Donation date: Oct–Dec 2024 · last_outreach=null · channel preference=WhatsApp',
        confidence: 0.87,
        programme_or_grant: 'Digital Literacy 2026 · Healthcare Camp',
      },
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
      agent_reasoning: {
        triggered_by: 'FCRA Annual Return deadline in 7 days; last reminder sent 14 days ago (cadence: every 14 days)',
        filter_criteria: 'Compliance doc type=FCRA · due_in_days ≤ 7 · reminder_sent_days_ago ≥ 14',
        confidence: 0.95,
        programme_or_grant: 'FCRA Registration (doc-3)',
      },
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
const CountdownTimer: React.FC<{
  expiresAt: string;
  onExpire?: () => void;
}> = ({ expiresAt, onExpire }) => {
  const [remaining, setRemaining] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    const update = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      if (ms <= 0) {
        setRemaining('Expired');
        setIsUrgent(true);
        if (!firedRef.current) {
          firedRef.current = true;
          onExpire?.();
        }
        return;
      }
      setIsUrgent(ms < 4 * 3600000);
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      if (h > 0) setRemaining(`${h}h ${m}m left`);
      else setRemaining(`${m}m left`);
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [expiresAt, onExpire]);

  return (
    <span className={`intent-countdown ${isUrgent ? 'intent-countdown--urgent' : ''}`}>
      <Clock size={11} /> {remaining}
    </span>
  );
};

// ── Edit Intent Modal ──────────────────────────────────────────────────────────
interface EditModalState {
  intentId: string;
  directive: string;
  recipient: string;
  originalAmount?: number;
  editCount: number;
}

// ── Intent Card ────────────────────────────────────────────────────────────────
const IntentCard: React.FC<{
  intent: RichIntent;
  onApprove: (id: string) => void;
  onReject:  (id: string) => void;
  onEdit:    (intent: RichIntent, currentEditCount: number) => void;
  editCount?: number;
  escalated?: boolean;
  escalationExpiry?: string;
  onExpire?: () => void;
}> = ({ intent, onApprove, onReject, onEdit, editCount = 0, escalated, escalationExpiry, onExpire }) => {
  const [reasoningOpen, setReasoningOpen] = useState(false);

  const effectiveRisk   = escalated ? 'critical' : intent.risk_level;
  const effectiveExpiry = escalated && escalationExpiry ? escalationExpiry : intent.expires_at;

  const risk     = RISK_META[effectiveRisk] ?? RISK_META.medium;
  const rev      = REVERSIBILITY_META[intent.reversibility] ?? REVERSIBILITY_META.reversible;
  const RiskIcon = risk.Icon;
  const RevIcon  = rev.Icon;
  const r        = intent.agent_reasoning;

  return (
    <div className="intent-card" style={{ borderColor: escalated ? '#DC2626' : risk.border }}>
      {intent.is_demo && (
        <div className="intent-demo-banner">
          <Zap size={11} /> Demo — this is what agent intents look like when active
        </div>
      )}

      {/* Escalation banner */}
      {escalated && (
        <div className="intent-escalation-banner">
          <AlertTriangle size={13} />
          Expired without action — escalated to Critical with 2-hour window
        </div>
      )}

      <div className="intent-card-header">
        <div className="intent-card-header-left">
          <span className="intent-risk-badge" style={{ background: risk.color }}>
            <RiskIcon size={11} /> {risk.label}
          </span>
          <span className="intent-agent-name">{intent.agent_name}</span>
          {editCount > 0 && (
            <span style={{ fontSize: '0.68rem', color: '#7c3aed', fontWeight: 600 }}>
              {editCount} edit{editCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <CountdownTimer expiresAt={effectiveExpiry} onExpire={escalated ? undefined : onExpire} />
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

      {/* Agent Reasoning — expandable "Why?" section */}
      {r && (
        <div className="intent-reasoning-wrap">
          <button
            className="intent-why-toggle"
            onClick={() => setReasoningOpen(o => !o)}
            aria-expanded={reasoningOpen}
          >
            {reasoningOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Why did the agent suggest this?
          </button>
          {reasoningOpen && (
            <div className="intent-reasoning-body">
              <div className="intent-reasoning-row">
                <span className="intent-reasoning-key">Triggered by</span>
                <span className="intent-reasoning-val">{r.triggered_by}</span>
              </div>
              <div className="intent-reasoning-row">
                <span className="intent-reasoning-key">Filter criteria</span>
                <span className="intent-reasoning-val">{r.filter_criteria}</span>
              </div>
              {r.programme_or_grant && (
                <div className="intent-reasoning-row">
                  <span className="intent-reasoning-key">Programme / Grant</span>
                  <span className="intent-reasoning-val">{r.programme_or_grant}</span>
                </div>
              )}
              <div className="intent-reasoning-row">
                <span className="intent-reasoning-key">Confidence</span>
                <span className="intent-reasoning-val">
                  <span className="intent-confidence-bar-wrap">
                    <span
                      className="intent-confidence-bar-fill"
                      style={{ width: `${Math.round(r.confidence * 100)}%` }}
                    />
                  </span>
                  {Math.round(r.confidence * 100)}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="intent-actions" role="group" aria-label="Decide on this agent action">
        <button
          className="intent-btn intent-btn--approve"
          onClick={() => onApprove(intent.id)}
          title="Approve and execute (A)"
        >
          <Check size={15} /> Approve
        </button>
        <button
          className="intent-btn intent-btn--modify"
          onClick={() => onEdit(intent, editCount)}
          title="Edit parameters before approving (E)"
          disabled={editCount >= 10}
        >
          <Pencil size={13} /> {editCount >= 10 ? 'Max edits' : 'Edit'}
        </button>
        <button
          className="intent-btn intent-btn--reject"
          onClick={() => onReject(intent.id)}
          title="Dismiss without executing (D)"
        >
          <XCircle size={14} /> Dismiss
        </button>
      </div>
    </div>
  );
};

// ── Compliance expiry → RichIntent cards ──────────────────────────────────────
function buildComplianceExpiryIntents(complianceDocs: ReturnType<typeof useStore.getState>['complianceDocs']): RichIntent[] {
  const nowMs = Date.now();
  return complianceDocs.flatMap(doc => {
    if (!doc.expiry) return [];
    const expiryMs = new Date(doc.expiry).getTime();
    if (!Number.isFinite(expiryMs)) return [];          // guard: invalid date string
    const daysLeft = Math.ceil((expiryMs - nowMs) / 86_400_000);
    if (daysLeft > 14 || daysLeft < -90) return [];
    const dayText = daysLeft < 0
      ? `expired ${Math.abs(daysLeft)}d ago`
      : daysLeft === 0 ? 'expires today' : `expires in ${daysLeft}d`;
    const riskLevel: RichIntent['risk_level'] = daysLeft <= 0 ? 'critical' : 'high';
    return [{
      id: `compliance-expiry-intent-${doc.id}`,
      agent_name: 'Compliance Guardian',
      action_type: 'compliance_renewal',
      directive: `Initiate renewal for ${doc.name} — ${dayText}`,
      risk_level: riskLevel,
      evidence_summary: `${doc.type} document "${doc.name}" ${dayText}. Missing renewal risks grant compliance blocks and donor receipt validity.${doc.assigned_to ? ` Assigned owner: ${doc.assigned_to}.` : ''} Navigate to Compliance HQ to upload the renewed certificate and update the expiry date.`,
      impact_preview: {
        '📋 Document': doc.name,
        '🏷️ Type': doc.type,
        '📅 Expiry': doc.expiry,
        '⚠️ Risk': riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1),
        ...(doc.assigned_to ? { '👤 Owner': doc.assigned_to } : {}),
      },
      reversibility: 'reversible',
      expires_at: new Date(expiryMs + 7 * 86_400_000).toISOString(),
      created_at: new Date().toISOString(),
      agent_reasoning: {
        triggered_by: `Document expiry within 14-day alert window (${dayText})`,
        filter_criteria: `doc.type=${doc.type} · days_to_expiry ≤ 14`,
        confidence: 1.0,
        programme_or_grant: doc.name,
      },
    }] satisfies RichIntent[];
  });
}

// ── Edit Intent Modal Component ────────────────────────────────────────────────
const EditIntentModal: React.FC<{
  state: EditModalState;
  donors: { id: string; name: string }[];
  beneficiaries: { id: string; name: string }[];
  onSave: (updated: EditModalState) => void;
  onCancel: () => void;
}> = ({ state, donors, beneficiaries, onSave, onCancel }) => {
  const [directive, setDirective] = useState(state.directive);
  const [recipient, setRecipient] = useState(state.recipient);
  const [amountStr, setAmountStr] = useState(
    state.originalAmount != null ? String(state.originalAmount) : ''
  );

  // Accept by id OR name (case-insensitive), matching donor ID, beneficiary id, or display name
  const allTokens = new Set([
    ...donors.map(d => d.id.toLowerCase()),
    ...donors.map(d => d.name.toLowerCase()),
    ...beneficiaries.map(b => b.id.toLowerCase()),
    ...beneficiaries.map(b => b.name.toLowerCase()),
  ]);

  const amount = parseFloat(amountStr.replace(/,/g, ''));
  const amountExceeded = state.originalAmount != null && !isNaN(amount) && amount > state.originalAmount * 10;
  const recipientInvalid = recipient.trim().length > 0 && !allTokens.has(recipient.trim().toLowerCase());
  const canSave = !amountExceeded && !recipientInvalid && directive.trim().length > 0;

  return (
    <div className="edit-modal-overlay">
      <div className="edit-modal-card">
        <div className="edit-modal-header">
          <h4><Pencil size={15} /> Edit Intent Parameters</h4>
          <button className="edit-modal-close" onClick={onCancel}><X size={16} /></button>
        </div>
        {state.editCount >= 9 && (
          <div className="edit-modal-warn">
            ⚠️ {10 - state.editCount} edit{10 - state.editCount === 1 ? '' : 's'} remaining before this intent is locked.
          </div>
        )}
        <div className="edit-modal-body">
          <label className="edit-modal-label">Directive</label>
          <textarea
            className="edit-modal-textarea"
            value={directive}
            onChange={e => setDirective(e.target.value)}
            rows={3}
          />

          <label className="edit-modal-label">Recipient (must exist in CRM or Beneficiary list)</label>
          <input
            className={`edit-modal-input${recipientInvalid ? ' edit-modal-input--error' : ''}`}
            type="text"
            value={recipient}
            onChange={e => setRecipient(e.target.value)}
            placeholder="e.g. Anjali Desai, Lakshmi Devi"
          />
          {recipientInvalid && (
            <div className="edit-modal-error">
              Recipient not found in donor or beneficiary records. Check the name or leave blank.
            </div>
          )}

          {state.originalAmount != null && (
            <>
              <label className="edit-modal-label">
                Amount (₹)
                <span className="edit-modal-label-hint"> · safe max: ₹{(state.originalAmount * 10).toLocaleString('en-IN')}</span>
              </label>
              <input
                className={`edit-modal-input${amountExceeded ? ' edit-modal-input--error' : ''}`}
                type="text"
                value={amountStr}
                onChange={e => setAmountStr(e.target.value)}
                placeholder={String(state.originalAmount)}
              />
              {amountExceeded && (
                <div className="edit-modal-error">
                  Safe bounds exceeded — amount cannot be more than 10× the original value (₹{(state.originalAmount * 10).toLocaleString('en-IN')}).
                </div>
              )}
            </>
          )}
        </div>
        <div className="edit-modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!canSave}
            onClick={() => onSave({ ...state, directive, recipient })}
          >
            Save edits
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Batch Results Drawer ────────────────────────────────────────────────────────
interface BatchResult {
  id: string;
  directive: string;
  outcome: 'ok' | 'failed';
  reason?: string;
}

const BatchResultsDrawer: React.FC<{
  results: BatchResult[];
  onClose: () => void;
}> = ({ results, onClose }) => {
  const ok = results.filter(r => r.outcome === 'ok').length;
  const failed = results.filter(r => r.outcome === 'failed').length;
  return (
    <div className="batch-results-drawer">
      <div className="batch-results-header">
        <div>
          <span className="batch-results-title">Batch Results</span>
          <span className="batch-results-summary">
            <span style={{ color: '#16A34A' }}>✓ {ok} approved</span>
            {failed > 0 && <span style={{ color: '#DC2626' }}> · ✗ {failed} failed</span>}
          </span>
        </div>
        <button className="batch-results-close" onClick={onClose}><X size={15} /></button>
      </div>
      <div className="batch-results-list">
        {results.map(r => (
          <div key={r.id} className={`batch-result-item${r.outcome === 'failed' ? ' batch-result-item--failed' : ''}`}>
            <span className="batch-result-icon">
              {r.outcome === 'ok' ? '✓' : '✗'}
            </span>
            <span className="batch-result-text">
              {r.directive}
              {r.reason && <span className="batch-result-reason"> — {r.reason}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Risk Multi-Select Chips ────────────────────────────────────────────────────
const RISK_CHIPS: { value: string; label: string; color: string }[] = [
  { value: 'critical', label: 'Critical', color: '#DC2626' },
  { value: 'high',     label: 'High',     color: '#D97706' },
  { value: 'medium',   label: 'Medium',   color: '#2563EB' },
  { value: 'low',      label: 'Low',      color: '#16A34A' },
];

const AgentHQ: React.FC = () => {
  const { limits: tierLims, openUpgrade: openTierUpgrade } = useTier();
  const agentsEnabled = tierLims.aiAgents;
  const [aiUpgradeOpen, setAiUpgradeOpen] = useState(false);
  const { user } = useAuth();

  // ── Store data for validation ───────────────────────────────────────────────
  const complianceDocs   = useStore(s => s.complianceDocs);
  const donors           = useStore(s => s.donors);
  const beneficiaries    = useStore(s => s.beneficiaries);
  const complianceExpiryIntents = useMemo(
    () => buildComplianceExpiryIntents(complianceDocs),
    [complianceDocs],
  );

  // ── Core queue state ────────────────────────────────────────────────────────
  const [approvals, setApprovals]           = useState<QueueItem[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [activeTab, setActiveTab]           = useState<'queue' | 'metrics' | 'config'>('queue');
  const [configs, setConfigs]               = useState<any[]>([]);
  const [agents, setAgents]                 = useState<string[]>([]);
  const [auditLogs, setAuditLogs]           = useState<AuditLogEntry[]>([]);
  const [summary, setSummary]               = useState<{
    pending_approvals: number;
    agent_streaks?: { name: string; correct_in_row: number; rejections_30d: number }[];
    alerts?: { severity: string; message: string }[];
    auto_approve_max_inr?: number | null;
  } | null>(null);
  const [thresholdInr, setThresholdInr]     = useState('');
  const prevThresholdRef                    = useRef<number | null>(null);

  // ── Step 2: Batch results ───────────────────────────────────────────────────
  const [batchRunning, setBatchRunning]         = useState(false);
  const [batchResults, setBatchResults]         = useState<BatchResult[]>([]);
  const [batchResultsOpen, setBatchResultsOpen] = useState(false);

  // ── Step 3: Audit log filters ───────────────────────────────────────────────
  const [logSearch,        setLogSearch]        = useState('');
  const [logAgentFilter,   setLogAgentFilter]   = useState('');
  const [logRiskFilter,    setLogRiskFilter]     = useState<string[]>([]);
  const [logOutcomeFilter, setLogOutcomeFilter] = useState('');

  // ── Step 4: Session-live performance counters ───────────────────────────────
  // streak: consecutive approvals since last rejection (resets to 0 on any rejection)
  const [sessionCounts, setSessionCounts] = useState<Record<string, { streak: number; approved: number; rejected: number }>>({});

  // ── Step 5: Escalation tracking ────────────────────────────────────────────
  // Maps intent id → new expiry ISO string (set when countdown hits zero)
  const [escalatedIntents, setEscalatedIntents] = useState<Record<string, string>>({});

  // ── Step 6: Edit intent modal ───────────────────────────────────────────────
  const [editModal, setEditModal]     = useState<EditModalState | null>(null);
  const [editCounts, setEditCounts]   = useState<Record<string, number>>({});
  // intentEdits: directive/recipient/amount overrides applied to rendered cards after a save
  const [intentEdits, setIntentEdits] = useState<Record<string, { directive: string; recipient?: string; amount?: number }>>({});

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const appendAuditLog = (entry: Omit<AuditLogEntry, 'id' | 'created_at'>) => {
    const newEntry: AuditLogEntry = {
      ...entry,
      id: `L${Date.now().toString(36)}`,
      created_at: new Date().toISOString(),
    };
    setAuditLogs(prev => [newEntry, ...prev]);
  };

  // Streak increments on approve, resets to 0 on any rejection (per spec)
  const bumpSessionCount = (agentName: string, type: 'approved' | 'rejected') => {
    setSessionCounts(prev => {
      const cur = prev[agentName] ?? { streak: 0, approved: 0, rejected: 0 };
      const streak = type === 'approved' ? cur.streak + 1 : 0;
      return { ...prev, [agentName]: { streak, approved: cur.approved + (type === 'approved' ? 1 : 0), rejected: cur.rejected + (type === 'rejected' ? 1 : 0) } };
    });
  };

  const loadApprovals = async (opts: { showError?: boolean } = {}) => {
    setApprovalsLoading(true);
    try {
      const res = await apiFetch('/intent/queue?status=queued&limit=50');
      if (!res.ok) throw new Error('queue failed');
      const data = await res.json();
      setApprovals(Array.isArray(data.items) ? data.items : []);
    } catch {
      setApprovals([]);
      if (opts.showError) toast.error('Failed to load intent queue.');
    } finally {
      setApprovalsLoading(false);
    }
  };

  // ── Offline queue replay ─────────────────────────────────────────────────────
  // Replays any decisions stored under goodjobs.pending_decisions when the
  // device comes back online or the tab regains focus.
  useEffect(() => {
    const replay = async () => {
      const queue = getQueuedDecisions();
      if (queue.length === 0) return;
      const replayed: string[] = [];
      for (const d of queue) {
        try {
          const res = await apiFetch(`/intent/queue/${encodeURIComponent(d.id)}/decision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: d.decision }),
          });
          if (!res.ok) continue;
          if (d.decision === 'approved') {
            const execRes = await apiFetch(`/intent/queue/${encodeURIComponent(d.id)}/execute`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dry_run: false }),
            });
            if (!execRes.ok) continue;
          }
          dequeueDecision(d.id);
          replayed.push(d.id);
          appendAuditLog({
            type: 'intent_decision',
            agent: d.agentName,
            risk: d.risk,
            outcome: `${d.decision} (replayed — queued offline)`,
            payload: d.directive,
          });
        } catch { /* still offline — leave in queue */ }
      }
      if (replayed.length > 0) {
        toast.success(`Synced ${replayed.length} queued decision${replayed.length > 1 ? 's' : ''} from offline queue.`);
        loadApprovals();
      }
    };
    window.addEventListener('online', replay);
    window.addEventListener('focus', replay);
    return () => {
      window.removeEventListener('online', replay);
      window.removeEventListener('focus', replay);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadApprovals();
    (async () => {
      try {
        const res = await apiFetch('/agent-hq/summary');
        if (res.ok) {
          const data = await res.json();
          setAgents(Array.isArray(data.agents) ? data.agents : []);
          setSummary(data);
          if (data.auto_approve_max_inr != null) {
            setThresholdInr(String(data.auto_approve_max_inr));
            prevThresholdRef.current = data.auto_approve_max_inr;
          }
        }
      } catch { /* ignore */ }
      try {
        const res = await apiFetch('/agent-hq/audit');
        if (res.ok) {
          const data = await res.json();
          const rawLogs: AuditLogEntry[] = Array.isArray(data.logs) ? data.logs : [];
          // Normalize backend field names so filters work on legacy rows too
          setAuditLogs(rawLogs.map(l => ({
            ...l,
            agent:   l.agent   ?? (l as any).agent_name ?? undefined,
            risk:    l.risk    ?? (l as any).risk_level  ?? undefined,
            outcome: l.outcome ?? (l as any).status      ?? undefined,
          })));
        }
      } catch { /* ignore */ }
      setConfigs([]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requireAgents = (): boolean => {
    if (agentsEnabled) return true;
    setAiUpgradeOpen(true);
    return false;
  };

  // ── Step 1/4/5: Approve ─────────────────────────────────────────────────────
  const handleApprove = async (id: string) => {
    if (!requireAgents()) return;
    const item = approvals.find(a => a.id === id);
    const agentName = item?.action_card?.agent || item?.intent_type || 'Agent';
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
      toast.success('Executed.');
      setApprovals(prev => prev.filter(a => a.id !== id));
      bumpSessionCount(agentName, 'approved');
      appendAuditLog({
        type: 'intent_decision',
        agent: agentName,
        risk: item?.risk_level,
        outcome: 'approved',
        payload: item?.directive || id,
      });
      try {
        window.dispatchEvent(new CustomEvent('goodjobs:brief-invalidate'));
      } catch {
        /* ignore */
      }
    } catch {
      // Backend unreachable — queue the decision for automatic replay when back online.
      enqueueDecision({
        id, decision: 'approved',
        directive: item?.directive || id,
        agentName, risk: item?.risk_level,
        queuedAt: new Date().toISOString(),
      });
      toast('Queued offline — will replay when back online.', { icon: '📶' });
      appendAuditLog({
        type: 'intent_decision',
        agent: agentName,
        risk: item?.risk_level,
        outcome: 'queued_offline',
        payload: `Approve queued for offline replay: ${id}`,
      });
    }
  };

  // ── Step 2: Batch approve with results drawer ───────────────────────────────
  const handleBatchApprove = async () => {
    if (!requireAgents()) return;
    if (approvals.length === 0) return;
    setBatchRunning(true);
    const results: BatchResult[] = [];
    try {
      for (const a of approvals) {
        const agentName = a.action_card?.agent || a.intent_type || 'Agent';
        try {
          const res = await apiFetch(`/intent/queue/${encodeURIComponent(a.id)}/decision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: 'approved' }),
          });
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({})) as Record<string, unknown>;
            throw new Error(String(errBody.detail ?? errBody.message ?? `HTTP ${res.status}`));
          }
          const execRes = await apiFetch(`/intent/queue/${encodeURIComponent(a.id)}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dry_run: false }),
          });
          if (!execRes.ok) {
            const errBody = await execRes.json().catch(() => ({})) as Record<string, unknown>;
            const detail = String(errBody.detail ?? errBody.message ?? `HTTP ${execRes.status}`);
            throw new Error(detail);
          }
          results.push({ id: a.id, directive: a.directive, outcome: 'ok' });
          bumpSessionCount(agentName, 'approved');
          appendAuditLog({ type: 'batch_decision', agent: agentName, risk: a.risk_level, outcome: 'approved', payload: a.directive });
        } catch (e: unknown) {
          const reason = e instanceof Error ? e.message : 'Unknown error';
          results.push({ id: a.id, directive: a.directive, outcome: 'failed', reason });
          appendAuditLog({ type: 'batch_decision', agent: agentName, risk: a.risk_level, outcome: 'failed', payload: `${a.directive} — ${reason}` });
        }
      }
      const ok = results.filter(r => r.outcome === 'ok').length;
      toast.success(`Batch complete: ${ok} / ${results.length} approved.`);
      setBatchResults(results);
      setBatchResultsOpen(true);
      await loadApprovals();
      try {
        window.dispatchEvent(new CustomEvent('goodjobs:brief-invalidate'));
      } catch {
        /* ignore */
      }
    } finally {
      setBatchRunning(false);
    }
  };

  // ── Step 7: Threshold save with audit log ───────────────────────────────────
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
      const prev = prevThresholdRef.current;
      const prevStr = prev != null ? `₹${prev.toLocaleString('en-IN')}` : '(none)';
      appendAuditLog({
        type: 'config_change',
        agent: 'System',
        outcome: 'applied',
        payload: `Threshold changed from ${prevStr} to ₹${n.toLocaleString('en-IN')} by ${user?.name ?? 'unknown'} at ${new Date().toLocaleString()}`,
      });
      prevThresholdRef.current = n;
      toast.success('Auto-approve threshold saved (session).');
    } catch {
      toast.error('Could not save threshold.');
    }
  };

  const handleReject = async (id: string) => {
    if (!requireAgents()) return;
    const item = approvals.find(a => a.id === id);
    const agentName = item?.action_card?.agent || item?.intent_type || 'Agent';
    try {
      const res = await apiFetch(`/intent/queue/${encodeURIComponent(id)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'rejected' }),
      });
      if (!res.ok) throw new Error('reject failed');
      toast.success('Rejected.');
      setApprovals(prev => prev.filter(a => a.id !== id));
      bumpSessionCount(agentName, 'rejected');
      appendAuditLog({
        type: 'intent_decision',
        agent: agentName,
        risk: item?.risk_level,
        outcome: 'rejected',
        payload: item?.directive || id,
      });
    } catch {
      enqueueDecision({
        id, decision: 'rejected',
        directive: item?.directive || id,
        agentName, risk: item?.risk_level,
        queuedAt: new Date().toISOString(),
      });
      toast('Rejection queued offline — will replay when back online.', { icon: '📶' });
      appendAuditLog({
        type: 'intent_decision',
        agent: agentName,
        risk: item?.risk_level,
        outcome: 'queued_offline',
        payload: `Reject queued for offline replay: ${id}`,
      });
    }
  };

  // ── Step 5: Escalation handler — only high/critical risk intents escalate ───
  const handleIntentExpire = (intentId: string, agentName: string, risk: string) => {
    if (risk !== 'high' && risk !== 'critical') return; // medium/low simply expire
    const newExpiry = new Date(Date.now() + 2 * 3600000).toISOString();
    setEscalatedIntents(prev => ({ ...prev, [intentId]: newExpiry }));
    appendAuditLog({
      type: 'intent_expired',
      agent: agentName,
      risk: 'critical',
      outcome: 'expired',
      payload: `Intent ${intentId} expired without action — escalated to Critical (was ${risk})`,
    });
  };

  // ── Step 6: Edit intent handlers ────────────────────────────────────────────
  const handleEditIntent = (intent: RichIntent, currentEditCount: number) => {
    if (currentEditCount >= 10) {
      toast.error('Maximum 10 edits reached for this intent.');
      return;
    }
    const amountMatch = intent.directive.match(/₹([\d,]+)/);
    const originalAmount = amountMatch
      ? parseInt(amountMatch[1].replace(/,/g, ''), 10)
      : undefined;
    setEditModal({
      intentId: intent.id,
      directive: intent.directive,
      recipient: '',
      originalAmount,
      editCount: currentEditCount,
    });
  };

  const handleSaveEdit = (updated: EditModalState) => {
    setEditCounts(prev => ({ ...prev, [updated.intentId]: (prev[updated.intentId] ?? 0) + 1 }));
    // Persist the edited directive so the card reflects the change immediately
    const parsedAmount = updated.originalAmount != null
      ? parseFloat(String(updated.originalAmount).replace(/,/g, ''))
      : undefined;
    setIntentEdits(prev => ({
      ...prev,
      [updated.intentId]: {
        directive: updated.directive,
        recipient: updated.recipient || undefined,
        amount: parsedAmount != null && !isNaN(parsedAmount) ? parsedAmount : undefined,
      },
    }));
    const amountNote = parsedAmount != null && !isNaN(parsedAmount) ? ` · amount: ₹${parsedAmount.toLocaleString('en-IN')}` : '';
    appendAuditLog({
      type: 'intent_edited',
      agent: 'User',
      outcome: 'applied',
      payload: `Intent ${updated.intentId} edited: "${updated.directive}"${updated.recipient ? ` · recipient: ${updated.recipient}` : ''}${amountNote}`,
    });
    toast.success('Intent parameters updated.');
    setEditModal(null);
  };

  // ── Step 3: Audit log filtering ─────────────────────────────────────────────
  const uniqueAgents = Array.from(new Set(auditLogs.map(l => l.agent).filter(Boolean) as string[]));

  const filteredLogs = auditLogs.filter((l: AuditLogEntry) => {
    if (logSearch &&
      !(l.type || '').toLowerCase().includes(logSearch.toLowerCase()) &&
      !(l.payload || '').toLowerCase().includes(logSearch.toLowerCase()) &&
      !(l.agent || '').toLowerCase().includes(logSearch.toLowerCase())
    ) return false;
    if (logAgentFilter && (l.agent || '') !== logAgentFilter) return false;
    if (logRiskFilter.length > 0 && !logRiskFilter.includes(l.risk || '')) return false;
    if (logOutcomeFilter && (l.outcome || '') !== logOutcomeFilter) return false;
    return true;
  });

  // Apply any saved parameter edits to an intent before rendering
  const applyEdits = (intent: RichIntent): RichIntent => {
    const edit = intentEdits[intent.id];
    if (!edit) return intent;
    return {
      ...intent,
      directive: edit.directive,
      ...(edit.amount != null ? { amount: edit.amount } : {}),
    };
  };

  const auditScrollRef = useRef<HTMLDivElement>(null);
  const auditVirtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => auditScrollRef.current,
    estimateSize: () => 44,
    overscan: 14,
  });

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="agent-hq-container">
      {summary?.alerts && summary.alerts.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderLeft: '4px solid var(--color-warning)', background: 'var(--color-bg-card)' }}>
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
              toast('Running Morning Brief Agent…', { icon: '🌅' });
              try {
                const res = await apiFetch('/trigger/morning-brief', { method: 'POST' });
                if (!res.ok) toast.error('Failed to run morning brief.');
                else {
                  toast.success('Morning brief queued — Today page and field WhatsApp will update.');
                  window.dispatchEvent(new Event('goodjobs:brief-invalidate'));
                }
              } catch {
                toast.error('Failed to run morning brief (backend not reachable).');
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

      {!agentsEnabled && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.75rem 1rem', marginBottom: '1rem', background: 'linear-gradient(90deg, #f0fdfa, #fff)', border: '1px solid #99f6e4', borderRadius: '10px' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: '#0F766E', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <LockKeyhole size={16} />
          </div>
          <div style={{ flex: 1, fontSize: '0.85rem' }}>
            <strong style={{ color: '#0F766E' }}>AI Copilot is locked on your Starter plan.</strong>
            <span style={{ color: '#64748b', display: 'block', fontSize: '0.78rem' }}>
              Upgrade to Growth to enable autonomous agents (morning brief, donor follow-ups, AI-drafted reports, WhatsApp data entry).
            </span>
          </div>
          <button className="btn btn-primary" style={{ padding: '7px 12px', fontSize: '0.78rem' }} onClick={() => setAiUpgradeOpen(true)}>
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
          <div className="stat-value">{approvals.length + complianceExpiryIntents.length}</div>
        </div>
        <div className="agent-stat-card">
          <div className="stat-label"><Bot size={16} color="#8b5cf6" /> Active Agents</div>
          <div className="stat-value">{agents.length || 0}</div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-2" style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border-light)', paddingBottom: 0 }}>
        {[
          { id: 'queue',   label: '⚡ HITL Queue',    count: approvals.length + complianceExpiryIntents.length },
          { id: 'metrics', label: '📊 Performance' },
          { id: 'config',  label: '⚙️ Agent Config' },
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
                {/* Batch results drawer */}
                {batchResultsOpen && batchResults.length > 0 && (
                  <BatchResultsDrawer results={batchResults} onClose={() => setBatchResultsOpen(false)} />
                )}

                <ComplianceCascadeQueue />
                <MisReviewQueue />
                <div className="approval-list">
                  {/* Compliance expiry intents */}
                  {complianceExpiryIntents.map(intent => (
                    <IntentCard
                      key={intent.id}
                      intent={applyEdits(intent)}
                      onApprove={() => toast('Navigate to Compliance HQ to upload the renewed certificate.', { icon: '📋' })}
                      onReject={() => toast('Reminder dismissed for this session — doc still requires renewal.', { icon: '⚠️' })}
                      onEdit={(i, c) => handleEditIntent(i, c)}
                      editCount={editCounts[intent.id] ?? 0}
                      escalated={!!escalatedIntents[intent.id]}
                      escalationExpiry={escalatedIntents[intent.id]}
                      onExpire={() => handleIntentExpire(intent.id, intent.agent_name, intent.risk_level)}
                    />
                  ))}

                  {/* Queue intents — escalated ones float to top */}
                  {[
                    ...approvals.filter(a => escalatedIntents[a.id]),
                    ...approvals.filter(a => !escalatedIntents[a.id]),
                  ].map(approval => {
                    const richIntent = applyEdits(normalizeApproval(approval));
                    return (
                      <IntentCard
                        key={approval.id}
                        intent={richIntent}
                        onApprove={handleApprove}
                        onReject={handleReject}
                        onEdit={(i, c) => handleEditIntent(i, c)}
                        editCount={editCounts[approval.id] ?? 0}
                        escalated={!!escalatedIntents[approval.id]}
                        escalationExpiry={escalatedIntents[approval.id]}
                        onExpire={() => handleIntentExpire(approval.id, richIntent.agent_name, richIntent.risk_level)}
                      />
                    );
                  })}

                  {!approvalsLoading && approvals.length === 0 && complianceExpiryIntents.length === 0 && (
                    <div>
                      <div className="intent-all-clear">
                        <CheckCircle size={18} style={{ color: '#16A34A' }} />
                        <span>All clear — no actions pending human review</span>
                      </div>
                      {AGENT_HQ_SHOW_DEMO && (
                        <div className="intent-demo-section">
                          <div className="intent-demo-section-label">
                            <Zap size={13} /> Sample intents — this is what the queue looks like when agents are active
                          </div>
                          {getMockIntents().map(intent => (
                            <IntentCard
                              key={intent.id}
                              intent={applyEdits(intent)}
                              onApprove={() => toast.success('Demo: agents would execute this action', { icon: '✓' })}
                              onReject={() => toast('Demo: intent removed from queue', { icon: '✕' })}
                              onEdit={(i, c) => handleEditIntent(i, c)}
                              editCount={editCounts[intent.id] ?? 0}
                              escalated={!!escalatedIntents[intent.id]}
                              escalationExpiry={escalatedIntents[intent.id]}
                              onExpire={() => handleIntentExpire(intent.id, intent.agent_name, intent.risk_level)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Performance Metrics Tab — Step 4: session-live counters */}
          {activeTab === 'metrics' && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title flex items-center gap-2"><BarChart2 size={18} color="var(--color-primary)" /> Agent Performance Metrics</h3>
              </div>
              <div style={{ padding: '0 1.5rem 1.5rem' }}>
                {/* Session-live counters */}
                {Object.keys(sessionCounts).length > 0 && (
                  <div style={{ marginBottom: '1.5rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)', marginBottom: '0.75rem' }}>
                      This session
                    </div>
                    <div className="session-metrics-grid">
                      {Object.entries(sessionCounts).map(([agent, counts]) => (
                        <div key={agent} className="session-metric-card">
                          <div className="session-metric-agent">{agent}</div>
                          <div className="session-metric-counts">
                            <span className="session-metric-approved">✓ {counts.approved}</span>
                            <span className="session-metric-rejected">✗ {counts.rejected}</span>
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                            streak: {counts.streak} correct in a row
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Backend streaks */}
                {summary?.agent_streaks && summary.agent_streaks.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
                    {summary.agent_streaks.map((s, i) => (
                      <li key={i} style={{ marginBottom: 8 }}>
                        <strong>{s.name}</strong>: {s.correct_in_row} successful runs · rejections (30d): {s.rejections_30d}
                      </li>
                    ))}
                  </ul>
                ) : Object.keys(sessionCounts).length === 0 ? (
                  <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.9rem' }}>
                    Session counters will appear as you approve or reject intents.
                  </span>
                ) : null}
                <p style={{ marginTop: 12, fontSize: '0.85rem', color: 'var(--color-text-tertiary)' }}>
                  Full metrics pipeline not wired — session counters and audit log below are authoritative.
                </p>
              </div>
            </div>
          )}

          {/* Config Tab — Step 7: threshold audit */}
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
                  Threshold changes are logged in the audit log below. Production would persist per-agent rules.
                </p>
              </div>
            </div>
          )}

          {/* Audit Log — Step 3: filters */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Immutable Audit Log</h3>
            </div>

            {/* Filter bar */}
            <div className="audit-filter-row">
              {/* Text search */}
              <div style={{ position: 'relative', flex: '1 1 160px', minWidth: 120 }}>
                <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
                <input
                  type="text"
                  className="input-field"
                  placeholder="Search logs…"
                  value={logSearch}
                  onChange={e => setLogSearch(e.target.value)}
                  style={{ paddingLeft: '1.75rem', fontSize: '0.75rem', width: '100%', height: 32 }}
                />
              </div>

              {/* Agent dropdown */}
              <select
                className="input-field audit-filter-select"
                value={logAgentFilter}
                onChange={e => setLogAgentFilter(e.target.value)}
              >
                <option value="">All agents</option>
                {uniqueAgents.map(a => <option key={a} value={a}>{a}</option>)}
              </select>

              {/* Outcome filter */}
              <select
                className="input-field audit-filter-select"
                value={logOutcomeFilter}
                onChange={e => setLogOutcomeFilter(e.target.value)}
              >
                <option value="">All outcomes</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="failed">Failed</option>
                <option value="expired">Expired</option>
              </select>

              {/* Risk multi-select chips */}
              <div className="audit-risk-chips">
                {RISK_CHIPS.map(chip => (
                  <button
                    key={chip.value}
                    className={`audit-risk-chip${logRiskFilter.includes(chip.value) ? ' audit-risk-chip--active' : ''}`}
                    style={logRiskFilter.includes(chip.value) ? { background: chip.color, color: '#fff', borderColor: chip.color } : { borderColor: chip.color, color: chip.color }}
                    onClick={() =>
                      setLogRiskFilter(prev =>
                        prev.includes(chip.value)
                          ? prev.filter(r => r !== chip.value)
                          : [...prev, chip.value]
                      )
                    }
                  >
                    {chip.label}
                  </button>
                ))}
                {logRiskFilter.length > 0 && (
                  <button className="audit-risk-chip-clear" onClick={() => setLogRiskFilter([])}>
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div
              ref={auditScrollRef}
              style={{ maxHeight: 'min(55vh, 440px)', overflow: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', margin: '0 1.25rem 1.25rem' }}
            >
              <div
                style={{ display: 'grid', gridTemplateColumns: '72px minmax(100px, 130px) minmax(90px, 110px) minmax(60px, 80px) 1fr', gap: '0.5rem', padding: '0.55rem 0.75rem', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--color-text-tertiary)', borderBottom: '1px solid var(--color-border-light)', position: 'sticky', top: 0, background: 'var(--color-bg-card)', zIndex: 1 }}
              >
                <span>ID</span>
                <span>Time</span>
                <span>Type</span>
                <span>Outcome</span>
                <span>Payload</span>
              </div>
              {filteredLogs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '1.25rem', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
                  No log entries match the current filters.
                </div>
              ) : (
                <div style={{ height: auditVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                  {auditVirtualizer.getVirtualItems().map(vr => {
                    const log = filteredLogs[vr.index];
                    const outcomeColor: Record<string, string> = {
                      approved: '#16A34A', rejected: '#DC2626', failed: '#DC2626', expired: '#D97706', applied: '#2563EB',
                    };
                    return (
                      <div
                        key={log.id}
                        data-index={vr.index}
                        ref={auditVirtualizer.measureElement}
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vr.start}px)` }}
                      >
                        <div style={{ display: 'grid', gridTemplateColumns: '72px minmax(100px, 130px) minmax(90px, 110px) minmax(60px, 80px) 1fr', gap: '0.5rem', padding: '0.45rem 0.75rem', alignItems: 'center', fontSize: '0.78rem', borderBottom: '1px solid var(--color-border-light)' }}>
                          <span style={{ fontFamily: 'monospace', color: 'var(--color-text-tertiary)', fontSize: '0.7rem' }}>{log.id}</span>
                          <span style={{ whiteSpace: 'nowrap', fontSize: '0.72rem' }}>
                            {log.created_at ? new Date(log.created_at).toLocaleString() : '—'}
                          </span>
                          <span style={{ fontWeight: 500 }}>{log.type || 'event'}</span>
                          <span style={{ fontWeight: 600, fontSize: '0.72rem', color: log.outcome ? (outcomeColor[log.outcome] ?? 'inherit') : 'inherit' }}>
                            {log.outcome ?? '—'}
                          </span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text-secondary)' }}>
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

        {/* Right column */}
        <div className="flex-col gap-6 flex">
          <div className="card">
            <div className="card-header"><h3 className="card-title">Active Agent Roster</h3></div>
            <div className="card-body">
              <div className="agent-roster-list">
                {agents.map((agent: string | { id?: string; name?: string; module?: string }, idx: number) => {
                  const name        = typeof agent === 'string' ? agent : agent?.name || 'Agent';
                  const id          = typeof agent === 'string' ? `${agent}-${idx}` : agent?.id || `${idx}`;
                  const moduleLabel = typeof agent === 'string' ? 'Copilot' : agent?.module || '—';
                  const cfg         = configs.find((c: any) => c.name === name);
                  const sc          = sessionCounts[name];
                  return (
                    <div key={id} className="agent-roster-item">
                      <div className="agent-avatar"><Bot size={18} /></div>
                      <div className="flex-1">
                        <div className="agent-name">{name}</div>
                        <div className="agent-module">{moduleLabel}</div>
                        {sc && (
                          <div style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                            Session: <span style={{ color: '#16A34A' }}>✓{sc.approved}</span> <span style={{ color: '#DC2626' }}>✗{sc.rejected}</span>
                          </div>
                        )}
                      </div>
                      <div className="agent-status-indicator" style={{ background: cfg?.paused ? 'var(--color-warning)' : '' }} title={cfg?.paused ? 'Paused' : 'Online & Active'} />
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

      {/* Edit intent modal */}
      {editModal && (
        <EditIntentModal
          state={editModal}
          donors={donors}
          beneficiaries={beneficiaries}
          onSave={handleSaveEdit}
          onCancel={() => setEditModal(null)}
        />
      )}

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
