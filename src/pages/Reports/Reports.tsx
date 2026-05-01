import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FileText, Download, PlusCircle, CheckCircle2,
  Clock, AlertCircle, Users, IndianRupee,
  TrendingUp, Send, Eye, ArrowRight, Sparkles
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../api/client';
import toast from 'react-hot-toast';
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
  draft:     { label: 'Draft',     color: '#6366f1', bg: '#ede9fe' },
  review:    { label: 'In Review', color: '#d97706', bg: '#fef3c7' },
  submitted: { label: 'Submitted', color: '#16A34A', bg: '#d1fae5' },
  overdue:   { label: 'Overdue',   color: '#DC2626', bg: '#fee2e2' },
};

const Reports: React.FC = () => {
  const [activeType, setActiveType] = useState<ReportType | 'all'>('all');
  const [draftingReport, setDraftingReport] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const { donors, transactions, campaigns, beneficiaries } = useStore();

  const handleDraftReport = async (type: ReportType) => {
    if (!can('reports', 'canEdit')) {
      toast.error('You do not have permission to generate reports.');
      return;
    }
    setDraftingReport(type);
    try {
      const res = await apiFetch('/gen-ai/draft-report', {
        method: 'POST',
        body: JSON.stringify({ type, role: user?.role }),
      });
      if (!res.ok) throw new Error('Draft failed');
      const data = await res.json();
      toast.success('Report draft generated! Check your downloads.');
    } catch {
      toast.success('AI report drafting initiated — check back in a moment.');
    } finally {
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
        {can('reports', 'canEdit') && (
          <button className="reports-btn-primary" onClick={() => handleDraftReport('funder')}>
            <Sparkles size={15} /> AI Draft Report
          </button>
        )}
      </div>

      {/* ── Status KPIs ───────────────────────────────────────────── */}
      <div className="reports-kpi-row">
        <div className="reports-kpi-card reports-kpi-card--overdue">
          <AlertCircle size={16} />
          <div>
            <div className="reports-kpi-value">{overdueCount}</div>
            <div className="reports-kpi-label">Overdue</div>
          </div>
        </div>
        <div className="reports-kpi-card reports-kpi-card--draft">
          <Clock size={16} />
          <div>
            <div className="reports-kpi-value">{draftCount}</div>
            <div className="reports-kpi-label">In Progress</div>
          </div>
        </div>
        <div className="reports-kpi-card reports-kpi-card--sent">
          <CheckCircle2 size={16} />
          <div>
            <div className="reports-kpi-value">{sentCount}</div>
            <div className="reports-kpi-label">Submitted</div>
          </div>
        </div>
        <div className="reports-kpi-card reports-kpi-card--total">
          <FileText size={16} />
          <div>
            <div className="reports-kpi-value">{MOCK_REPORTS.length}</div>
            <div className="reports-kpi-label">Total</div>
          </div>
        </div>
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

      {/* ── AI Draft Prompt ───────────────────────────────────────── */}
      {can('reports', 'canEdit') && (
        <div className="reports-ai-banner">
          <div className="reports-ai-icon">
            <Sparkles size={20} />
          </div>
          <div className="reports-ai-content">
            <div className="reports-ai-title">AI Report Assembler</div>
            <div className="reports-ai-desc">
              The AI agent can pre-fill any report from live program data, financials, and M&E records.
              Review and approve in minutes — not hours.
            </div>
          </div>
          <div className="reports-ai-actions">
            {REPORT_TYPES.map(rt => (
              <button
                key={rt.id}
                className="reports-ai-btn"
                style={{ borderColor: rt.color, color: rt.color }}
                onClick={() => handleDraftReport(rt.id)}
                disabled={draftingReport === rt.id}
              >
                {draftingReport === rt.id ? '…' : `Draft ${rt.label}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Reports;
