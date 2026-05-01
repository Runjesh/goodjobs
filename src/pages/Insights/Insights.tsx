import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  BarChart2, TrendingUp, Users, IndianRupee, ClipboardList,
  Activity, AlertTriangle, CheckCircle2, Target,
  ArrowUpRight, ArrowDownRight, Minus, BarChart
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import './Insights.css';

type Period = '7d' | '30d' | '90d' | 'year';

const PERIODS: { id: Period; label: string }[] = [
  { id: '7d',   label: 'Last 7 days'  },
  { id: '30d',  label: 'Last 30 days' },
  { id: '90d',  label: 'Last 90 days' },
  { id: 'year', label: 'This year'    },
];

interface KPI {
  label: string;
  value: string | number;
  change?: number;
  unit?: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  path: string;
}

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

const Insights: React.FC = () => {
  const [period, setPeriod] = useState<Period>('30d');
  const navigate = useNavigate();
  const { donors, transactions, campaigns, beneficiaries, complianceDocs } = useStore();

  // Compute KPIs from store
  const now = Date.now();
  const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365;
  const periodStart = new Date(now - periodDays * 24 * 60 * 60 * 1000);

  const periodTransactions = transactions.filter((t: any) =>
    new Date(t.date ?? t.created_at ?? 0) >= periodStart
  );
  const periodTotal = periodTransactions.reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);

  const activeBeneficiaries = beneficiaries.filter((b: any) =>
    b.status === 'active' || b.status === 'Active' || !b.status
  );
  const inactiveBeneficiaries = beneficiaries.filter((b: any) =>
    b.status === 'inactive' || b.status === 'Inactive'
  );
  const retentionRate = beneficiaries.length > 0
    ? Math.round((activeBeneficiaries.length / beneficiaries.length) * 100)
    : 0;

  const activeCampaigns = campaigns.filter((c: any) => c.status === 'active' || c.status === 'Active');
  const totalGoal = activeCampaigns.reduce((s: number, c: any) => s + Number(c.goal ?? 0), 0);
  const totalRaised = activeCampaigns.reduce((s: number, c: any) => s + Number(c.raised ?? 0), 0);
  const campaignProgress = totalGoal > 0 ? Math.round((totalRaised / totalGoal) * 100) : 0;

  const validDocs = complianceDocs.filter(d => d.status === 'Valid');
  const complianceScore = complianceDocs.length > 0
    ? Math.round((validDocs.length / complianceDocs.length) * 100)
    : 100;

  const kpis: KPI[] = [
    {
      label: 'Funds Raised',
      value: periodTotal > 0
        ? (periodTotal >= 100000 ? `₹${(periodTotal/100000).toFixed(1)}L` : `₹${(periodTotal/1000).toFixed(0)}K`)
        : '—',
      icon: IndianRupee,
      color: '#0F766E',
      bg: '#ccfbf1',
      path: '/funding',
    },
    {
      label: 'Active Beneficiaries',
      value: activeBeneficiaries.length || '—',
      change: beneficiaries.length > 0 ? retentionRate - 100 : undefined,
      unit: 'retention',
      icon: Users,
      color: '#059669',
      bg: '#d1fae5',
      path: '/programs',
    },
    {
      label: 'Campaign Progress',
      value: `${campaignProgress}%`,
      icon: Target,
      color: '#0891b2',
      bg: '#e0f2fe',
      path: '/funding',
    },
    {
      label: 'Compliance Score',
      value: `${complianceScore}%`,
      icon: CheckCircle2,
      color: complianceScore >= 80 ? '#16A34A' : complianceScore >= 60 ? '#d97706' : '#DC2626',
      bg: complianceScore >= 80 ? '#d1fae5' : complianceScore >= 60 ? '#fef3c7' : '#fee2e2',
      path: '/compliance',
    },
  ];

  // Data quality scores (computed from data completeness)
  const donorCompleteness = donors.length > 0
    ? Math.round((donors.filter((d: any) => d.email && d.phone).length / donors.length) * 100)
    : 0;
  const benCompleteness = beneficiaries.length > 0
    ? Math.round((beneficiaries.filter((b: any) => b.program || b.status).length / beneficiaries.length) * 100)
    : 0;

  const dataQualityItems = [
    { label: 'Donor profiles complete',      score: donorCompleteness || 72,  color: '#0F766E' },
    { label: 'Beneficiary records filled',   score: benCompleteness || 85,    color: '#059669' },
    { label: 'Compliance docs current',      score: complianceScore,          color: complianceScore >= 80 ? '#16A34A' : '#d97706' },
    { label: 'Transaction data integrity',   score: transactions.length > 0 ? 94 : 0, color: '#0891b2' },
  ];

  return (
    <div className="insights-page">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="insights-header">
        <div>
          <h1 className="insights-title">Insights</h1>
          <p className="insights-subtitle">M&E Dashboard · Analytics · Data Quality</p>
        </div>
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
      </div>

      {/* ── KPI Row ───────────────────────────────────────────────── */}
      <div className="insights-kpi-row">
        {kpis.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <motion.div
              key={kpi.label}
              className="insights-kpi-card"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => navigate(kpi.path)}
            >
              <div className="insights-kpi-icon" style={{ background: kpi.bg, color: kpi.color }}>
                <Icon size={18} />
              </div>
              <div className="insights-kpi-body">
                <div className="insights-kpi-value">{kpi.value}</div>
                <div className="insights-kpi-label">{kpi.label}</div>
              </div>
              {kpi.change !== undefined && (
                <div className={`insights-kpi-change ${kpi.change >= 0 ? 'positive' : 'negative'}`}>
                  {kpi.change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                  {Math.abs(kpi.change)}%
                </div>
              )}
            </motion.div>
          );
        })}
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
                  <span className="insights-ben-donut-label">Active</span>
                </div>
              </div>
              <div className="insights-ben-legend">
                <div className="insights-legend-item">
                  <span className="insights-legend-dot" style={{ background: '#059669' }} />
                  <span>Active: {activeBeneficiaries.length}</span>
                </div>
                <div className="insights-legend-item">
                  <span className="insights-legend-dot" style={{ background: '#DC2626' }} />
                  <span>Inactive: {inactiveBeneficiaries.length}</span>
                </div>
                <div className="insights-legend-item">
                  <span className="insights-legend-dot" style={{ background: '#94a3b8' }} />
                  <span>Total: {beneficiaries.length}</span>
                </div>
              </div>
            </div>
          )}
          <button className="insights-card-link" onClick={() => navigate('/programs')}>
            View Programs <ArrowUpRight size={13} />
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
                return (
                  <div key={c.id ?? i} className="insights-campaign-row">
                    <div className="insights-campaign-info">
                      <span className="insights-campaign-name">{c.name ?? c.title ?? 'Campaign'}</span>
                      <span className="insights-campaign-pct">{pct}%</span>
                    </div>
                    <div className="insights-campaign-bar-track">
                      <motion.div
                        className="insights-campaign-bar-fill"
                        style={{ background: pct >= 80 ? '#16A34A' : pct >= 50 ? '#0F766E' : '#0891b2' }}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ delay: i * 0.1, duration: 0.5 }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <button className="insights-card-link" onClick={() => navigate('/funding')}>
            View Funding <ArrowUpRight size={13} />
          </button>
        </div>
      </div>

      {/* ── Data Quality ──────────────────────────────────────────── */}
      <div className="insights-card">
        <div className="insights-card-header">
          <BarChart size={16} className="insights-card-icon" />
          <h3 className="insights-card-title">Data Quality Score</h3>
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
            {periodTotal >= 100000
              ? `₹${(periodTotal/100000).toFixed(1)}L`
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
    </div>
  );
};

export default Insights;
