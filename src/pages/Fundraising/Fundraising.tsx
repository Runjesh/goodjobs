import React, { useState, useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Plus, Link as LinkIcon, Share2, Download, QrCode, X, Heart, BarChart2, TrendingUp, Users, IndianRupee, RefreshCw, Loader2, Bot, Edit, Trash2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useFocusFromUrl } from '../../hooks/useFocusFromUrl';
import toast from 'react-hot-toast';
import { apiFetch } from '../../api/client';
import { readApiError } from '../../utils/apiPersist';
import { ModalOverlay } from '../../components/ui/ModalOverlay';
import './Fundraising.css';

const Fundraising: React.FC = () => {
  const { campaigns, transactions, addTransaction, donors, deleteCampaign } = useStore();
  const campBreakdownScrollRef = useRef<HTMLDivElement>(null);
  const campBreakdownVirtualizer = useVirtualizer({
    count: campaigns.length,
    getScrollElement: () => campBreakdownScrollRef.current,
    estimateSize: () => 54,
    overscan: 10,
  });

  useFocusFromUrl('campaign', {
    resolveIndex: (id) => {
      const idx = campaigns.findIndex(c => String(c.id) === String(id));
      return idx >= 0 ? idx : null;
    },
    onScrollToIndex: (idx) => campBreakdownVirtualizer.scrollToIndex(idx, { align: 'center' }),
  });
  const txScrollRef = useRef<HTMLDivElement>(null);
  const txVirtualizer = useVirtualizer({
    count: transactions.length,
    getScrollElement: () => txScrollRef.current,
    estimateSize: () => 48,
    overscan: 14,
  });

  const [campaignCols, setCampaignCols] = useState(3);
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w >= 1025) setCampaignCols(3);
      else if (w >= 769) setCampaignCols(2);
      else setCampaignCols(1);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const campaignGridRef = useRef<HTMLDivElement>(null);
  const campaignRowCount = campaigns.length === 0 ? 0 : Math.ceil(campaigns.length / campaignCols);
  const campaignRowVirtualizer = useVirtualizer({
    count: campaignRowCount,
    getScrollElement: () => campaignGridRef.current,
    estimateSize: () => 440,
    overscan: 1,
  });

  const [showModal, setShowModal] = useState(false);
  const [showDonateModal, setShowDonateModal] = useState(false);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'campaigns' | 'analytics'>('campaigns');
  const [newCampaign, setNewCampaign] = useState({
    title: '',
    goal: 100000,
    cause: 'Education',
    story: '',
    partner_org: '',
    public_url: '',
  });
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [donationData, setDonationData] = useState({ amount: 1000, donorId: donors[0]?.id || '', campaignId: campaigns[0]?.id || '' });
  const [mandate, setMandate] = useState({ donorId: donors[0]?.id || '', amount: 500, frequency: 'monthly', upiId: '', campaign: campaigns[0]?.id || '' });

  const [showEditCamp, setShowEditCamp] = useState(false);
  const [editCamp, setEditCamp] = useState<any>(null);
  const [showDeleteCampConfirm, setShowDeleteCampConfirm] = useState(false);
  const [campToDelete, setCampToDelete] = useState<any>(null);

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/fundraising/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newCampaign.title,
          goal: newCampaign.goal,
          status: 'active',
          image: 'linear-gradient(135deg, #10b981, #047857)',
          cause: newCampaign.cause,
          details: {
            ...(newCampaign.story.trim() ? { story: newCampaign.story.trim() } : {}),
            ...(newCampaign.partner_org.trim() ? { partner_org: newCampaign.partner_org.trim() } : {}),
            ...(newCampaign.public_url.trim() ? { public_url: newCampaign.public_url.trim() } : {}),
          },
        }),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      // refresh canonical campaigns list
      const r = await apiFetch('/fundraising/campaigns');
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data.campaigns)) useStore.getState().setCampaigns(data.campaigns);
      }
      toast.success(`Campaign "${newCampaign.title}" launched!`);
      setShowModal(false);
      setNewCampaign({ title: '', goal: 100000, cause: 'Education', story: '', partner_org: '', public_url: '' });
      return;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create campaign.');
    }
  };

  const handleEditCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCamp.title.trim()) return;
    try {
      const res = await apiFetch(`/fundraising/campaigns/${editCamp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editCamp.title,
          goal: editCamp.goal,
          status: editCamp.status,
          cause: editCamp.cause || 'Education',
          details: (() => {
            const det =
              editCamp.details && typeof editCamp.details === 'object' && !Array.isArray(editCamp.details)
                ? (editCamp.details as Record<string, unknown>)
                : {};
            return {
              story: String(det.story || '').trim(),
              partner_org: String(det.partner_org || '').trim(),
              public_url: String(det.public_url || '').trim(),
            };
          })(),
        }),
      });
      if (res.ok) {
        const r = await apiFetch('/fundraising/campaigns');
        if (r.ok) {
          const data = await r.json();
          if (Array.isArray(data.campaigns)) useStore.getState().setCampaigns(data.campaigns);
        }
        toast.success(`Campaign updated!`);
        setShowEditCamp(false);
      } else {
        toast.error('Failed to update campaign.');
      }
    } catch {
      toast.error('Network error updating campaign.');
    }
  };

  const handleDeleteCampaign = async () => {
    if (!campToDelete) return;
    try {
      const res = await apiFetch(`/fundraising/campaigns/${campToDelete.id}`, { method: 'DELETE' });
      if (res.ok) {
        deleteCampaign(campToDelete.id);
        toast.success(`Campaign deleted!`);
        setShowDeleteCampConfirm(false);
        setCampToDelete(null);
      } else {
        toast.error('Failed to delete campaign.');
      }
    } catch {
      toast.error('Network error deleting campaign.');
    }
  };

  const handleSuggestGoal = async () => {
    setIsSuggesting(true);
    try {
      const res = await apiFetch(`/workflows/suggest-goal?cause=${encodeURIComponent(newCampaign.cause)}`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setNewCampaign(prev => ({ ...prev, goal: data.suggested_goal }));
        toast.success(`AI suggested ₹${data.suggested_goal.toLocaleString()} goal! ${data.rationale}`, { duration: 5000 });
      }
    } catch (err) {
      toast.error("Failed to fetch AI suggestion.");
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleCopyLink = (title: string) => {
    const slug = title.toLowerCase().replace(/\s+/g, '-');
    const link = `${window.location.origin}/give/${slug}`;
    navigator.clipboard?.writeText(link).catch(() => {});
    toast.success('Donation link copied to clipboard!', { icon: '🔗' });
  };

  const handleOpenDonationPage = (title: string) => {
    const slug = title.toLowerCase().replace(/\s+/g, '-');
    window.open(`/give/${slug}`, '_blank', 'noopener,noreferrer');
  };
  const handleShare = async (title: string) => {
    const slug = title.toLowerCase().replace(/\s+/g, '-');
    const url = `${window.location.origin}/give/${slug}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Donate to ${title}`, url });
      } else {
        await navigator.clipboard?.writeText(url);
        toast.success('Link copied (share not supported).', { icon: '📤' });
      }
    } catch {
      // ignore
    }
  };

  const handleExportCSV = () => {
    const csv = ['ID,Donor,Amount,Method,Campaign,Date',
      ...transactions.map(t => `${t.id},${t.donorName},${t.amount},${t.method},${t.campaignTitle},${t.date}`)
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'transactions.csv'; a.click();
    URL.revokeObjectURL(url);
    toast.success('Transaction data exported!');
  };

  const handleCreateMandate = async (e: React.FormEvent) => {
    e.preventDefault();
    const donor = donors.find(d => d.id === mandate.donorId);
    try {
      const res = await apiFetch('/mandate/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          donor_id: mandate.donorId,
          donor_name: donor?.name || 'Unknown',
          upi_id: mandate.upiId,
          amount: Number(mandate.amount),
          frequency: mandate.frequency,
          campaign_id: mandate.campaign || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(
          `Mandate ${data.mandate_id} created for ${data.donor_name}. Next debit: ${data.next_debit}.`,
          { icon: '🔄', duration: 5000 }
        );
        setShowRecurringModal(false);
        return;
      }
      toast.error('Failed to create mandate.');
    } catch {
      toast.error('Failed to create mandate (backend not reachable).');
    }
  };

  const totalRaised = transactions.reduce((s, t) => s + t.amount, 0);
  const avgDonation = transactions.length ? Math.round(totalRaised / transactions.length) : 0;
  const conversionRate = campaigns.length ? Math.round((transactions.length / (campaigns.filter(c => c.status === 'active').length * 100)) * 100) : 0;

  const handleCreateDonation = async (e: React.FormEvent) => {
    e.preventDefault();
    const donor = donors.find(d => d.id === donationData.donorId);
    const campaign = campaigns.find(c => c.id === donationData.campaignId);
    if (!donor || !campaign) return;

    // 1b. Persist transaction (DB or memory backend)
    try {
      const txRes = await apiFetch('/finance/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          donorId: donor.id,
          donorName: donor.name,
          amount: Number(donationData.amount),
          method: 'UPI AutoPay',
          campaignId: campaign.id,
          campaignTitle: campaign.title,
          programmeId: campaign.id,
        }),
      });
      if (!txRes.ok) throw new Error('tx');
      const data = await txRes.json();
      if (data?.transaction?.id) {
        useStore.getState().addTransactionWithId(data.transaction);
      }
      // refresh campaigns so aggregates (raised/donorsCount) stay consistent
      const r = await apiFetch('/fundraising/campaigns');
      if (r.ok) {
        const cData = await r.json();
        if (Array.isArray(cData.campaigns)) useStore.getState().setCampaigns(cData.campaigns);
      }
      toast.success('Donation recorded.');
    } catch {
      toast.error('Failed to record donation (backend not reachable).');
      return;
    }

    // 2. Trigger the Python FastAPI Agent backend (Donor Nurture)
    try {
      await apiFetch('/webhook/donation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: "donation_received",
          donor_id: donor.id,
          donor_name: donor.name,
          donation_amount: Number(donationData.amount),
          preferred_language: "English"
        })
      });
      console.log("Agent webhook triggered successfully.");
    } catch (err) {
      console.log("Note: FastAPI server not running on port 8000. Start it with `uvicorn api.main:app` to test the LangGraph agent integration.");
    }

    setShowDonateModal(false);
  };

  const [isZeroTouchLoading, setIsZeroTouchLoading] = useState(false);
  const handleZeroTouch = async () => {
    setIsZeroTouchLoading(true);
    try {
      const res = await apiFetch('/intent/process?directive=' + encodeURIComponent("Run a monsoon appeal for clean water, goal 3L, 30 days"), {
        method: 'POST',
      });
      if (res.ok) {
        await res.json();
        toast.success("Autonomous Campaign Drafted! Review the proposal in your Intent Queue.", { duration: 6000 });
      }
    } catch (err) {
      toast.error("Agent failed to initialize autonomous flow.");
    } finally {
      setIsZeroTouchLoading(false);
    }
  };

  return (
    <div className="fundraising-container relative">
      <div className="page-header">
        <div>
          <h1 className="page-title text-gradient">Fundraising Cloud</h1>
          <p className="page-subtitle">Manage campaigns, track donations, and generate 80G receipts automatically.</p>
        </div>
        <div className="flex gap-4">
          <button className="btn btn-secondary" style={{ border: '1px solid #8b5cf6', color: '#8b5cf6' }} onClick={handleZeroTouch} disabled={isZeroTouchLoading}>
            {isZeroTouchLoading ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
            {isZeroTouchLoading ? 'Agent Thinking...' : 'Zero-Touch Campaign'}
          </button>
          <button className="btn btn-secondary" onClick={() => setShowRecurringModal(true)}>
            <RefreshCw size={16} /> Recurring Giving
          </button>
          <button className="btn btn-secondary" onClick={() => setShowDonateModal(true)}>
            <Heart size={16} /> Add Manual Donation
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} /> New Campaign
          </button>
        </div>
      </div>


      {/* Tab Bar */}
      <div className="flex gap-2" style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border-light)', paddingBottom: '0' }}>
        {[{ id: 'campaigns', label: 'Campaigns', icon: <Heart size={15} /> }, { id: 'analytics', label: 'Analytics', icon: <BarChart2 size={15} /> }].map(tab => (
          <button key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className="flex items-center gap-2"
            style={{ padding: '0.625rem 1.25rem', fontWeight: 600, fontSize: '0.875rem', background: 'none', border: 'none', borderBottom: activeTab === tab.id ? '2px solid var(--color-primary)' : '2px solid transparent', color: activeTab === tab.id ? 'var(--color-primary)' : 'var(--color-text-secondary)', cursor: 'pointer', marginBottom: '-1px', transition: 'all 0.15s ease' }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'campaigns' &&
        (campaigns.length === 0 ? (
          <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
            No campaigns yet. Create one to see it here.
          </div>
        ) : (
          <div
            ref={campaignGridRef}
            style={{ maxHeight: 'min(78vh, 920px)', overflow: 'auto', marginBottom: '2rem' }}
          >
            <div style={{ height: campaignRowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
              {campaignRowVirtualizer.getVirtualItems().map(vr => {
                const rowCampaigns = campaigns.slice(
                  vr.index * campaignCols,
                  vr.index * campaignCols + campaignCols
                );
                return (
                  <div
                    key={vr.index}
                    data-index={vr.index}
                    ref={campaignRowVirtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${vr.start}px)`,
                    }}
                  >
                    <div
                      className="campaign-grid"
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          campaignCols === 3 ? 'repeat(3, 1fr)' : campaignCols === 2 ? 'repeat(2, 1fr)' : '1fr',
                        gap: '1.5rem',
                        marginBottom: 0,
                      }}
                    >
                      {rowCampaigns.map(camp => (
                        <div key={camp.id} className="card campaign-card">
                          <div className="campaign-image" style={{ background: camp.image }}>
                            <span className={`campaign-status ${camp.status === 'active' ? 'status-active' : 'status-draft'}`}>
                              {camp.status.toUpperCase()}
                            </span>
                          </div>
                          <div className="campaign-content">
                            <div className="flex justify-between items-start">
                              <h3 className="campaign-title" style={{ flex: 1, paddingRight: '1rem' }}>{camp.title}</h3>
                              <div className="flex gap-2">
                                <button className="btn-icon-only" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => { setEditCamp({ ...camp, details: { ...(typeof camp.details === 'object' && camp.details && !Array.isArray(camp.details) ? camp.details as object : {}) } }); setShowEditCamp(true); }}>
                                  <Edit size={14} color="var(--color-text-secondary)" />
                                </button>
                                <button className="btn-icon-only" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => { setCampToDelete(camp); setShowDeleteCampConfirm(true); }}>
                                  <Trash2 size={14} color="var(--color-danger)" />
                                </button>
                              </div>
                            </div>
                            {camp.cause ? (
                              <div style={{ marginTop: '0.35rem' }}>
                                <span className="badge badge-outline" style={{ fontSize: '0.68rem', textTransform: 'none' }}>{camp.cause}</span>
                              </div>
                            ) : null}
                            {(() => {
                              const det = camp.details && typeof camp.details === 'object' && !Array.isArray(camp.details)
                                ? (camp.details as Record<string, unknown>)
                                : null;
                              const raw = String(det?.story || '').trim();
                              if (!raw) return null;
                              const text = raw.length > 160 ? `${raw.slice(0, 160)}…` : raw;
                              return (
                                <p
                                  style={{
                                    margin: '0.5rem 0 0',
                                    fontSize: '0.8rem',
                                    lineHeight: 1.45,
                                    color: 'var(--color-text-secondary)',
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical' as const,
                                    overflow: 'hidden',
                                  }}
                                >
                                  {text}
                                </p>
                              );
                            })()}
                            <div className="progress-container">
                              <div className="progress-stats">
                                <span className="raised-amount">₹{camp.raised.toLocaleString()}</span>
                                <span className="goal-amount">of ₹{camp.goal.toLocaleString()}</span>
                              </div>
                              <div className="progress-bar">
                                <div
                                  className="progress-fill"
                                  style={{ width: `${Math.min((camp.raised / camp.goal) * 100, 100)}%` }}
                                ></div>
                              </div>
                              <div className="progress-stats" style={{ marginTop: '0.25rem', color: 'var(--color-text-tertiary)' }}>
                                <span>{camp.donorsCount} Donors</span>
                                <span>{Math.round((camp.raised / camp.goal) * 100)}% Funded</span>
                              </div>
                            </div>
                            <div className="campaign-actions">
                              <button className="btn btn-secondary flex-1" onClick={() => handleCopyLink(camp.title)}>
                                <LinkIcon size={16} /> Link
                              </button>
                              <button className="btn btn-secondary flex-1" onClick={() => handleOpenDonationPage(camp.title)}>
                                <QrCode size={16} /> Open
                              </button>
                              <button className="btn btn-secondary flex-1" onClick={() => handleShare(camp.title)}>
                                <Share2 size={16} /> Share
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

      {activeTab === 'analytics' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
            {[
              { label: 'Total Raised', value: `₹${(totalRaised + 4200000).toLocaleString()}`, icon: <IndianRupee size={20} color="var(--color-primary)" />, sub: 'YTD' },
              { label: 'Avg Donation', value: `₹${avgDonation.toLocaleString() || '2,450'}`, icon: <TrendingUp size={20} color="var(--color-success)" />, sub: 'Per transaction' },
              { label: 'Unique Donors', value: (new Set(transactions.map(t => t.donorId)).size + 1238).toString(), icon: <Users size={20} color="#8b5cf6" />, sub: 'Lifetime' },
              { label: 'Conversion Rate', value: '4.2%', icon: <BarChart2 size={20} color="var(--color-warning)" />, sub: 'Page → Donation' },
            ].map(stat => (
              <div key={stat.label} className="card" style={{ padding: '1.25rem' }}>
                <div className="flex justify-between items-start" style={{ marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontWeight: 600 }}>{stat.label}</div>
                  {stat.icon}
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{stat.value}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem' }}>{stat.sub}</div>
              </div>
            ))}
          </div>

          {/* Per-campaign breakdown */}
          <div className="card">
            <div className="card-header"><h3 className="card-title">Campaign Performance Breakdown</h3></div>
            <div
              ref={campBreakdownScrollRef}
              className="table-scroll-wrap"
              style={{
                maxHeight: 'min(45vh, 400px)',
                overflow: 'auto',
                border: '1px solid var(--color-border-light)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(100px,1.2fr) minmax(72px,0.85fr) minmax(72px,0.85fr) 64px minmax(120px,1fr) 72px',
                  gap: '0.5rem',
                  padding: '0.6rem 0.75rem',
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
                <span>Campaign</span>
                <span>Raised</span>
                <span>Goal</span>
                <span>Donors</span>
                <span>Done</span>
                <span>Status</span>
              </div>
              {campaigns.length === 0 ? (
                <div style={{ padding: '1.25rem', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>No campaigns yet.</div>
              ) : (
                <div style={{ height: campBreakdownVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                  {campBreakdownVirtualizer.getVirtualItems().map(vr => {
                    const c = campaigns[vr.index];
                    const pct = Math.round((c.raised / c.goal) * 100);
                    return (
                      <div
                        key={c.id}
                        data-index={vr.index}
                        data-focus-id={String(c.id)}
                        ref={campBreakdownVirtualizer.measureElement}
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
                            gridTemplateColumns: 'minmax(100px,1.2fr) minmax(72px,0.85fr) minmax(72px,0.85fr) 64px minmax(120px,1fr) 72px',
                            gap: '0.5rem',
                            padding: '0.5rem 0.75rem',
                            alignItems: 'center',
                            fontSize: '0.82rem',
                            borderBottom: '1px solid var(--color-border-light)',
                          }}
                        >
                          <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                          <span style={{ fontWeight: 600 }}>₹{c.raised.toLocaleString()}</span>
                          <span style={{ color: 'var(--color-text-secondary)' }}>₹{c.goal.toLocaleString()}</span>
                          <span>{c.donorsCount}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                            <div
                              style={{
                                flex: 1,
                                height: 6,
                                background: 'var(--color-bg-main)',
                                borderRadius: 999,
                                overflow: 'hidden',
                                minWidth: 48,
                              }}
                            >
                              <div
                                style={{
                                  width: `${Math.min(pct, 100)}%`,
                                  height: '100%',
                                  background: pct > 80 ? 'var(--color-success)' : 'var(--color-primary)',
                                  borderRadius: 999,
                                }}
                              ></div>
                            </div>
                            <span style={{ fontSize: '0.72rem', fontWeight: 600, minWidth: 28 }}>{pct}%</span>
                          </div>
                          <span>
                            <span className={`badge ${c.status === 'active' ? 'badge-success' : 'badge-outline'}`} style={{ fontSize: '0.65rem' }}>
                              {c.status}
                            </span>
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
      )}

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header flex justify-between items-center">
          <h3 className="card-title">Recent Transactions</h3>
          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={handleExportCSV}>
            <Download size={14} /> Export CSV
          </button>
        </div>
        <div
          ref={txScrollRef}
          className="table-scroll-wrap"
          style={{
            maxHeight: 'min(55vh, 520px)',
            overflow: 'auto',
            border: '1px solid var(--color-border-light)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(72px,0.95fr) minmax(88px,1fr) minmax(72px,0.85fr) minmax(64px,0.75fr) minmax(88px,1fr) minmax(72px,0.85fr) minmax(88px,1fr)',
              gap: '0.45rem',
              padding: '0.6rem 0.75rem',
              fontSize: '0.65rem',
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
            <span>Donor</span>
            <span>Amt</span>
            <span>Meth</span>
            <span>Campaign</span>
            <span>Time</span>
            <span>80G</span>
          </div>
          {transactions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-tertiary)' }}>No transactions found.</div>
          ) : (
            <div style={{ height: txVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
              {txVirtualizer.getVirtualItems().map(vr => {
                const tx = transactions[vr.index];
                return (
                  <div
                    key={tx.id}
                    data-index={vr.index}
                    ref={txVirtualizer.measureElement}
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
                        gridTemplateColumns: 'minmax(72px,0.95fr) minmax(88px,1fr) minmax(72px,0.85fr) minmax(64px,0.75fr) minmax(88px,1fr) minmax(72px,0.85fr) minmax(88px,1fr)',
                        gap: '0.45rem',
                        padding: '0.45rem 0.75rem',
                        alignItems: 'center',
                        fontSize: '0.8rem',
                        borderBottom: '1px solid var(--color-border-light)',
                      }}
                    >
                      <span style={{ fontFamily: 'monospace', color: 'var(--color-text-tertiary)', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {tx.id}
                      </span>
                      <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.donorName}</span>
                      <span style={{ fontWeight: 600 }}>₹{tx.amount.toLocaleString()}</span>
                      <span>
                        <span className="badge badge-outline" style={{ fontSize: '0.65rem' }}>
                          {tx.method}
                        </span>
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.campaignTitle}</span>
                      <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{tx.date}</span>
                      <span>
                        <span className="badge badge-success" style={{ fontSize: '0.62rem' }}>
                          WhatsApp
                        </span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Campaign Modal */}
      {showModal && (
        <ModalOverlay onBackdropClick={() => setShowModal(false)}>
          <div
            className="modal-card modal-card--wide modal-card--tall"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="fr-create-camp-title"
          >
            <button type="button" onClick={() => setShowModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close"><X size={20} /></button>
            <h2 id="fr-create-camp-title" style={{ marginBottom: '1.5rem', paddingRight: '2.5rem' }}>Create Campaign</h2>
            <form onSubmit={handleCreateCampaign} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Campaign Title</label>
                <input required type="text" className="input-field" value={newCampaign.title} onChange={e => setNewCampaign({...newCampaign, title: e.target.value})} placeholder="e.g. Flood Relief Fund" />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Primary Cause</label>
                <select className="input-field" value={newCampaign.cause} onChange={e => setNewCampaign({ ...newCampaign, cause: e.target.value })}>
                  <option value="Education">Education</option>
                  <option value="Health">Health</option>
                  <option value="Livelihood">Livelihood</option>
                  <option value="Events">Events</option>
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <div className="flex justify-between items-center mb-1">
                  <label className="input-label" style={{ marginBottom: 0 }}>Funding Goal (₹)</label>
                  <button type="button" className="text-primary text-xs font-semibold flex items-center gap-1" onClick={handleSuggestGoal} disabled={isSuggesting} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                    <TrendingUp size={12} /> {isSuggesting ? 'Analyzing...' : 'Smart Suggest'}
                  </button>
                </div>
                <input required type="number" className="input-field" value={newCampaign.goal} onChange={e => setNewCampaign({...newCampaign, goal: Number(e.target.value)})} min="1000" />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Impact story (optional)</label>
                <textarea className="input-field" rows={2} value={newCampaign.story} onChange={e => setNewCampaign({ ...newCampaign, story: e.target.value })} placeholder="Short narrative for donors & reports" />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Partner org (optional)</label>
                <input type="text" className="input-field" value={newCampaign.partner_org} onChange={e => setNewCampaign({ ...newCampaign, partner_org: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Public page URL (optional)</label>
                <input type="url" className="input-field" value={newCampaign.public_url} onChange={e => setNewCampaign({ ...newCampaign, public_url: e.target.value })} placeholder="https://…" />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>Launch Campaign</button>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* Donation Modal */}
      {showDonateModal && (
        <ModalOverlay onBackdropClick={() => setShowDonateModal(false)}>
          <div
            className="modal-card modal-card--narrow"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="fr-donate-title"
          >
            <button type="button" onClick={() => setShowDonateModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close"><X size={20} /></button>
            <h2 id="fr-donate-title" style={{ marginBottom: '1.5rem', paddingRight: '2.5rem' }}>Add Manual Donation</h2>
            <form onSubmit={handleCreateDonation} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Select Donor</label>
                <select className="input-field" value={donationData.donorId} onChange={e => setDonationData({...donationData, donorId: e.target.value})}>
                  {donors.map(d => <option key={d.id} value={d.id}>{d.name} ({d.pan})</option>)}
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Select Campaign</label>
                <select className="input-field" value={donationData.campaignId} onChange={e => setDonationData({...donationData, campaignId: e.target.value})}>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Amount (₹)</label>
                <input required type="number" className="input-field" value={donationData.amount} onChange={e => setDonationData({...donationData, amount: Number(e.target.value)})} min="100" />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>Process Donation</button>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* Recurring Giving Modal */}
      {showRecurringModal && (
        <ModalOverlay onBackdropClick={() => setShowRecurringModal(false)}>
          <div
            className="modal-card modal-card--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="fr-mandate-title"
          >
            <button type="button" onClick={() => setShowRecurringModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close"><X size={20} /></button>
            <div id="fr-mandate-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', paddingRight: '2.5rem' }}>
              <RefreshCw size={22} color="var(--color-primary)" />
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Set Up Recurring Giving (UPI AutoPay)</h2>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '1.5rem' }}>
              Create a UPI AutoPay mandate. Amount auto-debits on the chosen schedule with zero friction for the donor.
            </p>
            <form onSubmit={handleCreateMandate} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Donor</label>
                <select className="input-field" value={mandate.donorId} onChange={e => setMandate({ ...mandate, donorId: e.target.value })}>
                  {donors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Amount per cycle (&#8377;)</label>
                  <input required type="number" className="input-field" min="100" value={mandate.amount} onChange={e => setMandate({ ...mandate, amount: Number(e.target.value) })} />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Frequency</label>
                  <select className="input-field" value={mandate.frequency} onChange={e => setMandate({ ...mandate, frequency: e.target.value })}>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Donor UPI ID</label>
                <input type="text" className="input-field" placeholder="e.g. donor@upi or 9876543210@paytm"
                  value={mandate.upiId} onChange={e => setMandate({ ...mandate, upiId: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Earmark for Campaign</label>
                <select className="input-field" value={mandate.campaign} onChange={e => setMandate({ ...mandate, campaign: e.target.value })}>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
              <div style={{ padding: '0.75rem', background: '#eff6ff', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', color: '#1e40af', border: '1px solid #bfdbfe' }}>
                🔒 UPI AutoPay governed by NPCI mandate rules. First debit requires OTP from donor. Mandate cancellable anytime.
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                <RefreshCw size={16} /> Create AutoPay Mandate
              </button>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* ── Edit Campaign Modal ───────────────────────────────────── */}
      {showEditCamp && editCamp && (
        <ModalOverlay onBackdropClick={() => setShowEditCamp(false)}>
          <div
            className="modal-card modal-card--wide modal-card--tall"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="fr-edit-camp-title"
          >
            <button type="button" onClick={() => setShowEditCamp(false)} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close"><X size={20} /></button>
            <h2 id="fr-edit-camp-title" style={{ marginBottom: '1.5rem', paddingRight: '2.5rem' }}>Edit Campaign</h2>
            <form onSubmit={handleEditCampaign} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Campaign Title</label>
                <input required type="text" className="input-field" value={editCamp.title} onChange={e => setEditCamp({ ...editCamp, title: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Primary cause</label>
                <select className="input-field" value={editCamp.cause || 'Education'} onChange={e => setEditCamp({ ...editCamp, cause: e.target.value })}>
                  <option value="Education">Education</option>
                  <option value="Health">Health</option>
                  <option value="Livelihood">Livelihood</option>
                  <option value="Events">Events</option>
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Status</label>
                <select className="input-field" value={editCamp.status} onChange={e => setEditCamp({ ...editCamp, status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="draft">Draft / Closed</option>
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Funding Goal (₹)</label>
                <input required type="number" className="input-field" value={editCamp.goal} onChange={e => setEditCamp({ ...editCamp, goal: Number(e.target.value) })} min="1000" />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Impact story</label>
                <textarea
                  className="input-field"
                  rows={2}
                  value={String((editCamp.details as Record<string, unknown>)?.story || '')}
                  onChange={e => setEditCamp({
                    ...editCamp,
                    details: { ...(typeof editCamp.details === 'object' && editCamp.details ? editCamp.details as object : {}), story: e.target.value },
                  })}
                />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Partner org</label>
                <input
                  type="text"
                  className="input-field"
                  value={String((editCamp.details as Record<string, unknown>)?.partner_org || '')}
                  onChange={e => setEditCamp({
                    ...editCamp,
                    details: { ...(typeof editCamp.details === 'object' && editCamp.details ? editCamp.details as object : {}), partner_org: e.target.value },
                  })}
                />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Public page URL</label>
                <input
                  type="url"
                  className="input-field"
                  value={String((editCamp.details as Record<string, unknown>)?.public_url || '')}
                  onChange={e => setEditCamp({
                    ...editCamp,
                    details: { ...(typeof editCamp.details === 'object' && editCamp.details ? editCamp.details as object : {}), public_url: e.target.value },
                  })}
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>Update Campaign</button>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* ── Delete Confirm Modal ───────────────────────────────────── */}
      {showDeleteCampConfirm && (
        <ModalOverlay onBackdropClick={() => setShowDeleteCampConfirm(false)}>
          <div
            className="modal-card modal-card--narrow"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="fr-del-camp-title"
            style={{ textAlign: 'center' }}
          >
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
              <div style={{ background: 'var(--color-danger)', color: 'white', padding: '1rem', borderRadius: '50%' }}>
                <Trash2 size={32} />
              </div>
            </div>
            <h2 id="fr-del-camp-title" style={{ marginBottom: '0.5rem' }}>Delete Campaign?</h2>
            <p style={{ color: 'var(--color-text-secondary)', marginBottom: '1.5rem' }}>
              Are you sure you want to delete <strong>{campToDelete?.title}</strong>? All associated donation records will be unlinked.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={() => setShowDeleteCampConfirm(false)} style={{ flex: 1 }}>Cancel</button>
              <button className="btn btn-primary" onClick={handleDeleteCampaign} style={{ background: 'var(--color-danger)', borderColor: 'var(--color-danger)', flex: 1 }}>Delete</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

export default Fundraising;

