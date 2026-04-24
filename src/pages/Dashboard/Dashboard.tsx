import React, { useState, useEffect } from 'react';
import { IndianRupee, Users, TrendingUp, AlertCircle, ArrowUpRight, ArrowDownRight, Bot, ShieldCheck, MessageCircle, X, Bell, Loader2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import toast from 'react-hot-toast';
import { apiFetch } from '../../api/client';
import './Dashboard.css';

const monthLabels = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May (Est)', 'Jun (Est)', 'Jul (Est)'];
const monthlyData   = [320000, 480000, 410000, 620000, 530000, 750000, 0, 0, 0];
const predictiveData = [0, 0, 0, 0, 0, 0, 850000, 920000, 1150000]; // ML Forecast
const maxMonthly    = Math.max(...monthlyData, ...predictiveData);

const agentActivity = [
  { id: 1, icon: '💰', text: 'Donor Nurture Agent sent 80G receipt to Anjali Desai', time: '2m ago', color: 'var(--color-success)' },
  { id: 2, icon: '🤖', text: 'CSR Agent drafted outreach to Tata Trusts — awaiting approval', time: '18m ago', color: '#8b5cf6' },
  { id: 3, icon: '⚠️', text: 'FCRA Admin overhead at 87% — Finance Agent flagged for CFO', time: '1h ago', color: 'var(--color-warning)' },
  { id: 4, icon: '📋', text: 'Board Briefing Agent delivered morning brief to 4 trustees', time: '6h ago', color: 'var(--color-primary)' },
];

const quickActions = [
  { label: 'Log Donation', icon: '💸', path: '/fundraising' },
  { label: 'Enroll Beneficiary', icon: '👤', path: '/programs' },
  { label: 'Add CSR Lead', icon: '🏢', path: '/csr' },
  { label: 'Upload Compliance Doc', icon: '📄', path: '/compliance' },
];

const Dashboard: React.FC = () => {
  const { donors, transactions, campaigns, complianceDocs } = useStore();
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [forecastData, setForecastData] = useState<{date: string, amount: number, is_estimate: boolean}[]>([]);
  const [anomaly, setAnomaly] = useState<{has_anomaly: boolean, message: string} | null>(null);
  const [reportDrafting, setReportDrafting] = useState(false);
  const [morningBrief, setMorningBrief] = useState<any[]>([]);
  const [isBriefLoading, setIsBriefLoading] = useState(true);
  const [inboxItems, setInboxItems] = useState<any[]>([]);
  const [inboxLoading, setInboxLoading] = useState(true);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const [forecastRes, anomalyRes, briefRes] = await Promise.all([
          apiFetch('/analytics/revenue-forecast'),
          apiFetch('/analytics/anomalies'),
          apiFetch('/morning-brief')
        ]);

        if (forecastRes.ok) {
          const data = await forecastRes.json();
          const combined = [
            ...data.actuals.map((d: any) => ({ ...d, is_estimate: false })),
            ...data.forecast.map((d: any) => ({ ...d, is_estimate: true }))
          ].slice(-9);
          setForecastData(combined);
        }

        if (anomalyRes.ok) {
          const data = await anomalyRes.json();
          if (data.has_anomaly) {
            setAnomaly({ 
              has_anomaly: true, 
              message: "Anomaly Detected: Donor Acquisition Velocity Dropped by 30%. Recommend triggering re-engagement agent."
            });
          }
        }

        if (briefRes.ok) {
          const data = await briefRes.json();
          setMorningBrief(data);
        }
      } catch (err) {
        console.error("Failed to fetch analytics:", err);
      } finally {
        setLoading(false);
        setIsBriefLoading(false);
      }
    };

    fetchAnalytics();
  }, []);

  useEffect(() => {
    const fetchInbox = async () => {
      setInboxLoading(true);
      try {
        const res = await apiFetch('/inbox');
        if (res.ok) {
          const data = await res.json();
          setInboxItems(Array.isArray(data.items) ? data.items : []);
        }
      } catch {
        // ignore
      } finally {
        setInboxLoading(false);
      }
    };
    fetchInbox();
  }, []);

  const refreshInbox = async () => {
    setInboxLoading(true);
    try {
      const res = await apiFetch('/inbox');
      if (res.ok) {
        const data = await res.json();
        setInboxItems(Array.isArray(data.items) ? data.items : []);
      }
    } finally {
      setInboxLoading(false);
    }
  };

  const handleDraftReport = async () => {
    setReportDrafting(true);
    try {
      const res = await apiFetch('/gen-ai/draft-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ngo_name: "India NGO Trust",
          impact_data: { "education": "1200 girls trained", "health": "45 camps conducted", "revenue": "₹4.2Cr raised" }
        })
      });
      if (res.ok) {
        const data = await res.json();
        toast.success("AI Annual Report Draft Generated!", { duration: 5000 });
        console.log("Draft:", data.draft);
        // In a real app, open a modal with the draft
      } else {
        toast.error("Failed to generate draft.");
      }
    } catch (err) {
      toast.error("Failed to generate draft.");
    } finally {
      setReportDrafting(false);
    }
  };

  const totalRaised = transactions.reduce((s, t) => s + t.amount, 0) + 4200000;
  const expiringSoon = complianceDocs.filter(d => d.status === 'Expiring Soon').length;
  const recentTx = transactions.slice(0, 5);

  const handleReport = () => {
    toast.success('Generating Executive Board Report PDF...', { icon: '📊' });
  };

  return (
    <div className="dashboard-container">
      <div className="page-header" style={{ marginBottom: '2rem' }}>
        <div>
          <h1 className="page-title text-gradient" style={{ fontSize: '1.75rem' }}>Good Morning, Anjali</h1>
          <p className="page-subtitle" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <span className="agent-pulse" /> Your agents are active
            </span> 
            • Today is Thursday, April 23
          </p>
        </div>
        <div className="flex gap-4">
          <button className="btn btn-secondary" onClick={handleDraftReport} disabled={reportDrafting}>
            {reportDrafting ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
            {reportDrafting ? "Drafting..." : "Draft Annual Report"}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
        {/* Morning Brief Section */}
        <section>
          <div className="flex justify-between items-center mb-4">
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Today's Priorities</h2>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>Auto-generated at 6:30 AM</span>
          </div>
          
          {isBriefLoading ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
              <Loader2 className="animate-spin mx-auto mb-2" />
              <p className="text-tertiary">Synthesizing priorities...</p>
            </div>
          ) : (
            morningBrief.map(item => (
              <div key={item.id} className="card" style={{ 
                padding: '1.25rem', 
                marginBottom: '1rem', 
                borderLeft: `4px solid ${item.priority === 'High' ? 'var(--color-danger)' : 'var(--color-warning)'}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: 'var(--shadow-sm)'
              }}>
                <div style={{ flex: 1 }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`badge ${item.priority === 'High' ? 'badge-danger' : 'badge-warning'}`} style={{ fontSize: '0.65rem' }}>{item.priority}</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-tertiary)' }}>{item.category.toUpperCase()}</span>
                  </div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem' }}>{item.title}</h3>
                  <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>{item.summary}</p>
                </div>
                <button className="btn btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem' }}>
                  Take Action <ArrowUpRight size={14} />
                </button>
              </div>
            ))
          )}
        </section>

        {/* Unified Inbox */}
        <aside>
          <div className="card" style={{ height: '100%' }}>
            <div className="card-header">
              <h3 className="card-title">Your Inbox</h3>
            </div>
            <div className="card-body">
              {inboxLoading ? (
                <div className="flex flex-col items-center gap-2 text-tertiary" style={{ padding: '1rem' }}>
                  <Loader2 size={24} className="animate-spin" />
                  <span style={{ fontSize: '0.85rem' }}>Loading…</span>
                </div>
              ) : inboxItems.length === 0 ? (
                <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.85rem' }}>
                  No pending items. You’re all caught up.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {inboxItems.slice(0, 6).map((it: any, idx: number) => (
                    <div key={idx} style={{ padding: '0.75rem', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', background: 'white' }}>
                      <div className="flex justify-between items-center" style={{ marginBottom: '0.25rem' }}>
                        <span className={`badge ${it.priority === 'High' ? 'badge-danger' : 'badge-warning'}`} style={{ fontSize: '0.65rem' }}>{it.priority}</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>{(it.kind || '').toString().toUpperCase()}</span>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.25rem' }}>{it.title}</div>
                      <div className="flex gap-2">
                        <button
                          className="btn btn-secondary"
                          style={{ flex: 1, padding: '0.35rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={() => {
                            if (it.primary_action?.route) window.location.hash = it.primary_action.route;
                          }}
                        >
                          {it.primary_action?.label || 'Open'}
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={async () => {
                            try {
                              const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                              const res = await apiFetch('/inbox/snooze', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ kind: it.kind, id: it.ref?.id, until }),
                              });
                              if (!res.ok) throw new Error('snooze');
                              toast.success('Snoozed for 24h.');
                              refreshInbox();
                            } catch {
                              toast.error('Failed to snooze.');
                            }
                          }}
                        >
                          Snooze
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', color: 'var(--color-success)', borderColor: 'var(--color-success)' }}
                          onClick={async () => {
                            try {
                              const res = await apiFetch('/inbox/resolve', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ kind: it.kind, id: it.ref?.id }),
                              });
                              if (!res.ok) throw new Error('resolve');
                              toast.success('Done.');
                              refreshInbox();
                            } catch {
                              toast.error('Failed to mark done.');
                            }
                          }}
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Agent Activity Sidebar */}
        <aside>
          <div className="card" style={{ height: '100%' }}>
            <div className="card-header">
              <h3 className="card-title">Agents in Background</h3>
            </div>
            <div className="card-body">
              {agentActivity.map(item => (
                <div key={item.id} style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div style={{ 
                    width: '32px', 
                    height: '32px', 
                    borderRadius: '50%', 
                    background: 'var(--color-bg-main)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    fontSize: '1rem'
                  }}>
                    {item.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-primary)', lineHeight: 1.4 }}>{item.text}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: '0.15rem' }}>{item.time}</div>
                  </div>
                </div>
              ))}
              <div style={{ marginTop: '1.5rem', padding: '0.75rem', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-md)', fontSize: '0.75rem' }}>
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold">Nurture Agent</span>
                  <span className="text-success">Active</span>
                </div>
                <div className="progress-inline" style={{ height: '4px' }}>
                  <div className="progress-track" style={{ height: '4px' }}>
                    <div className="progress-val" style={{ width: '85%', height: '4px' }}></div>
                  </div>
                </div>
                <div style={{ marginTop: '0.5rem', color: 'var(--color-text-tertiary)' }}>85% task completion for today</div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Metrics & Anomaly section below */}
      <div style={{ marginBottom: '2rem' }}>
        <div className="card metric-card">
          <div className="metric-header">
            <span>Total Raised (YTD)</span>
            <div className="metric-icon icon-blue"><IndianRupee size={18} /></div>
          </div>
          <div className="metric-value">₹{(totalRaised / 100000).toFixed(1)}L</div>
          <div className="metric-trend trend-up"><ArrowUpRight size={14} /><span>+12% from last month</span></div>
        </div>

        <div className="card metric-card">
          <div className="metric-header">
            <span>Active Donors</span>
            <div className="metric-icon icon-purple"><Users size={18} /></div>
          </div>
          <div className="metric-value">{(donors.length + 1243).toLocaleString()}</div>
          <div className="metric-trend trend-up"><ArrowUpRight size={14} /><span>+{donors.length} added this session</span></div>
        </div>

        <div className="card metric-card">
          <div className="metric-header">
            <span>Active Campaigns</span>
            <div className="metric-icon icon-green"><TrendingUp size={18} /></div>
          </div>
          <div className="metric-value">{campaigns.filter(c => c.status === 'active').length}</div>
          <div className="metric-trend trend-up"><ArrowUpRight size={14} /><span>{campaigns.length} total campaigns</span></div>
        </div>

        <div className="card metric-card">
          <div className="metric-header">
            <span>Compliance Alerts</span>
            <div className="metric-icon icon-orange"><AlertCircle size={18} /></div>
          </div>
          <div className="metric-value">{expiringSoon}</div>
          <div className={`metric-trend ${expiringSoon > 0 ? 'trend-down' : 'trend-up'}`}>
            {expiringSoon > 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
            <span>{expiringSoon > 0 ? '80G Renewal due in 45 days' : 'All documents valid'}</span>
          </div>
        </div>
      </div>

      {/* WhatsApp Bot Banner */}
      <div className="whatsapp-sync-banner">
        <div className="whatsapp-info">
          <div className="whatsapp-icon">
            <MessageCircle size={24} color="#16a34a" />
          </div>
          <div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.25rem', color: '#166534' }}>
              WhatsApp Bot Active (Zero Data Entry)
            </h3>
            <p style={{ fontSize: '0.875rem', color: '#14532d', opacity: 0.9 }}>
              Field staff just WhatsApp: <i>"Received ₹5000 from Ravi for Health Camp"</i> — AI logs it automatically.
            </p>
          </div>
        </div>
        <button className="btn btn-secondary" style={{ background: 'white', color: '#166534', border: 'none', fontWeight: 600 }}
          onClick={() => setShowWhatsApp(true)}>
          View WhatsApp Logs
        </button>
      </div>

      {/* Quick Actions */}
      <div className="quick-actions-row">
        {quickActions.map(qa => (
          <button key={qa.label} className="quick-action-btn"
            onClick={() => { window.location.hash = qa.path; toast(`Navigating to ${qa.label}...`); }}>
            <span className="qa-icon">{qa.icon}</span>
            <span className="qa-label">{qa.label}</span>
          </button>
        ))}
      </div>

      <div className="charts-row">
        {/* Bar Chart — Donation Trends */}
        <div className="card chart-card" style={{ gridColumn: 'span 2' }}>
          <div className="card-header flex justify-between items-center">
            <div>
              <h3 className="card-title">Predictive Revenue Forecast (Next 90 Days)</h3>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem' }}>Based on Linear Regression & Seasonality Models</div>
            </div>
            <span className="badge badge-primary">AI Forecast</span>
          </div>
          <div className="card-body" style={{ minHeight: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {loading ? (
              <div className="flex flex-col items-center gap-2 text-tertiary">
                <Loader2 size={32} className="animate-spin" />
                <span style={{ fontSize: '0.875rem' }}>Running ML regression models...</span>
              </div>
            ) : (
              <div className="bar-chart">
                {forecastData.map((d, i) => {
                  const isPrediction = d.is_estimate;
                  const displayVal = d.amount;
                  const label = new Date(d.date).toLocaleDateString('en-IN', { month: 'short' });
                  
                  return (
                    <div key={i} className="bar-col">
                      <div className="bar-label-top" style={{ color: isPrediction ? 'var(--color-primary)' : 'inherit', fontWeight: isPrediction ? 600 : 400 }}>
                        ₹{(displayVal / 100000).toFixed(1)}L
                      </div>
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{
                            height: `${(displayVal / maxMonthly) * 100}%`,
                            background: isPrediction
                              ? 'repeating-linear-gradient(45deg, var(--color-primary-light), var(--color-primary-light) 4px, var(--color-primary) 4px, var(--color-primary) 8px)'
                              : (i === forecastData.length - 1 && !isPrediction ? 'linear-gradient(to top, var(--color-primary), var(--color-secondary))' : 'linear-gradient(to top, #c7d2fe, #a5b4fc)'),
                            opacity: isPrediction ? 0.7 : 1
                          }}
                        />
                      </div>
                      <div className="bar-label" style={{ fontStyle: isPrediction ? 'italic' : 'normal', color: isPrediction ? 'var(--color-primary)' : 'inherit' }}>{label}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="card chart-card">
          <div className="card-header flex justify-between items-center">
            <h3 className="card-title">Recent Transactions</h3>
            <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
              onClick={() => toast('Navigate to Fundraising to see full transaction history.')}>
              View All
            </button>
          </div>
          <div className="card-body">
            <div className="flex flex-col gap-4">
              {recentTx.length > 0 ? recentTx.map(tx => (
                <div key={tx.id} className="flex justify-between items-center pb-3" style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                  <div className="flex items-center gap-3">
                    <div className="avatar" style={{ width: 32, height: 32 }}>{tx.donorName.charAt(0)}</div>
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{tx.donorName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>{tx.method} • {tx.date}</div>
                    </div>
                  </div>
                  <div style={{ fontWeight: 600, color: 'var(--color-success)' }}>+₹{tx.amount.toLocaleString()}</div>
                </div>
              )) : (
                <div style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', padding: '2rem 0' }}>No recent transactions</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Agent Activity Feed + Compliance Summary */}
      <div className="charts-row" style={{ marginTop: 0 }}>
        {/* Agent Activity */}
        <div className="card">
          <div className="card-header flex justify-between items-center">
            <h3 className="card-title flex items-center gap-2"><Bot size={18} color="#8b5cf6" /> Agent Activity Feed</h3>
            <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
              onClick={() => toast('Full agent log available in GoodJobs Copilot.')}>
              View All
            </button>
          </div>
          <div className="card-body flex flex-col gap-4">
            {agentActivity.map(act => (
              <div key={act.id} className="flex items-start gap-3" style={{ paddingBottom: '0.75rem', borderBottom: '1px solid var(--color-border-light)' }}>
                <div style={{ fontSize: '1.25rem', minWidth: 28, marginTop: '0.1rem' }}>{act.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.875rem', color: 'var(--color-text-primary)' }}>{act.text}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem' }}>{act.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Compliance Status */}
        <div className="card">
          <div className="card-header flex justify-between items-center">
            <h3 className="card-title flex items-center gap-2"><ShieldCheck size={18} color="var(--color-primary)" /> Compliance Status</h3>
            <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
              onClick={() => toast('Navigate to Compliance HQ for full details.')}>
              View HQ
            </button>
          </div>
          <div className="card-body flex flex-col gap-4">
            {complianceDocs.slice(0, 4).map(doc => (
              <div key={doc.id} className="flex justify-between items-center" style={{ paddingBottom: '0.75rem', borderBottom: '1px solid var(--color-border-light)' }}>
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{doc.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>Expires: {doc.expiry}</div>
                </div>
                <span className={`badge ${doc.status === 'Valid' ? 'badge-success' : ''}`}
                  style={doc.status === 'Expiring Soon' ? { background: '#fef3c7', color: '#92400e' } : {}}>
                  {doc.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* WhatsApp Logs Modal */}
      {showWhatsApp && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ width: '500px', maxHeight: '70vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="card-header flex justify-between items-center">
              <h3 className="card-title flex items-center gap-2"><MessageCircle size={18} color="#16a34a" /> WhatsApp Bot Logs</h3>
              <button className="action-btn" onClick={() => setShowWhatsApp(false)}><X size={20} /></button>
            </div>
            <div style={{ overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {[
                { from: 'Priya M. (Field Staff)', msg: 'Received ₹5000 from Ravi for Health Camp Nashik', time: '10:14 AM', parsed: '✅ Logged as TRX-1098 under Healthcare Camp Fund' },
                { from: 'Ramesh K. (Field Staff)', msg: 'Enrolled Sunita Devi in Nashik Livelihood program family 3', time: '9:52 AM', parsed: '✅ Added BEN-1049 to Women Livelihood Center' },
                { from: 'Dr. Sharma (Field Staff)', msg: 'Health camp done. 45 patients checked. Pune Main Hall.', time: '9:10 AM', parsed: '✅ Field visit logged for Healthcare Camp, Pune' },
              ].map((log, i) => (
                <div key={i} style={{ background: 'var(--color-bg-main)', borderRadius: 'var(--radius-md)', padding: '1rem', border: '1px solid var(--color-border-light)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '0.25rem' }}>{log.from} • {log.time}</div>
                  <div style={{ background: '#dcfce7', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)', fontStyle: 'italic', marginBottom: '0.5rem', fontSize: '0.875rem', color: '#166534' }}>"{log.msg}"</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-success)', fontWeight: 500 }}>{log.parsed}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
