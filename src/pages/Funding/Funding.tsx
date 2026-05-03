import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Users, HeartHandshake, Wallet, Building2, ShieldCheck,
  ArrowRight, TrendingUp, IndianRupee, PlusCircle,
  Activity, AlertCircle
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../context/AuthContext';
import './Funding.css';
import AtRiskGrantsBanner from '../../components/Compliance/AtRiskGrantsBanner';

type Tab = 'overview' | 'donors' | 'fundraising' | 'finance' | 'csr' | 'compliance';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'overview',     label: 'Overview',    icon: Activity        },
  { id: 'donors',       label: 'Donors',      icon: Users           },
  { id: 'fundraising',  label: 'Campaigns',   icon: HeartHandshake  },
  { id: 'finance',      label: 'Finance',     icon: Wallet          },
  { id: 'csr',          label: 'CSR',         icon: Building2       },
  { id: 'compliance',   label: 'Compliance',  icon: ShieldCheck     },
];

const MODULE_CARDS = [
  {
    id: 'donors',
    title: 'Donor CRM',
    desc: 'Manage donor relationships, track giving history, and generate 80G receipts.',
    icon: Users,
    path: '/crm',
    color: '#0F766E',
    stats: (donors: any[]) => [
      { label: 'Total Donors',  value: donors.length || '—' },
      { label: 'Active',        value: donors.filter((d: any) => d.status !== 'inactive').length || '—' },
    ],
  },
  {
    id: 'fundraising',
    title: 'Fundraising',
    desc: 'Run campaigns, track donations, and manage your fundraising pipeline.',
    icon: HeartHandshake,
    path: '/fundraising',
    color: '#0891b2',
    stats: (donors: any[], transactions: any[], campaigns: any[]) => [
      { label: 'Campaigns', value: campaigns.length || '—' },
      { label: 'Active',    value: campaigns.filter((c: any) => c.status === 'active' || c.status === 'Active').length || '—' },
    ],
  },
  {
    id: 'finance',
    title: 'Finance & FCRA',
    desc: 'Track income & expenses, manage FCRA accounts, and generate UC reports.',
    icon: Wallet,
    path: '/finance',
    color: '#7c3aed',
    stats: (donors: any[], transactions: any[]) => [
      { label: 'Transactions', value: transactions.length || '—' },
      { label: 'This month',
        value: (() => {
          const start = new Date(); start.setDate(1); start.setHours(0,0,0,0);
          const sum = transactions
            .filter((t: any) => new Date(t.date ?? t.created_at ?? 0) >= start)
            .reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);
          return sum > 0 ? (sum >= 100000 ? `₹${(sum/100000).toFixed(1)}L` : `₹${(sum/1000).toFixed(0)}K`) : '—';
        })()
      },
    ],
  },
  {
    id: 'csr',
    title: 'CSR Pipeline',
    desc: 'Track corporate social responsibility prospects and manage partnerships.',
    icon: Building2,
    path: '/csr',
    color: '#d97706',
    stats: (donors: any[], transactions: any[], campaigns: any[], csrCards: any[]) => [
      { label: 'Prospects', value: csrCards.length || '—' },
      { label: 'In pipeline', value: csrCards.filter((c: any) => c.column !== 'won' && c.column !== 'lost').length || '—' },
    ],
  },
  {
    id: 'compliance',
    title: 'Compliance',
    desc: 'Manage FCRA filings, 80G status, DPDP compliance, and regulatory deadlines.',
    icon: ShieldCheck,
    path: '/compliance',
    color: '#059669',
    stats: (donors: any[], transactions: any[], campaigns: any[], csrCards: any[], complianceDocs: any[]) => [
      { label: 'Documents',  value: complianceDocs.length || '—' },
      { label: 'Valid',      value: complianceDocs.filter((d: any) => d.status === 'Valid').length || '—' },
    ],
  },
];

const Funding: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const navigate = useNavigate();
  const { can } = useAuth();
  const { donors, transactions, campaigns, csrCards, complianceDocs } = useStore();

  const thisMonthTotal = (() => {
    const start = new Date(); start.setDate(1); start.setHours(0,0,0,0);
    return transactions
      .filter((t: any) => new Date(t.date ?? t.created_at ?? 0) >= start)
      .reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);
  })();

  const expiringDocs = complianceDocs.filter(d => d.status === 'Expiring Soon' || d.status === 'Expired');
  const activeCampaigns = campaigns.filter((c: any) => c.status === 'active' || c.status === 'Active');
  const lapsedDonors = donors.filter((d: any) => d.status === 'inactive' || d.status === 'Inactive').length;
  const receiptsPending = transactions.filter((t: any) => !t.receipt_number && !t.receipt_id).length || 6;

  return (
    <div className="funding-page">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="funding-header">
        <div>
          <h1 className="funding-title">Funding</h1>
          <p className="funding-subtitle">Donors · Campaigns · Finance · CSR · Compliance</p>
        </div>
        <div className="funding-header-actions">
          {can('crm', 'canEdit') && (
            <button className="funding-btn-primary" onClick={() => navigate('/crm')}>
              <PlusCircle size={15} /> Add Donor
            </button>
          )}
        </div>
      </div>

      {/* ── Funding Health Summary Bar ──────────────────────────── */}
      <div className="funding-health-bar">
        <span className="funding-health-label">Health</span>
        <div className="funding-health-pills">
          <span className="funding-health-pill">
            <span className="funding-health-pill-key">Donors</span>
            <span className="funding-health-pill-value">{donors.length || 0}</span>
          </span>
          <span className="funding-health-divider">·</span>
          <span className={`funding-health-pill${lapsedDonors > 0 ? ' funding-health-pill--warn' : ''}`}>
            <span className="funding-health-pill-key">Lapsed</span>
            <span className="funding-health-pill-value">{lapsedDonors}</span>
          </span>
          <span className="funding-health-divider">·</span>
          <span className="funding-health-pill">
            <span className="funding-health-pill-key">Campaigns Active</span>
            <span className="funding-health-pill-value">{activeCampaigns.length}</span>
          </span>
          <span className="funding-health-divider">·</span>
          <span className={`funding-health-pill${receiptsPending > 0 ? ' funding-health-pill--warn' : ''}`}>
            <span className="funding-health-pill-key">Receipts Pending</span>
            <span className="funding-health-pill-value">{receiptsPending}</span>
          </span>
          <span className="funding-health-divider">·</span>
          <span className={`funding-health-pill${expiringDocs.length > 0 ? ' funding-health-pill--danger' : ''}`}>
            <span className="funding-health-pill-key">Budget at Risk</span>
            <span className="funding-health-pill-value">{expiringDocs.length || 1}</span>
          </span>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────── */}
      <div className="funding-tabs" role="tablist">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`funding-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Overview Tab ──────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <motion.div
          className="funding-overview"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {/* KPI row */}
          <div className="funding-kpi-row">
            <div className="funding-kpi-card" onClick={() => navigate('/crm')}>
              <div className="funding-kpi-icon" style={{ background: '#ccfbf1', color: '#0F766E' }}>
                <Users size={18} />
              </div>
              <div>
                <div className="funding-kpi-value">{donors.length || '—'}</div>
                <div className="funding-kpi-label">Total Donors</div>
              </div>
            </div>
            <div className="funding-kpi-card" onClick={() => navigate('/fundraising')}>
              <div className="funding-kpi-icon" style={{ background: '#e0f2fe', color: '#0891b2' }}>
                <TrendingUp size={18} />
              </div>
              <div>
                <div className="funding-kpi-value">
                  {thisMonthTotal > 0
                    ? (thisMonthTotal >= 100000 ? `₹${(thisMonthTotal/100000).toFixed(1)}L` : `₹${(thisMonthTotal/1000).toFixed(0)}K`)
                    : '—'}
                </div>
                <div className="funding-kpi-label">This Month</div>
              </div>
            </div>
            <div className="funding-kpi-card" onClick={() => navigate('/fundraising')}>
              <div className="funding-kpi-icon" style={{ background: '#fef3c7', color: '#d97706' }}>
                <HeartHandshake size={18} />
              </div>
              <div>
                <div className="funding-kpi-value">{activeCampaigns.length || '—'}</div>
                <div className="funding-kpi-label">Active Campaigns</div>
              </div>
            </div>
            <div className="funding-kpi-card" onClick={() => navigate('/compliance')}>
              <div className={`funding-kpi-icon ${expiringDocs.length > 0 ? 'funding-kpi-icon--warn' : ''}`}
                style={{ background: expiringDocs.length > 0 ? '#fef3c7' : '#d1fae5', color: expiringDocs.length > 0 ? '#d97706' : '#059669' }}>
                <ShieldCheck size={18} />
              </div>
              <div>
                <div className="funding-kpi-value">
                  {expiringDocs.length > 0
                    ? <span style={{ color: '#d97706' }}>{expiringDocs.length} ⚠</span>
                    : <span style={{ color: '#059669' }}>✓</span>
                  }
                </div>
                <div className="funding-kpi-label">Compliance</div>
              </div>
            </div>
          </div>

          {/* Module cards */}
          <div className="funding-modules-grid">
            {MODULE_CARDS.map(card => {
              const Icon = card.icon;
              const stats = (card.stats as any)(donors, transactions, campaigns, csrCards, complianceDocs);
              return (
                <div
                  key={card.id}
                  className="funding-module-card"
                  onClick={() => navigate(card.path)}
                  style={{ '--module-color': card.color } as React.CSSProperties}
                >
                  <div className="funding-module-header">
                    <div className="funding-module-icon" style={{ background: `${card.color}18`, color: card.color }}>
                      <Icon size={20} />
                    </div>
                    <h3 className="funding-module-title">{card.title}</h3>
                    <ArrowRight size={16} className="funding-module-arrow" />
                  </div>
                  <p className="funding-module-desc">{card.desc}</p>
                  <div className="funding-module-stats">
                    {stats.map((s: any, i: number) => (
                      <div key={i} className="funding-module-stat">
                        <span className="funding-module-stat-value">{s.value}</span>
                        <span className="funding-module-stat-label">{s.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Alert if compliance issues */}
          {expiringDocs.length > 0 && (
            <div className="funding-alert">
              <AlertCircle size={16} />
              <span>{expiringDocs.length} compliance document{expiringDocs.length > 1 ? 's' : ''} need attention</span>
              <button onClick={() => navigate('/compliance')}>View <ArrowRight size={12} /></button>
            </div>
          )}

          {/* Compliance → grant cascade banner: any grant whose linked
              compliance doc is expiring/expired is flagged before the user
              even opens it. */}
          <div style={{ marginTop: '1rem' }}>
            <AtRiskGrantsBanner />
          </div>

          {/* Active grants quick-links */}
          {csrCards.length > 0 && (() => {
            const featured = [...csrCards]
              .sort((a: any, b: any) => {
                const order: Record<string, number> = { live: 0, mou: 1, diligence: 2, pitch: 3, prospecting: 4, closed: 5 };
                return (order[a.col] ?? 9) - (order[b.col] ?? 9);
              });
            const stageMap: Record<string, { label: string; color: string }> = {
              prospecting: { label: 'Pipeline', color: '#94a3b8' },
              pitch:       { label: 'Applied',  color: '#0891b2' },
              diligence:   { label: 'Applied',  color: '#0891b2' },
              mou:         { label: 'Awarded',  color: '#7c3aed' },
              live:        { label: 'Active',   color: '#0F766E' },
              closed:      { label: 'Closed',   color: '#64748b' },
            };
            return (
              <div style={{ marginTop: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: 'var(--color-text-primary)' }}>
                    Grants
                  </h3>
                  <button
                    onClick={() => navigate('/csr')}
                    style={{ background: 'none', border: 'none', color: '#0F766E', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    Open CSR pipeline <ArrowRight size={12} />
                  </button>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                    gap: '0.65rem',
                  }}
                >
                  {featured.map((g: any) => {
                    const st = stageMap[g.col] || { label: g.col, color: '#64748b' };
                    return (
                      <button
                        key={String(g.id)}
                        onClick={() => navigate(`/grants/${encodeURIComponent(String(g.id))}`)}
                        style={{
                          textAlign: 'left',
                          background: '#fff',
                          border: '1px solid var(--color-border-light)',
                          borderRadius: 'var(--radius-md)',
                          padding: '0.75rem 0.85rem',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.35rem',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget.style as any).borderColor = '#0F766E'; (e.currentTarget.style as any).transform = 'translateY(-1px)'; }}
                        onMouseLeave={(e) => { (e.currentTarget.style as any).borderColor = ''; (e.currentTarget.style as any).transform = ''; }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: st.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{st.label}</span>
                          <ArrowRight size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                        </div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {g.company}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {g.project}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--color-text-tertiary)', fontWeight: 500 }}>
                          ₹{(Number(g.amount) / 100000).toFixed(1)}L
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </motion.div>
      )}

      {/* ── Module-specific tabs redirect to full pages ──────────── */}
      {activeTab !== 'overview' && (
        <motion.div
          className="funding-module-redirect"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {(() => {
            const card = MODULE_CARDS.find(c => c.id === activeTab);
            if (!card) return null;
            const Icon = card.icon;
            return (
              <div className="funding-redirect-card" onClick={() => navigate(card.path)}>
                <div className="funding-redirect-icon" style={{ background: `${card.color}18`, color: card.color }}>
                  <Icon size={32} />
                </div>
                <h2 className="funding-redirect-title">{card.title}</h2>
                <p className="funding-redirect-desc">{card.desc}</p>
                <button className="funding-btn-primary" style={{ background: card.color }}>
                  Open {card.title} <ArrowRight size={15} />
                </button>
              </div>
            );
          })()}
        </motion.div>
      )}
    </div>
  );
};

export default Funding;
