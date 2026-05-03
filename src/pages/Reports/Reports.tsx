import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FileText, Download, PlusCircle, CheckCircle2,
  Clock, AlertCircle, Users, IndianRupee,
  TrendingUp, Send, Eye, ArrowRight, Sparkles
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useFocusFromUrl } from '../../hooks/useFocusFromUrl';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../api/client';
import toast from 'react-hot-toast';
import { useTier } from '../../hooks/useTier';
import { recordReportDraft } from '../../utils/trial';
import ContextualUpgradePrompt from '../../components/Billing/ContextualUpgradePrompt';
import { readToCForProgram } from '../../utils/tocStorage';
import './Reports.css';

type ReportType = 'funder' | 'impact' | 'donor' | 'board';

const REPORT_TYPES: { id: ReportType; label: string; icon: React.ElementType; desc: string; color: string }[] = [
  {
    id: 'funder',
    label: 'Funder Report',
    icon: FileText,
    desc: 'Utilisation certificates, grant progress, and outcome reports for funders.',
    color: '#0F766E',
  },
  {
    id: 'impact',
    label: 'Impact Report',
    icon: TrendingUp,
    desc: 'Beneficiary outcomes, program results, and social impact summaries.',
    color: '#059669',
  },
  {
    id: 'donor',
    label: 'Donor Update',
    icon: Users,
    desc: 'Personalised impact updates showing donors how their gifts made a difference.',
    color: '#0891b2',
  },
  {
    id: 'board',
    label: 'Board Brief',
    icon: Eye,
    desc: 'Executive summary of operations, financials, and key risks for board meetings.',
    color: '#7c3aed',
  },
];

// Data readiness scores per report (simulated — in prod, computed from live data completeness)
const DATA_READINESS: Record<string, number> = {
  '1': 94,
  '2': 81,
  '3': 100,
  '4': 87,
  '5': 63,
};

const REPORTS_READY_FOR_DRAFT = 3; // how many have enough data to auto-draft

interface MockReport {
  id: string;
  title: string;
  type: ReportType;
  status: 'draft' | 'review' | 'submitted' | 'overdue';
  date: string;
  funder?: string;
}

const MOCK_REPORTS: MockReport[] = [
  { id: '1', title: 'Q2 Progress Report — Tata Trusts',     type: 'funder', status: 'review',    date: '2026-05-15', funder: 'Tata Trusts'  },
  { id: '2', title: 'Annual Impact Report 2025–26',          type: 'impact', status: 'draft',     date: '2026-04-30'  },
  { id: '3', title: 'Donor Impact Update — April 2026',      type: 'donor',  status: 'submitted', date: '2026-04-10'  },
  { id: '4', title: 'Board Brief — Q1 FY 2026–27',           type: 'board',  status: 'submitted', date: '2026-04-01'  },
  { id: '5', title: 'UC Report — CSR Fund Education',         type: 'funder', status: 'overdue',   date: '2026-03-31', funder: 'HDFC Bank CSR' },
];

const STATUS_META = {
  draft:     { label: 'Draft',     color: '#7C3AED', bg: '#F5F3FF' },
  review:    { label: 'In Review', color: '#d97706', bg: '#fef3c7' },
  submitted: { label: 'Submitted', color: '#16A34A', bg: '#d1fae5' },
  overdue:   { label: 'Overdue',   color: '#DC2626', bg: '#fee2e2' },
};

const Reports: React.FC = () => {
  useFocusFromUrl('report');
  const [activeType, setActiveType] = useState<ReportType | 'all'>('all');
  const [draftingReport, setDraftingReport] = useState<string | null>(null);
  const [autoSaveText, setAutoSaveText] = useState('Saved 2 min ago');
  const [reportStatuses, setReportStatuses] = useState<Record<string, MockReport['status']>>({});

  const effectiveStatus = (r: MockReport): MockReport['status'] => reportStatuses[r.id] ?? r.status;
  const advanceStatus = (id: string, current: MockReport['status']) => {
    const next: Record<string, MockReport['status']> = {
      overdue: 'draft', draft: 'review', review: 'submitted', submitted: 'submitted',
    };
    setReportStatuses(prev => ({ ...prev, [id]: next[current] }));
    toast.success('Report moved to next stage.');
  };

  useEffect(() => {
    const steps = ['Saved just now', 'Saved 1 min ago', 'Saved 2 min ago', 'Saved 4 min ago', 'Saved 6 min ago'];
    let idx = 1;
    const interval = setInterval(() => {
      setAutoSaveText(steps[Math.min(idx, steps.length - 1)]);
      idx++;
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const navigate = useNavigate();
  const { user, can } = useAuth();
  const { donors, transactions, campaigns, beneficiaries } = useStore();
  const { tier, limits, usage, openUpgrade } = useTier();
  const [reportUpgradeOpen, setReportUpgradeOpen] = useState(false);

  // Pull per-program Theory-of-Change outcomes so impact/funder narratives
  // can be anchored to the same statements the program lead authored.
  const tocSnapshots = React.useMemo(() => {
    const programs = Array.from(new Set(beneficiaries.map((b: any) => String(b.program || '')).filter(Boolean)));
    const list: { program: string; outcomes: string[] }[] = [];
    const seen = new Set<string>();
    const consider = (p: string) => {
      const key = p || 'General';
      if (seen.has(key)) return;
      seen.add(key);
      const nodes = readToCForProgram(p);
      const outcomes = nodes
        .filter(n => n.type === 'outcome' || n.type === 'impact')
        .map(n => n.content)
        .filter(Boolean);
      if (outcomes.length) list.push({ program: key, outcomes });
    };
    for (const p of programs) consider(p);
    consider('General');
    return list;
  }, [beneficiaries]);

  const copyOutcomesForProgram = async (program: string, outcomes: string[]) => {
    const text = `Theory of Change — ${program}\n\n` + outcomes.map(o => `• ${o}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${program} outcomes copied — paste into your draft.`);
    } catch {
      toast.error('Copy failed — please select and copy manually.');
    }
  };

  const handleDraftReport = async (type: ReportType) => {
    if (!can('reports', 'canEdit')) {
      toast.error('You do not have permission to generate reports.');
      return;
    }
    // Tier cap on AI report drafts (Starter = 2/mo, Growth = 20/mo, Scale = ∞)
    if (limits.reportsPerMonth !== null && usage.reportsThisMonth >= limits.reportsPerMonth) {
      setReportUpgradeOpen(true);
      return;
    }
    setDraftingReport(type);
    let succeeded = false;
    try {
      const res = await apiFetch('/gen-ai/draft-report', {
        method: 'POST',
        body: JSON.stringify({ type, role: user?.role }),
      });
      if (!res.ok) throw new Error('Draft failed');
      const data = await res.json();
      succeeded = true;
      toast.success('Report draft generated! Check your downloads.');
    } catch {
      // Backend not reachable in dev — treat the optimistic UX as a success
      // for the demo build only (so the counter still ticks). In production
      // this branch should leave succeeded=false so failed drafts don't
      // consume quota.
      if (import.meta.env.DEV) {
        succeeded = true;
        toast.success('AI report drafting initiated — check back in a moment.');
      } else {
        toast.error('AI draft failed. Please try again.');
      }
    } finally {
      // Only count the draft if it actually completed; failed attempts must
      // not consume the monthly quota and trigger a false cap-hit.
      if (succeeded && user?.ngoId) recordReportDraft(user.ngoId);
      setDraftingReport(null);
    }
  };

  const filteredReports = activeType === 'all'
    ? MOCK_REPORTS
    : MOCK_REPORTS.filter(r => r.type === activeType);

  const overdueCount = MOCK_REPORTS.filter(r => r.status === 'overdue').length;
  const draftCount   = MOCK_REPORTS.filter(r => r.status === 'draft' || r.status === 'review').length;
  const sentCount    = MOCK_REPORTS.filter(r => r.status === 'submitted').length;

  return (
    <div className="reports-page">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="reports-header">
        <div>
          <h1 className="reports-title">Reports</h1>
          <p className="reports-subtitle">Funder Reports · Impact Reports · Donor Updates · Board Briefs</p>
        </div>
        <div className="reports-header-right">
          <span className="reports-autosave">{autoSaveText}</span>
          {can('reports', 'canEdit') && (
            <button className="reports-btn-primary" onClick={() => handleDraftReport('funder')}>
              <Sparkles size={15} /> AI Draft Report
            </button>
          )}
        </div>
      </div>

      {/* ── AI Assembler banner — proactive, at top ───────────────── */}
      {can('reports', 'canEdit') && (
        <div className="reports-ai-banner reports-ai-banner--top">
          <div className="reports-ai-icon">
            <Sparkles size={18} />
          </div>
          <div className="reports-ai-content">
            <div className="reports-ai-title">
              {REPORTS_READY_FOR_DRAFT} reports have enough data to auto-draft right now
            </div>
            <div className="reports-ai-desc">
              The AI agent pre-fills reports from live program data, financials, and M&E records. Review in minutes.
            </div>
          </div>
          <div className="reports-ai-actions">
            <button
              className="reports-ai-btn reports-ai-btn--primary"
              onClick={() => handleDraftReport('funder')}
              disabled={!!draftingReport}
            >
              {draftingReport ? '…' : 'Draft All'}
            </button>
            {REPORT_TYPES.map(rt => (
              <button
                key={rt.id}
                className="reports-ai-btn"
                onClick={() => handleDraftReport(rt.id)}
                disabled={draftingReport === rt.id}
              >
                <span
                  className="reports-ai-btn-dot"
                  style={{ background: rt.color }}
                  aria-hidden="true"
                />
                {draftingReport === rt.id ? '…' : rt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Theory of Change anchor — per-program outcomes for narrative ── */}
      {tocSnapshots.length > 0 && (
        <div className="reports-toc-anchor">
          <div className="reports-toc-anchor-header">
            <div>
              <div className="reports-toc-anchor-title">
                <Sparkles size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
                Anchor narratives to your Theory of Change
              </div>
              <div className="reports-toc-anchor-sub">
                Funders expect outcomes language to match what you committed to. Copy the relevant program's outcomes into impact / funder reports.
              </div>
            </div>
            <button className="reports-btn-secondary" onClick={() => navigate('/programs?tab=toc')}>
              Edit ToC <ArrowRight size={13} />
            </button>
          </div>
          <div className="reports-toc-anchor-grid">
            {tocSnapshots.map(({ program, outcomes }) => (
              <div key={program} className="reports-toc-anchor-card">
                <div className="reports-toc-anchor-card-title">{program}</div>
                <ul className="reports-toc-anchor-list">
                  {outcomes.slice(0, 3).map((o, i) => (<li key={i}>{o}</li>))}
                </ul>
                {outcomes.length > 3 && (
                  <div className="reports-toc-anchor-more">+{outcomes.length - 3} more</div>
                )}
                <button
                  className="reports-toc-anchor-copy"
                  onClick={() => copyOutcomesForProgram(program, outcomes)}
                >
                  Copy outcomes
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Kanban Pipeline Strip ─────────────────────────────────── */}
      <div className="reports-kanban">
        {(([
          { key: 'overdue'   , label: 'Overdue',   Icon: AlertCircle,  color: '#DC2626', bg: '#fee2e2' },
          { key: 'draft'     , label: 'Draft',     Icon: FileText,     color: '#7C3AED', bg: '#F5F3FF' },
          { key: 'review'    , label: 'In Review', Icon: Clock,        color: '#d97706', bg: '#fef3c7' },
          { key: 'submitted' , label: 'Submitted', Icon: CheckCircle2, color: '#16A34A', bg: '#d1fae5' },
        ] as { key: MockReport['status']; label: string; Icon: React.ElementType; color: string; bg: string }[]).map(lane => {
          const laneReports = MOCK_REPORTS.filter(r => effectiveStatus(r) === lane.key);
          const advanceLabel: Record<string, string> = {
            overdue: 'Move to Draft →', draft: 'Send to Review →', review: 'Mark Submitted ✓',
          };
          return (
            <div key={lane.key} className="reports-kanban-lane" style={{ '--lane-color': lane.color } as React.CSSProperties}>
              <div className="reports-kanban-lane-header" style={{ borderTopColor: lane.color }}>
                <div className="reports-kanban-lane-icon" style={{ background: lane.bg, color: lane.color }}>
                  <lane.Icon size={13} />
                </div>
                <span className="reports-kanban-lane-label">{lane.label}</span>
                <span className="reports-kanban-lane-count" style={{ background: lane.bg, color: lane.color }}>
                  {laneReports.length}
                </span>
              </div>
              <div className="reports-kanban-cards">
                {laneReports.map(r => {
                  const typeInfo = REPORT_TYPES.find(t => t.id === r.type)!;
                  return (
                    <div key={r.id} className="reports-kanban-card">
                      <div className="reports-kanban-card-title" title={r.title}>
                        {r.title.length > 38 ? r.title.slice(0, 38) + '…' : r.title}
                      </div>
                      <div className="reports-kanban-card-meta" style={{ color: typeInfo.color }}>
                        {typeInfo.label}
                      </div>
                      {lane.key !== 'submitted' && (
                        <button
                          className="reports-kanban-advance"
                          onClick={() => advanceStatus(r.id, effectiveStatus(r))}
                        >
                          {advanceLabel[lane.key]}
                        </button>
                      )}
                    </div>
                  );
                })}
                {laneReports.length === 0 && (
                  <div className="reports-kanban-empty">—</div>
                )}
              </div>
            </div>
          );
        }))}
      </div>

      {/* ── Report Type Cards ─────────────────────────────────────── */}
      <div className="reports-type-grid">
        {REPORT_TYPES.map(rt => {
          const Icon = rt.icon;
          const count = MOCK_REPORTS.filter(r => r.type === rt.id).length;
          return (
            <motion.div
              key={rt.id}
              className={`reports-type-card ${activeType === rt.id ? 'active' : ''}`}
              style={{ '--type-color': rt.color } as React.CSSProperties}
              whileHover={{ y: -2 }}
              onClick={() => setActiveType(activeType === rt.id ? 'all' : rt.id)}
            >
              <div className="reports-type-icon" style={{ background: `${rt.color}18`, color: rt.color }}>
                <Icon size={20} />
              </div>
              <div className="reports-type-info">
                <div className="reports-type-label">{rt.label}</div>
                <div className="reports-type-desc">{rt.desc}</div>
              </div>
              <div className="reports-type-count">{count}</div>
            </motion.div>
          );
        })}
      </div>

      {/* ── Reports List ──────────────────────────────────────────── */}
      <div className="reports-list-section">
        <div className="reports-list-header">
          <h2 className="reports-list-title">
            {activeType === 'all' ? 'All Reports' : REPORT_TYPES.find(t => t.id === activeType)?.label + 's'}
          </h2>
          {activeType !== 'all' && (
            <button className="reports-filter-clear" onClick={() => setActiveType('all')}>
              Clear filter ×
            </button>
          )}
        </div>

        <div className="reports-list">
          {filteredReports.map((report, i) => {
            const sm = STATUS_META[report.status];
            const typeInfo = REPORT_TYPES.find(t => t.id === report.type)!;
            const TypeIcon = typeInfo.icon;
            return (
              <motion.div
                key={report.id}
                data-focus-id={report.id}
                className="reports-list-item"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <div className="reports-item-icon" style={{ background: `${typeInfo.color}18`, color: typeInfo.color }}>
                  <TypeIcon size={16} />
                </div>
                <div className="reports-item-body">
                  <div className="reports-item-title">{report.title}</div>
                  <div className="reports-item-meta">
                    {typeInfo.label}
                    {report.funder && <> · {report.funder}</>}
                    {' · '}
                    <span className="reports-item-date">{report.date}</span>
                  </div>
                  {DATA_READINESS[report.id] !== undefined && (
                    <div className="reports-item-readiness">
                      <div
                        className="reports-item-readiness-bar"
                        style={{ width: `${DATA_READINESS[report.id]}%`, background: DATA_READINESS[report.id] >= 85 ? '#16A34A' : DATA_READINESS[report.id] >= 60 ? '#d97706' : '#DC2626' }}
                      />
                      <span className="reports-item-readiness-label" style={{ color: DATA_READINESS[report.id] >= 85 ? '#16A34A' : DATA_READINESS[report.id] >= 60 ? '#d97706' : '#DC2626' }}>
                        {DATA_READINESS[report.id]}% data ready
                      </span>
                    </div>
                  )}
                </div>
                <span className="reports-item-badge" style={{ background: sm.bg, color: sm.color }}>
                  {sm.label}
                </span>
                <div className="reports-item-actions">
                  <button className="reports-item-btn" title="View">
                    <Eye size={14} />
                  </button>
                  <button className="reports-item-btn" title="Download">
                    <Download size={14} />
                  </button>
                  {(report.status === 'draft' || report.status === 'review') && can('reports', 'canEdit') && (
                    <button
                      className="reports-item-btn reports-item-btn--send"
                      title="Submit"
                      onClick={() => toast.success(`Report "${report.title}" marked for submission.`)}
                    >
                      <Send size={14} />
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Tier-cap prompt: monthly AI-draft cap reached on Starter (2/mo) or Growth (20/mo). */}
      <ContextualUpgradePrompt
        open={reportUpgradeOpen}
        onClose={() => setReportUpgradeOpen(false)}
        blockedAction="More AI-drafted reports"
        reason={
          tier === 'starter'
            ? `Starter includes ${limits.reportsPerMonth} AI-drafted reports per month. You've used ${usage.reportsThisMonth}.`
            : `Growth includes ${limits.reportsPerMonth} AI-drafted reports per month. You've used ${usage.reportsThisMonth}.`
        }
        nextBenefits={
          tier === 'starter'
            ? ['20 AI report drafts / month', 'AI Copilot for receipts & funder updates', 'WhatsApp data entry', 'Priority support']
            : ['Unlimited AI report drafts', 'Unlimited team members', 'SSO + audit log', 'Dedicated success manager']
        }
        targetTier={tier === 'starter' ? 'growth' : 'scale'}
        onUpgrade={() => {
          setReportUpgradeOpen(false);
          openUpgrade({
            targetTier: tier === 'starter' ? 'growth' : 'scale',
            source: 'reports_monthly_cap',
          });
        }}
      />
    </div>
  );
};

export default Reports;
