import React, { useState, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { IndianRupee, Users, TrendingUp, AlertCircle, ArrowUpRight, ArrowDownRight, Bot, ShieldCheck, MessageCircle, X, Bell, Loader2, Download } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { apiFetch } from '../../api/client';
import { tasksInboxHref, notificationTasksHref } from '../../utils/inboxLinks';
import { listItemEnterDelay } from '../../motion/variants';
import { ModalOverlay } from '../../components/ui/ModalOverlay';
import './Dashboard.css';

const BRIEF_CACHE_KEY = 'goodjobs.morning_brief.v1';

const quickActions = [
  { label: 'Log Donation', icon: '💸', path: '/fundraising' },
  { label: 'Enroll Beneficiary', icon: '👤', path: '/programs' },
  { label: 'Add CSR Lead', icon: '🏢', path: '/csr' },
  { label: 'Upload Compliance Doc', icon: '📄', path: '/compliance' },
];

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const { user } = useAuth();
  const canRunAnnualDraft = user?.role === 'ed';
  const { donors, transactions, campaigns, complianceDocs } = useStore();
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [forecastData, setForecastData] = useState<{date: string, amount: number, is_estimate: boolean}[]>([]);
  const [anomaly, setAnomaly] = useState<{has_anomaly: boolean, message: string} | null>(null);
  const [reportDrafting, setReportDrafting] = useState(false);
  const [morningBrief, setMorningBrief] = useState<any[]>([]);
  const [briefHandled, setBriefHandled] = useState<any[]>([]);
  const [isBriefLoading, setIsBriefLoading] = useState(true);
  const [inboxItems, setInboxItems] = useState<any[]>([]);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const activityLogScrollRef = useRef<HTMLDivElement>(null);
  const activityLogVirtualizer = useVirtualizer({
    count: activityLogs.length,
    getScrollElement: () => activityLogScrollRef.current,
    estimateSize: () => 76,
    overscan: 12,
  });

  const activityFeed: { id: string; icon: string; text: string; time: string; color: string; tasksPath: string }[] =
    (notifications || []).slice(0, 6).map((n: any, idx: number) => ({
      id: String(n?.id ?? idx),
      icon: n?.type === 'urgent' ? '⚠️' : n?.type === 'agent' ? '🤖' : '📌',
      text: String(n?.message || n?.title || 'Update'),
      time: String(n?.time || ''),
      color: n?.type === 'urgent' ? 'var(--color-warning)' : n?.type === 'agent' ? 'var(--color-secondary)' : 'var(--color-text-tertiary)',
      tasksPath: notificationTasksHref(n),
    }));
  useEffect(() => {
    const fetchAnalytics = async () => {
      const uid = user?.id || '';
      const role = user?.role || '';
      try {
        try {
          const raw = localStorage.getItem(BRIEF_CACHE_KEY);
          if (raw) {
            const c = JSON.parse(raw);
            if (c.uid === uid && c.role === role && Date.now() - (c.at || 0) < 30 * 60 * 1000) {
              setMorningBrief(Array.isArray(c.priorities) ? c.priorities : []);
              setBriefHandled(Array.isArray(c.handled) ? c.handled : []);
              setIsBriefLoading(false);
            }
          }
        } catch {
          /* ignore cache */
        }

        const [forecastRes, anomalyRes, briefRes] = await Promise.all([
          apiFetch('/analytics/revenue-forecast'),
          apiFetch('/analytics/anomalies'),
          apiFetch('/morning-brief'),
        ]);

        if (forecastRes.ok) {
          const data = await forecastRes.json();
          const combined = [
            ...data.actuals.map((d: any) => ({ ...d, is_estimate: false })),
            ...data.forecast.map((d: any) => ({ ...d, is_estimate: true })),
          ].slice(-9);
          setForecastData(combined);
        }

        if (anomalyRes.ok) {
          const data = await anomalyRes.json();
          if (data.has_anomaly) {
            setAnomaly({
              has_anomaly: true,
              message:
                'Anomaly Detected: Donor Acquisition Velocity Dropped by 30%. Recommend triggering re-engagement agent.',
            });
          }
        }

        if (briefRes.ok) {
          const data = await briefRes.json();
          const priorities = Array.isArray(data) ? data : data.priorities || [];
          const handled = Array.isArray(data?.handled_by_agents) ? data.handled_by_agents : [];
          setMorningBrief(priorities);
          setBriefHandled(handled);
          try {
            localStorage.setItem(
              BRIEF_CACHE_KEY,
              JSON.stringify({ uid, role, at: Date.now(), priorities, handled })
            );
          } catch {
            /* ignore */
          }
        }
      } catch (err) {
        console.error('Failed to fetch analytics:', err);
      } finally {
        setLoading(false);
        setIsBriefLoading(false);
      }
    };

    fetchAnalytics();
  }, [user?.id, user?.role]);

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

  useEffect(() => {
    const run = async () => {
      try {
        const res = await apiFetch('/notifications');
        if (!res.ok) return;
        const data = await res.json();
        setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      } catch {
        // ignore
      }
    };
    run();
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
          ngo_name: "GoodJobs NGO",
          impact_data: {
            donors: donors.length,
            transactions: transactions.length,
            revenue_inr: transactions.reduce((s, t) => s + (Number(t.amount) || 0), 0),
            campaigns: campaigns.length,
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        toast.success("AI Annual Report Draft Generated!", { duration: 5000 });
        // For now, surface in console; UI modal can be added later.
        console.log("Draft:", data.draft);
      } else {
        toast.error("Failed to generate draft.");
      }
    } catch (err) {
      toast.error("Failed to generate draft.");
    } finally {
      setReportDrafting(false);
    }
  };

  const totalRaised = transactions.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const expiringSoon = inboxItems.filter(i => i.kind === 'compliance_doc').length || complianceDocs.filter(d => d.status === 'Expiring Soon').length;
  const recentTx = transactions.slice(0, 5);

  const handleReport = async () => {
    try {
      const res = await apiFetch('/compliance/health-report.pdf');
      if (!res.ok) throw new Error('report');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'board_report.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to generate report.');
    }
  };

  const chartSeries = forecastData.length ? forecastData : [];
  const maxMonthly = Math.max(1, ...chartSeries.map(d => Number(d.amount) || 0));

  const openActivityLog = async () => {
    setShowWhatsApp(true);
    setActivityLoading(true);
    try {
      const res = await apiFetch('/volunteers/activity');
      if (!res.ok) throw new Error('activity');
      const data = await res.json();
      setActivityLogs(Array.isArray(data.events) ? data.events : []);
    } catch {
      setActivityLogs([]);
    } finally {
      setActivityLoading(false);
    }
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
            • Today is {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex gap-4">
          {canRunAnnualDraft && (
          <button className="btn btn-secondary" onClick={handleDraftReport} disabled={reportDrafting}>
            {reportDrafting ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
            {reportDrafting ? "Drafting..." : "Draft Annual Report"}
          </button>
          )}
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
            <>
              {morningBrief.map((item: any, index: number) => (
                <motion.div
                  key={item.id}
                  className="card"
                  initial={reducedMotion ? false : { opacity: 0, y: 12 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    transition: reducedMotion
                      ? { duration: 0 }
                      : { duration: 0.3, ease: [0, 0, 0.2, 1], delay: listItemEnterDelay(index) },
                  }}
                  style={{
                    padding: '1.25rem',
                    marginBottom: '1rem',
                    borderLeft: `4px solid ${item.priority === 'High' ? 'var(--color-danger)' : 'var(--color-warning)'}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                    flexWrap: 'wrap',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`badge ${item.priority === 'High' ? 'badge-danger' : 'badge-warning'}`}
                        style={{ fontSize: '0.65rem' }}
                      >
                        {item.priority}
                      </span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-tertiary)' }}>
                        {(item.category || '').toString().toUpperCase()}
                      </span>
                    </div>
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem' }}>{item.title}</h3>
                    <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>{item.summary}</p>
                  </div>
                  <div className="flex gap-2" style={{ flexShrink: 0, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-primary"
                      style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem' }}
                      type="button"
                      onClick={async () => {
                        try {
                          if (item.kind === 'csr_report_due') {
                            const inl = item.inline || {};
                            const meta = item.meta || {};
                            const company = inl.company ?? meta.company;
                            const project = inl.project ?? meta.project;
                            if (company) {
                              const q = new URLSearchParams();
                              q.set('company', String(company));
                              if (project) q.set('project', String(project));
                              const res = await apiFetch(`/finance/uc.pdf?${q}`);
                              if (res.ok) {
                                const blob = await res.blob();
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = 'utilization_certificate_draft.pdf';
                                a.click();
                                URL.revokeObjectURL(url);
                                toast.success('UC draft downloaded.');
                              }
                            }
                          }
                          if (item.kind === 'month_end_close') {
                            navigate('/finance');
                            return;
                          }
                          const route = item?.primary_action?.route;
                          if (route) {
                            const path = route.startsWith('/') ? route : `/${route}`;
                            if (path === '/tasks') navigate(item.tasks_deep_link_path || tasksInboxHref(item.kind, item.ref?.id));
                            else navigate(path);
                          } else toast('No action linked for this item yet.');
                        } catch {
                          toast.error('Action failed.');
                        }
                      }}
                    >
                      {item?.primary_action?.label || 'Take action'} <ArrowUpRight size={14} />
                    </button>
                    {item?.secondary_action?.route && (
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem' }}
                        type="button"
                        onClick={() => {
                          const route = item.secondary_action.route;
                          const path = route.startsWith('/') ? route : `/${route}`;
                          if (path === '/tasks') navigate(item.tasks_deep_link_path || tasksInboxHref(item.kind, item.ref?.id));
                          else navigate(path);
                        }}
                      >
                        {item.secondary_action.label || 'Module'}
                      </button>
                    )}
                    {item?.tertiary_action?.route && (
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem' }}
                        type="button"
                        onClick={() => {
                          const route = item.tertiary_action.route;
                          const path = route.startsWith('/') ? route : `/${route}`;
                          if (path === '/tasks') navigate(item.tasks_deep_link_path || tasksInboxHref(item.kind, item.ref?.id));
                          else navigate(path);
                        }}
                      >
                        {item.tertiary_action.label || 'Inbox'}
                      </button>
                    )}
                  </div>
                </motion.div>
              ))}
              {briefHandled.length > 0 && (
                <div className="card" style={{ padding: '1rem', marginTop: '1rem', background: 'var(--color-bg-main)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-tertiary)', marginBottom: '0.5rem' }}>
                    Handled by agents (recent)
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                    {briefHandled.slice(0, 6).map((h: any, i: number) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        {(h.intent_type || 'intent').toString()}: {String(h.directive || '').slice(0, 80)}
                        {h.executed_at ? ` — ${String(h.executed_at).slice(0, 16)}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
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
                <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                  <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>🎉</div>
                  <div style={{ fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>All clear — agents are handling the rest</div>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {inboxItems.slice(0, 6).map((it: any, idx: number) => (
                    <div key={`${it.kind}-${it.ref?.id ?? idx}`} style={{ padding: '0.75rem', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-card)' }}>
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
                            const r = it.primary_action?.route;
                            if (!r) return;
                            const p = r.startsWith('/') ? r : `/${r}`;
                            if (p === '/tasks') navigate(tasksInboxHref(it.kind, it.ref?.id));
                            else navigate(p);
                          }}
                        >
                          {it.primary_action?.label || 'Open'}
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={async () => {
                            const kind = it.kind;
                            const id = it.ref?.id;
                            setInboxItems(prev => prev.filter(x => !(x.kind === kind && x.ref?.id === id)));
                            try {
                              const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                              const res = await apiFetch('/inbox/snooze', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ kind: it.kind, id: it.ref?.id, until }),
                              });
                              if (!res.ok) throw new Error('snooze');
                              toast.success('Snoozed for 24h.');
                            } catch {
                              toast.error('Failed to snooze.');
                              await refreshInbox();
                            }
                          }}
                        >
                          Snooze
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', color: 'var(--color-success)', borderColor: 'var(--color-success)' }}
                          onClick={async () => {
                            const kind = it.kind;
                            const id = it.ref?.id;
                            setInboxItems(prev => prev.filter(x => !(x.kind === kind && x.ref?.id === id)));
                            try {
                              const res = await apiFetch('/inbox/resolve', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ kind: it.kind, id: it.ref?.id }),
                              });
                              if (!res.ok) throw new Error('resolve');
                              toast.success('Done.');
                            } catch {
                              toast.error('Failed to mark done.');
                              await refreshInbox();
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
              {activityFeed.length === 0 ? (
                <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.85rem' }}>No recent agent updates.</div>
              ) : activityFeed.map(item => (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', cursor: 'pointer' }}
                  onClick={() => navigate(item.tasksPath)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(item.tasksPath);
                    }
                  }}
                >
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
            </div>
          </div>
        </aside>
      </div>

      {/* Smart Notifications (real feed) */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div className="card-header flex justify-between items-center">
          <h3 className="card-title flex items-center gap-2"><Bell size={18} /> Smart Notifications</h3>
          <button className="btn btn-secondary" onClick={handleReport} style={{ fontSize: '0.85rem' }}>
            Generate Board Report <Download size={14} />
          </button>
        </div>
        <div className="card-body">
          {notifications.length === 0 ? (
            <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.85rem' }}>No notifications right now.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {notifications.slice(0, 6).map((n: any) => (
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.75rem 1rem', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-card)', cursor: 'pointer' }}
                  onClick={() => navigate(notificationTasksHref(n))}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(notificationTasksHref(n));
                    }
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.15rem' }}>{n.title}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.message}</div>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', flexShrink: 0 }}>{n.time}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Metrics & Anomaly section below */}
      <div className="metrics-row">
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
          onClick={openActivityLog}>
          View Activity Log
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
              onClick={() => { window.location.hash = '/agent-hq'; }}>
              View All
            </button>
          </div>
          <div className="card-body flex flex-col gap-4">
            {activityFeed.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', padding: '1.5rem 0' }}>No recent activity.</div>
            ) : activityFeed.map(act => (
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
              onClick={() => { window.location.hash = '/compliance'; }}>
              View HQ
            </button>
          </div>
          <div className="card-body flex flex-col gap-4">
            {(inboxItems.filter(i => i.kind === 'compliance_doc').slice(0, 4)).map((doc: any) => (
              <div key={(doc.ref?.id || doc.title)} className="flex justify-between items-center" style={{ paddingBottom: '0.75rem', borderBottom: '1px solid var(--color-border-light)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>{doc.meta?.doc_type ? `Type: ${doc.meta.doc_type}` : ''}</div>
                </div>
                <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>{doc.priority}</span>
              </div>
            ))}
            {inboxItems.filter(i => i.kind === 'compliance_doc').length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', padding: '1.5rem 0' }}>No expiring documents.</div>
            )}
          </div>
        </div>
      </div>

      {/* Activity Log Modal */}
      {showWhatsApp && (
        <ModalOverlay onBackdropClick={() => setShowWhatsApp(false)}>
          <div
            className="modal-card modal-card--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dash-activity-title"
            style={{ maxHeight: '70vh', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            <div className="card-header flex justify-between items-center" style={{ flexShrink: 0 }}>
              <h3 id="dash-activity-title" className="card-title flex items-center gap-2"><MessageCircle size={18} color="#16a34a" /> Activity Log</h3>
              <button type="button" className="action-btn" aria-label="Close activity log" onClick={() => setShowWhatsApp(false)}><X size={20} /></button>
            </div>
            <div ref={activityLogScrollRef} style={{ overflowY: 'auto', padding: '1rem 1.5rem 1.5rem', flex: 1, minHeight: 0 }}>
              {activityLoading ? (
                <div style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                  <Loader2 className="animate-spin mx-auto mb-2" />
                  Loading…
                </div>
              ) : activityLogs.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>No activity yet.</div>
              ) : (
                <div style={{ height: activityLogVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                  {activityLogVirtualizer.getVirtualItems().map(vr => {
                    const ev = activityLogs[vr.index];
                    return (
                      <div
                        key={String(ev.id ?? vr.index)}
                        data-index={vr.index}
                        ref={activityLogVirtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${vr.start}px)`,
                          paddingBottom: '0.75rem',
                        }}
                      >
                        <div
                          style={{
                            background: 'var(--color-bg-main)',
                            borderRadius: 'var(--radius-md)',
                            padding: '1rem',
                            border: '1px solid var(--color-border-light)',
                          }}
                        >
                          <div
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              color: 'var(--color-text-secondary)',
                              marginBottom: '0.25rem',
                            }}
                          >
                            {(ev.type || 'event').toString()} • {(ev.created_at || '').toString().slice(0, 16).replace('T', ' ')}
                          </div>
                          <div style={{ fontSize: '0.875rem' }}>
                            {ev.shift_title || ev.message || ev.audience || '—'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

export default Dashboard;
