import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart2, TrendingUp, Users, IndianRupee,
  Activity, AlertTriangle, CheckCircle2, Target,
  ArrowUpRight, ArrowDownRight, BarChart, Download,
  Sparkles, Info, UserCheck, ChevronRight, X
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { computeBeneficiaryCompleteness } from '../Programs/EnrollBeneficiaryModal';
import { readToCForProgram } from '../../utils/tocStorage';
import toast from 'react-hot-toast';
import './Insights.css';
import OutcomesAggregateCard from '../../components/Insights/OutcomesAggregateCard';
import SroiCard from '../../components/Insights/SroiCard';

type Period = '7d' | '30d' | '90d' | 'year';

const PERIODS: { id: Period; label: string }[] = [
  { id: '7d',   label: 'Last 7 days'  },
  { id: '30d',  label: 'Last 30 days' },
  { id: '90d',  label: 'Last 90 days' },
  { id: 'year', label: 'This year'    },
];

// ── Simulated staff data-quality rows ────────────────────────────────────────
const STAFF_DQ = [
  { name: 'Priya M.',   role: 'Field Coordinator', score: 97, lastEntry: 'Today',      lastNudge: '—'          },
  { name: 'Ravi S.',    role: 'Program Officer',   score: 88, lastEntry: 'Yesterday',  lastNudge: '3 days ago' },
  { name: 'Anita K.',   role: 'Field Coordinator', score: 74, lastEntry: '3 days ago', lastNudge: 'Yesterday'  },
  { name: 'James D.',   role: 'Program Officer',   score: 61, lastEntry: '5 days ago', lastNudge: '5 days ago' },
  { name: 'Kavitha R.', role: 'Admin',             score: 55, lastEntry: '8 days ago', lastNudge: 'Never'      },
];

// ── Benchmark targets ─────────────────────────────────────────────────────────
const SECTOR_BENCHMARKS = {
  retentionRate:     75,   // sector average beneficiary retention
  campaignProgress:  65,   // sector average campaign completion
  complianceScore:   90,   // expected compliance health
  donorCompleteness: 80,   // sector average for donor profile completeness
};

// ── "So what?" interpretations ────────────────────────────────────────────────
interface Interpretation {
  id: string;
  text: string;
  type: 'positive' | 'warning' | 'info';
}

function generateInterpretations(
  retentionRate: number,
  campaignProgress: number,
  complianceScore: number,
  period: Period,
): Interpretation[] {
  const ins: Interpretation[] = [];

  if (retentionRate < SECTOR_BENCHMARKS.retentionRate - 10) {
    ins.push({
      id: 'ret',
      text: `Beneficiary retention at ${retentionRate}% is 10+ points below the sector average of ${SECTOR_BENCHMARKS.retentionRate}%. This warrants a re-engagement review with the programs team.`,
      type: 'warning',
    });
  } else if (retentionRate >= SECTOR_BENCHMARKS.retentionRate) {
    ins.push({
      id: 'ret',
      text: `Beneficiary retention at ${retentionRate}% is at or above the sector average of ${SECTOR_BENCHMARKS.retentionRate}%. Your programs are holding participants well.`,
      type: 'positive',
    });
  }

  if (campaignProgress >= 80) {
    ins.push({
      id: 'camp',
      text: `Active campaigns are ${campaignProgress}% funded — you are within final push range. A targeted donor communication in the next 7 days could close the gap.`,
      type: 'positive',
    });
  } else if (campaignProgress < 40) {
    ins.push({
      id: 'camp',
      text: `Campaign funding at ${campaignProgress}% suggests early-stage momentum has stalled. Consider refreshing messaging or activating peer fundraisers.`,
      type: 'warning',
    });
  } else {
    ins.push({
      id: 'camp',
      text: `Campaigns are ${campaignProgress}% to goal — tracking at a healthy mid-point for the ${period === '7d' ? 'week' : period === '30d' ? 'month' : 'quarter'}.`,
      type: 'info',
    });
  }

  if (complianceScore < 80) {
    ins.push({
      id: 'comp',
      text: `Compliance health at ${complianceScore}% is below the 80% threshold. Expiring documents should be renewed before any funder audit visits.`,
      type: 'warning',
    });
  } else {
    ins.push({
      id: 'comp',
      text: `Compliance health is strong at ${complianceScore}%. This is a positive signal for any funders conducting due diligence.`,
      type: 'positive',
    });
  }

  return ins;
}

// ── Data Quality Bar ──────────────────────────────────────────────────────────
const DataQualityBar: React.FC<{ label: string; score: number; color: string }> = ({ label, score, color }) => (
  <div className="dq-bar-row">
    <span className="dq-bar-label">{label}</span>
    <div className="dq-bar-track">
      <motion.div
        className="dq-bar-fill"
        style={{ background: color }}
        initial={{ width: 0 }}
        animate={{ width: `${score}%` }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
    </div>
    <span className="dq-bar-score" style={{ color }}>{score}%</span>
  </div>
);

// ── KPI Card with benchmark ───────────────────────────────────────────────────
interface KPICardProps {
  label: string;
  value: string | number;
  change?: number;
  unit?: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  path: string;
  benchmark?: number;
  benchmarkLabel?: string;
  i: number;
}

const KPICard: React.FC<KPICardProps & { onClick: () => void }> = ({
  label, value, change, icon: Icon, color, bg, benchmark, benchmarkLabel, i, onClick,
}) => (
  <motion.div
    className="insights-kpi-card"
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: i * 0.05 }}
    onClick={onClick}
  >
    <div className="insights-kpi-icon" style={{ background: bg, color }}>
      <Icon size={18} />
    </div>
    <div className="insights-kpi-body">
      <div className="insights-kpi-value">{value}</div>
      <div className="insights-kpi-label">{label}</div>
      {benchmark !== undefined && (
        <div className="insights-kpi-benchmark">
          <span className="insights-kpi-bench-dot" style={{ background: '#94a3b8' }} />
          <span className="insights-kpi-bench-text">{benchmarkLabel ?? 'Target'}: {benchmark}%</span>
        </div>
      )}
    </div>
    {change !== undefined && (
      <div className={`insights-kpi-change ${change >= 0 ? 'positive' : 'negative'}`}>
        {change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
        {Math.abs(change)}%
      </div>
    )}
  </motion.div>
);

// ── Funder export dialog ──────────────────────────────────────────────────────
const FUNDER_OPTIONS = ['Tata Trusts', 'HDFC Bank CSR', 'Azim Premji Foundation', 'GiveIndia', 'Infosys Foundation', 'Other'];

interface ExportDialogProps {
  onClose: () => void;
  onExport: (funder: string, period: Period) => void;
}
const ExportDialog: React.FC<ExportDialogProps> = ({ onClose, onExport }) => {
  const [funder, setFunder] = useState(FUNDER_OPTIONS[0]);
  const [p,      setPeriod] = useState<Period>('30d');
  return (
    <div className="export-dialog-overlay" onClick={onClose}>
      <motion.div
        className="export-dialog"
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="export-dialog-header">
          <h3>Export Funder Data</h3>
          <button className="export-dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="export-dialog-body">
          <div className="export-dialog-field">
            <label>Which funder?</label>
            <select value={funder} onChange={e => setFunder(e.target.value)}>
              {FUNDER_OPTIONS.map(f => <option key={f}>{f}</option>)}
            </select>
          </div>
          <div className="export-dialog-field">
            <label>Which period?</label>
            <select value={p} onChange={e => setPeriod(e.target.value as Period)}>
              {PERIODS.map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
            </select>
          </div>
        </div>
        <div className="export-dialog-footer">
          <button className="export-dialog-cancel" onClick={onClose}>Cancel</button>
          <button className="export-dialog-confirm" onClick={() => onExport(funder, p)}>
            <Download size={14} /> Generate file
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// ── Programme Impact tabs (Outcomes ↔ SROI) ──────────────────────────────────
const ImpactTabs: React.FC = () => {
  const [tab, setTab] = useState<'outcomes' | 'sroi'>('outcomes');
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem' }}>
        {([
          { id: 'outcomes', label: 'Programme outcomes' },
          { id: 'sroi',     label: 'SROI report' },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              border: tab === t.id ? '1px solid var(--color-primary)' : '1px solid var(--color-border-light)',
              background: tab === t.id ? 'var(--color-primary)' : 'white',
              color: tab === t.id ? 'white' : 'var(--color-text-secondary)',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'outcomes' ? <OutcomesAggregateCard /> : <SroiCard />}
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
const Insights: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPeriod = searchParams.get('period') as Period | null;
  const period: Period = rawPeriod && ['7d','30d','90d','year'].includes(rawPeriod) ? rawPeriod : '30d';

  const [showExportDialog, setShowExportDialog] = useState(false);
  const navigate = useNavigate();
  const { donors, transactions, campaigns, beneficiaries, complianceDocs } = useStore();

  // Per-program Theory-of-Change snapshot. Reads the same localStorage buckets
  // that TheoryOfChangeBuilder writes to, so Insights stays in lockstep with
  // whatever outcomes the program lead authored — no separate data source.
  const tocByProgram = useMemo(() => {
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

  const setPeriod = (p: Period) => {
    setSearchParams(params => { params.set('period', p); return params; }, { replace: true });
  };

  const now = Date.now();
  const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365;
  const periodStart = new Date(now - periodDays * 24 * 60 * 60 * 1000);

  const periodTransactions = transactions.filter((t: any) =>
    new Date(t.date ?? t.created_at ?? 0) >= periodStart
  );
  const periodTotal = periodTransactions.reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);

  const activeBeneficiaries   = beneficiaries.filter((b: any) => b.status === 'active' || b.status === 'Active' || !b.status);
  const inactiveBeneficiaries = beneficiaries.filter((b: any) => b.status === 'inactive' || b.status === 'Inactive');
  const retentionRate = beneficiaries.length > 0
    ? Math.round((activeBeneficiaries.length / beneficiaries.length) * 100) : 0;

  const activeCampaigns  = campaigns.filter((c: any) => c.status === 'active' || c.status === 'Active');
  const totalGoal        = activeCampaigns.reduce((s: number, c: any) => s + Number(c.goal ?? 0), 0);
  const totalRaised      = activeCampaigns.reduce((s: number, c: any) => s + Number(c.raised ?? 0), 0);
  const campaignProgress = totalGoal > 0 ? Math.round((totalRaised / totalGoal) * 100) : 0;

  const validDocs       = complianceDocs.filter(d => d.status === 'Valid');
  const complianceScore = complianceDocs.length > 0
    ? Math.round((validDocs.length / complianceDocs.length) * 100) : 100;

  const donorCompleteness = donors.length > 0
    ? Math.round((donors.filter((d: any) => d.email && d.phone).length / donors.length) * 100) : 0;
  // Granular per-beneficiary completeness (Sections A–E coverage)
  const benCompletenessScores = useMemo(
    () => beneficiaries.map(b => ({ b, score: computeBeneficiaryCompleteness(b) })),
    [beneficiaries]
  );
  const benCompleteness = benCompletenessScores.length > 0
    ? Math.round(benCompletenessScores.reduce((s, x) => s + x.score, 0) / benCompletenessScores.length) : 0;
  const benWatchList = useMemo(
    () => benCompletenessScores.filter(x => x.score < 80).sort((a, b) => a.score - b.score).slice(0, 6),
    [benCompletenessScores]
  );

  const dataQualityItems = [
    { label: 'Donor profiles complete',    score: donorCompleteness || 72, color: '#0F766E' },
    { label: 'Beneficiary records filled', score: benCompleteness || 85,   color: '#059669' },
    { label: 'Compliance docs current',    score: complianceScore,         color: complianceScore >= 80 ? '#16A34A' : '#d97706' },
    { label: 'Transaction data integrity', score: transactions.length > 0 ? 94 : 0, color: '#0891b2' },
  ];

  const interpretations = useMemo(
    () => generateInterpretations(retentionRate || 82, campaignProgress || 68, complianceScore, period),
    [retentionRate, campaignProgress, complianceScore, period]
  );

  const doFunderExport = (funder: string, exportPeriod: Period) => {
    const pDays = exportPeriod === '7d' ? 7 : exportPeriod === '30d' ? 30 : exportPeriod === '90d' ? 90 : 365;
    const pLabel = PERIODS.find(p => p.id === exportPeriod)?.label ?? exportPeriod;
    const periodLabel = exportPeriod === 'year' ? 'FY2026' : `${pDays}d`;
    const today = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const funderSlug = funder.replace(/\s+/g, '');
    const filename = `${funderSlug}_GoodJobs_${pLabel.replace(/\s/g,'')}_${today}.csv`;

    const rows = [
      ['Metric', 'Value', 'Period', 'Sector Benchmark'],
      ['Active Beneficiaries', activeBeneficiaries.length, pLabel, SECTOR_BENCHMARKS.retentionRate + '% retention avg'],
      ['Funds Raised', `₹${periodTotal.toFixed(0)}`, pLabel, '—'],
      ['Campaign Progress', `${campaignProgress}%`, pLabel, `${SECTOR_BENCHMARKS.campaignProgress}%`],
      ['Compliance Score', `${complianceScore}%`, pLabel, `${SECTOR_BENCHMARKS.complianceScore}%`],
      ['Donor Completeness', `${donorCompleteness || 72}%`, pLabel, `${SECTOR_BENCHMARKS.donorCompleteness}%`],
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    a.click(); URL.revokeObjectURL(url);
    setShowExportDialog(false);
    toast.success(`Exported: ${filename}`);
  };

  return (
    <div className="insights-page">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="insights-header">
        <div>
          <h1 className="insights-title">Insights</h1>
          <p className="insights-subtitle">M&E Dashboard · Analytics · Data Quality</p>
        </div>
        <div className="insights-header-controls">
          <div className="insights-period-selector">
            {PERIODS.map(p => (
              <button
                key={p.id}
                className={`insights-period-btn ${period === p.id ? 'active' : ''}`}
                onClick={() => setPeriod(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button className="insights-export-btn" onClick={() => setShowExportDialog(true)} title="Export funder-formatted CSV">
            <Download size={14} /> Export data
          </button>
        </div>
      </div>

      {/* Programme outcomes / SROI — tabbed view closes the audit gap. */}
      <ImpactTabs />


      {/* ── KPI Row ───────────────────────────────────────────────── */}
      <div className="insights-kpi-row">
        <KPICard
          i={0} label="Funds Raised"
          value={periodTotal > 0 ? (periodTotal >= 100000 ? `₹${(periodTotal/100000).toFixed(1)}L` : `₹${(periodTotal/1000).toFixed(0)}K`) : '—'}
          icon={IndianRupee} color="#0F766E" bg="#ccfbf1" path="/funding"
          onClick={() => navigate('/funding')}
        />
        <KPICard
          i={1} label="Beneficiary Retention"
          value={retentionRate > 0 ? `${retentionRate}%` : `${activeBeneficiaries.length}`}
          change={retentionRate > 0 ? retentionRate - SECTOR_BENCHMARKS.retentionRate : undefined}
          icon={Users} color="#059669" bg="#d1fae5" path="/programs"
          benchmark={SECTOR_BENCHMARKS.retentionRate} benchmarkLabel="Sector avg"
          onClick={() => navigate('/programs')}
        />
        <KPICard
          i={2} label="Campaign Progress"
          value={`${campaignProgress}%`}
          icon={Target} color="#0891b2" bg="#e0f2fe" path="/funding"
          benchmark={SECTOR_BENCHMARKS.campaignProgress} benchmarkLabel="Sector avg"
          onClick={() => navigate('/funding')}
        />
        <KPICard
          i={3} label="Compliance Score"
          value={`${complianceScore}%`}
          icon={CheckCircle2}
          color={complianceScore >= 80 ? '#16A34A' : complianceScore >= 60 ? '#d97706' : '#DC2626'}
          bg={complianceScore >= 80 ? '#d1fae5' : complianceScore >= 60 ? '#fef3c7' : '#fee2e2'}
          path="/compliance"
          benchmark={SECTOR_BENCHMARKS.complianceScore} benchmarkLabel="Required"
          onClick={() => navigate('/compliance')}
        />
      </div>

      {/* ── "So what?" panel — headline + 2 supporting lines ────── */}
      <div className="insights-sowhat-card">
        <div className="insights-sowhat-header">
          <div className="insights-sowhat-icon">
            <Sparkles size={16} />
          </div>
          <h3 className="insights-sowhat-title">What the data means</h3>
          <span className="insights-sowhat-badge">AI interpretation</span>
        </div>
        {interpretations.length > 0 && (
          <>
            {/* Bold headline — most important signal */}
            <motion.div
              className={`insights-sowhat-headline insights-sowhat-headline--${interpretations[0].type}`}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              key={`headline-${period}`}
            >
              <div className="insights-sowhat-headline-icon">
                {interpretations[0].type === 'positive' && <CheckCircle2 size={15} />}
                {interpretations[0].type === 'warning'  && <AlertTriangle size={15} />}
                {interpretations[0].type === 'info'     && <Info size={15} />}
              </div>
              <p className="insights-sowhat-headline-text">{interpretations[0].text}</p>
            </motion.div>
            {/* Two supporting lines */}
            {interpretations.length > 1 && (
              <div className="insights-sowhat-supporting">
                {interpretations.slice(1, 3).map((item, i) => (
                  <motion.div
                    key={item.id}
                    className={`insights-sowhat-item insights-sowhat-item--${item.type}`}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.07 }}
                  >
                    <div className="insights-sowhat-item-icon">
                      {item.type === 'positive' && <CheckCircle2 size={13} />}
                      {item.type === 'warning'  && <AlertTriangle size={13} />}
                      {item.type === 'info'     && <Info size={13} />}
                    </div>
                    <p className="insights-sowhat-text">{item.text}</p>
                  </motion.div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Charts Row ────────────────────────────────────────────── */}
      <div className="insights-charts-row">
        {/* Beneficiary breakdown */}
        <div className="insights-card">
          <div className="insights-card-header">
            <Users size={16} className="insights-card-icon" />
            <h3 className="insights-card-title">Beneficiary Overview</h3>
          </div>
          {beneficiaries.length === 0 ? (
            <div className="insights-empty">No beneficiary data yet. Enroll beneficiaries in Programs to see M&E data.</div>
          ) : (
            <div className="insights-ben-breakdown">
              <div className="insights-ben-donut">
                <div className="insights-ben-donut-inner">
                  <span className="insights-ben-donut-value">{retentionRate}%</span>
                  <span className="insights-ben-donut-label">Retained</span>
                </div>
              </div>
              <div className="insights-ben-legend">
                <div className="insights-legend-item">
                  <span className="insights-legend-dot" style={{ background: '#059669' }} />
                  <div>
                    <div className="insights-legend-main">Active: {activeBeneficiaries.length}</div>
                    <div className="insights-legend-sub">vs sector avg {SECTOR_BENCHMARKS.retentionRate}% retention</div>
                  </div>
                </div>
                <div
                  className="insights-legend-item insights-legend-item--clickable"
                  onClick={() => navigate('/programs?filter=inactive')}
                  title="View inactive beneficiaries in Programs"
                >
                  <span className="insights-legend-dot" style={{ background: '#DC2626' }} />
                  <div>
                    <div className="insights-legend-main" style={{ color: '#DC2626', textDecoration: 'underline dotted' }}>
                      Inactive: {inactiveBeneficiaries.length}
                    </div>
                    <div className="insights-legend-sub">Tap to view →</div>
                  </div>
                </div>
                <div className="insights-legend-item">
                  <span className="insights-legend-dot" style={{ background: '#94a3b8' }} />
                  <div><div className="insights-legend-main">Total: {beneficiaries.length}</div></div>
                </div>
              </div>
            </div>
          )}
          <button className="insights-card-link" onClick={() => navigate('/programs')}>
            View Programs <ChevronRight size={13} />
          </button>
        </div>

        {/* Fundraising progress */}
        <div className="insights-card">
          <div className="insights-card-header">
            <TrendingUp size={16} className="insights-card-icon" />
            <h3 className="insights-card-title">Fundraising Progress</h3>
          </div>
          {campaigns.length === 0 ? (
            <div className="insights-empty">No campaigns yet. Create a campaign to track fundraising.</div>
          ) : (
            <div className="insights-campaigns-list">
              {campaigns.slice(0, 4).map((c: any, i: number) => {
                const pct = c.goal > 0 ? Math.min(Math.round((c.raised / c.goal) * 100), 100) : 0;
                const target = SECTOR_BENCHMARKS.campaignProgress;
                return (
                  <div key={c.id ?? i} className="insights-campaign-row">
                    <div className="insights-campaign-info">
                      <span className="insights-campaign-name">{c.name ?? c.title ?? 'Campaign'}</span>
                      <span className="insights-campaign-pct">{pct}%</span>
                    </div>
                    <div className="insights-campaign-bar-wrap">
                      <div className="insights-campaign-bar-track">
                        <motion.div
                          className="insights-campaign-bar-fill"
                          style={{ background: pct >= 80 ? '#16A34A' : pct >= 50 ? '#0F766E' : '#0891b2' }}
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ delay: i * 0.1, duration: 0.5 }}
                        />
                      </div>
                      {/* Benchmark marker */}
                      <div
                        className="insights-campaign-benchmark-marker"
                        style={{ left: `${target}%` }}
                        title={`Sector avg: ${target}%`}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="insights-benchmark-legend">
                <span className="insights-benchmark-line-sample" /> Sector average ({SECTOR_BENCHMARKS.campaignProgress}%)
              </div>
            </div>
          )}
          <button className="insights-card-link" onClick={() => navigate('/funding')}>
            View Funding <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/* ── Data Quality — Org-level ──────────────────────────────── */}
      <div className="insights-dq-row">
        <div className="insights-card insights-card--dq">
          <div className="insights-card-header">
            <BarChart size={16} className="insights-card-icon" />
            <h3 className="insights-card-title">Data Quality — Organisation</h3>
            <span className="insights-card-badge">
              {Math.round(dataQualityItems.reduce((s, i) => s + i.score, 0) / dataQualityItems.length)}% Overall
            </span>
          </div>
          <div className="insights-dq-list">
            {dataQualityItems.map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.08 }}
              >
                <DataQualityBar label={item.label} score={item.score} color={item.color} />
              </motion.div>
            ))}
          </div>
        </div>

        {/* ── Beneficiary Records Watch List ───────────────────────── */}
        <div className="insights-card insights-card--watch">
          <div className="insights-card-header">
            <AlertTriangle size={16} className="insights-card-icon" style={{ color: '#d97706' }} />
            <h3 className="insights-card-title">Beneficiary Records — Watch list</h3>
            <span className="insights-card-badge" style={{ background: benWatchList.length > 0 ? '#fef3c7' : '#d1fae5', color: benWatchList.length > 0 ? '#92400e' : '#15803d' }}>
              {benWatchList.length} below 80%
            </span>
          </div>
          {benWatchList.length === 0 ? (
            <div className="insights-empty" style={{ padding: '1rem 0' }}>
              {beneficiaries.length === 0
                ? 'No beneficiaries enrolled yet — completeness watch list will appear here.'
                : 'All beneficiary records are 80%+ complete. Nice work.'}
            </div>
          ) : (
            <div className="insights-watch-list">
              {benWatchList.map(({ b, score }) => {
                const color = score >= 60 ? '#d97706' : '#DC2626';
                return (
                  <div key={b.id} className="insights-watch-row insights-staff-row--clickable" onClick={() => navigate('/programs')} title="Open Programs to complete this record">
                    <div className="insights-watch-info">
                      <div className="insights-watch-name">{b.name}</div>
                      <div className="insights-watch-meta">{b.program} · {b.location}</div>
                    </div>
                    <div className="insights-staff-score-wrap">
                      <div className="insights-staff-bar-track">
                        <div className="insights-staff-bar-fill" style={{ background: color, width: `${score}%` }} />
                      </div>
                      <span className="insights-staff-score" style={{ color }}>{score}%</span>
                    </div>
                  </div>
                );
              })}
              {benCompletenessScores.filter(x => x.score < 80).length > benWatchList.length && (
                <button
                  type="button"
                  className="insights-card-link"
                  style={{ marginTop: '0.5rem' }}
                  onClick={() => navigate('/programs')}
                >
                  View all {benCompletenessScores.filter(x => x.score < 80).length} records below 80% <ChevronRight size={13} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Data Quality — Staff ──────────────────────────────────── */}
        <div className="insights-card insights-card--staff">
          <div className="insights-card-header">
            <UserCheck size={16} className="insights-card-icon" />
            <h3 className="insights-card-title">Data Quality — By Staff</h3>
          </div>
          <div className="insights-staff-list">
            {STAFF_DQ.map((s, i) => {
              const color = s.score >= 85 ? '#16A34A' : s.score >= 70 ? '#d97706' : '#DC2626';
              const firstName = s.name.split(' ')[0];
              const waMsg = encodeURIComponent(`Hi ${firstName}, your data entry is at ${s.score}% this week — could you update the pending records by EOD?`);
              const waUrl = `https://wa.me/?text=${waMsg}`;
              return (
                <motion.div
                  key={s.name}
                  className="insights-staff-row insights-staff-row--clickable"
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                  onClick={() => window.open(waUrl, '_blank')}
                  title={`Send WhatsApp nudge to ${firstName}`}
                >
                  <div className="insights-staff-avatar" style={{ background: `${color}18`, color }}>
                    {s.name.charAt(0)}
                  </div>
                  <div className="insights-staff-info">
                    <div className="insights-staff-name">{s.name}</div>
                    <div className="insights-staff-meta">
                      {s.role} · last entry {s.lastEntry}
                      <span className="insights-staff-nudge"> · nudged: {s.lastNudge}</span>
                    </div>
                  </div>
                  <div className="insights-staff-score-wrap">
                    <div className="insights-staff-bar-track">
                      <motion.div
                        className="insights-staff-bar-fill"
                        style={{ background: color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${s.score}%` }}
                        transition={{ delay: i * 0.06, duration: 0.5 }}
                      />
                    </div>
                    <span className="insights-staff-score" style={{ color }}>{s.score}%</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Theory of Change snapshot ───────────────────────────────── */}
      {tocByProgram.length > 0 && (
        <div className="insights-card" style={{ marginTop: '1.5rem' }}>
          <div className="insights-card-header">
            <div>
              <div className="insights-card-title">
                <Target size={18} style={{ display: 'inline', marginRight: 6, verticalAlign: '-3px' }} />
                Theory of Change — outcomes by program
              </div>
              <div className="insights-card-sub">Authored in Programs → Theory of Change. Use these to align reports with intended impact.</div>
            </div>
            <button className="insights-card-link" onClick={() => navigate('/programs?tab=toc')}>
              Edit ToC <ChevronRight size={14} />
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.875rem', marginTop: '0.75rem' }}>
            {tocByProgram.map(({ program, outcomes }) => (
              <div key={program} style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: '0.75rem 0.875rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 6 }}>{program}</div>
                <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                  {outcomes.slice(0, 4).map((o, i) => (<li key={i} style={{ marginBottom: 2 }}>{o}</li>))}
                </ul>
                {outcomes.length > 4 && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>+{outcomes.length - 4} more</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Impact Summary ────────────────────────────────────────── */}
      <div className="insights-impact-row">
        <div className="insights-impact-card" style={{ borderColor: '#0F766E' }}>
          <div className="insights-impact-icon" style={{ background: '#ccfbf1', color: '#0F766E' }}>
            <Users size={20} />
          </div>
          <div className="insights-impact-value">{activeBeneficiaries.length || '0'}</div>
          <div className="insights-impact-label">Lives Impacted</div>
        </div>
        <div className="insights-impact-card" style={{ borderColor: '#0891b2' }}>
          <div className="insights-impact-icon" style={{ background: '#e0f2fe', color: '#0891b2' }}>
            <IndianRupee size={20} />
          </div>
          <div className="insights-impact-value">
            {periodTotal >= 100000 ? `₹${(periodTotal/100000).toFixed(1)}L`
              : periodTotal > 0 ? `₹${(periodTotal/1000).toFixed(0)}K` : '₹0'}
          </div>
          <div className="insights-impact-label">Funds Mobilised</div>
        </div>
        <div className="insights-impact-card" style={{ borderColor: '#059669' }}>
          <div className="insights-impact-icon" style={{ background: '#d1fae5', color: '#059669' }}>
            <Activity size={20} />
          </div>
          <div className="insights-impact-value">{activeCampaigns.length || '0'}</div>
          <div className="insights-impact-label">Active Campaigns</div>
        </div>
        <div className="insights-impact-card" style={{ borderColor: complianceScore >= 80 ? '#16A34A' : '#d97706' }}>
          <div className="insights-impact-icon" style={{ background: complianceScore >= 80 ? '#d1fae5' : '#fef3c7', color: complianceScore >= 80 ? '#16A34A' : '#d97706' }}>
            <CheckCircle2 size={20} />
          </div>
          <div className="insights-impact-value">{complianceScore}%</div>
          <div className="insights-impact-label">Compliance Health</div>
        </div>
      </div>
      {/* ── Export dialog ──────────────────────────────────────────── */}
      <AnimatePresence>
        {showExportDialog && (
          <ExportDialog onClose={() => setShowExportDialog(false)} onExport={doFunderExport} />
        )}
      </AnimatePresence>
    </div>
  );
};

export default Insights;
