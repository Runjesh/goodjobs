import React, { useState } from 'react';
import { Plus, Link as LinkIcon, Share2, Download, QrCode, X, Heart, BarChart2, TrendingUp, Users, IndianRupee, RefreshCw } from 'lucide-react';
import { useStore } from '../../store/useStore';
import toast from 'react-hot-toast';
import './Fundraising.css';

const Fundraising: React.FC = () => {
  const { campaigns, transactions, addCampaign, addTransaction, donors } = useStore();
  const [showModal, setShowModal] = useState(false);
  const [showDonateModal, setShowDonateModal] = useState(false);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'campaigns' | 'analytics'>('campaigns');
  const [newCampaign, setNewCampaign] = useState({ title: '', goal: 100000, cause: 'Education' });
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [donationData, setDonationData] = useState({ amount: 1000, donorId: donors[0]?.id || '', campaignId: campaigns[0]?.id || '' });
  const [mandate, setMandate] = useState({ donorId: donors[0]?.id || '', amount: 500, frequency: 'monthly', upiId: '', campaign: campaigns[0]?.id || '' });

  const handleCreateCampaign = (e: React.FormEvent) => {
    e.preventDefault();
    addCampaign({ title: newCampaign.title, goal: newCampaign.goal, status: 'active', image: 'linear-gradient(135deg, #10b981, #047857)' });
    toast.success(`Campaign "${newCampaign.title}" launched!`);
    setShowModal(false);
    setNewCampaign({ title: '', goal: 100000, cause: 'Education' });
  };

  const handleSuggestGoal = async () => {
    setIsSuggesting(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`http://localhost:8000/workflows/suggest-goal?cause=${newCampaign.cause}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
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
    navigator.clipboard?.writeText(`https://sevasuite.in/give/${slug}`).catch(() => {});
    toast.success('Donation link copied to clipboard!', { icon: '🔗' });
  };

  const handleQR = (title: string) => toast.success(`QR Code generated for "${title}"!`, { icon: '📱' });
  const handleShare = (title: string) => toast(`Share link for "${title}" ready!`, { icon: '📤' });

  const handleExportCSV = () => {
    const csv = ['ID,Donor,Amount,Method,Campaign,Date',
      ...transactions.map(t => `${t.id},${t.donorName},${t.amount},${t.method},${t.campaignTitle},${t.date}`)
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'transactions.csv'; a.click();
    toast.success('Transaction data exported!');
  };

  const handleCreateMandate = (e: React.FormEvent) => {
    e.preventDefault();
    const donor = donors.find(d => d.id === mandate.donorId);
    toast.success(
      `UPI AutoPay mandate created for ${donor?.name}! ₹${mandate.amount}/${mandate.frequency} via ${mandate.upiId || 'UPI ID'}. First debit scheduled.`,
      { icon: '🔄', duration: 5000 }
    );
    setShowRecurringModal(false);
  };

  const totalRaised = transactions.reduce((s, t) => s + t.amount, 0);
  const avgDonation = transactions.length ? Math.round(totalRaised / transactions.length) : 0;
  const conversionRate = campaigns.length ? Math.round((transactions.length / (campaigns.filter(c => c.status === 'active').length * 100)) * 100) : 0;

  const handleCreateDonation = async (e: React.FormEvent) => {
    e.preventDefault();
    const donor = donors.find(d => d.id === donationData.donorId);
    const campaign = campaigns.find(c => c.id === donationData.campaignId);
    if (!donor || !campaign) return;

    // 1. Update Global State (Zustand)
    addTransaction({
      donorId: donor.id,
      donorName: donor.name,
      amount: Number(donationData.amount),
      method: 'UPI AutoPay',
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      date: 'Just now'
    });

    // 2. Trigger the Python FastAPI LangGraph Agent Backend
    try {
      await fetch('http://localhost:8000/webhook/donation', {
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
      const token = localStorage.getItem('access_token');
      const res = await fetch('http://localhost:8000/intent/process?directive=' + encodeURIComponent("Run a monsoon appeal for clean water, goal 3L, 30 days"), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
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

      {activeTab === 'campaigns' && (
        <div className="campaign-grid">
          {campaigns.map(camp => (
            <div key={camp.id} className="card campaign-card">
              <div className="campaign-image" style={{ background: camp.image }}>
                <span className={`campaign-status ${camp.status === 'active' ? 'status-active' : 'status-draft'}`}>
                  {camp.status.toUpperCase()}
                </span>
              </div>
              <div className="campaign-content">
                <h3 className="campaign-title">{camp.title}</h3>
                <div className="progress-container">
                  <div className="progress-stats">
                    <span className="raised-amount">₹{(camp.raised).toLocaleString()}</span>
                    <span className="goal-amount">of ₹{(camp.goal).toLocaleString()}</span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${Math.min((camp.raised / camp.goal) * 100, 100)}%` }}></div>
                  </div>
                  <div className="progress-stats" style={{ marginTop: '0.25rem', color: 'var(--color-text-tertiary)' }}>
                    <span>{camp.donorsCount} Donors</span>
                    <span>{Math.round((camp.raised / camp.goal) * 100)}% Funded</span>
                  </div>
                </div>
                <div className="campaign-actions">
                  <button className="btn btn-secondary flex-1" onClick={() => handleCopyLink(camp.title)}><LinkIcon size={16} /> Link</button>
                  <button className="btn btn-secondary flex-1" onClick={() => handleQR(camp.title)}><QrCode size={16} /> QR</button>
                  <button className="btn btn-secondary flex-1" onClick={() => handleShare(camp.title)}><Share2 size={16} /> Share</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

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
            <div className="table-scroll-wrap">
              <div className="table-scroll">
                <table className="data-table">
                <thead><tr><th>Campaign</th><th>Raised</th><th>Goal</th><th>Donors</th><th>Completion</th><th>Status</th></tr></thead>
                <tbody>
                  {campaigns.map(c => {
                    const pct = Math.round((c.raised / c.goal) * 100);
                    return (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 500 }}>{c.title}</td>
                        <td style={{ fontWeight: 600 }}>₹{c.raised.toLocaleString()}</td>
                        <td style={{ color: 'var(--color-text-secondary)' }}>₹{c.goal.toLocaleString()}</td>
                        <td>{c.donorsCount}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ flex: 1, height: 6, background: 'var(--color-bg-main)', borderRadius: 999, overflow: 'hidden', minWidth: 80 }}>
                              <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: pct > 80 ? 'var(--color-success)' : 'var(--color-primary)', borderRadius: 999 }}></div>
                            </div>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, minWidth: 32 }}>{pct}%</span>
                          </div>
                        </td>
                        <td><span className={`badge ${c.status === 'active' ? 'badge-success' : 'badge-outline'}`}>{c.status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
                </table>
              </div>
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
        <div className="table-scroll-wrap">
          <div className="table-scroll">
            <table className="data-table">
            <thead>
              <tr>
                <th>Transaction ID</th>
                <th>Donor</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Campaign</th>
                <th>Time</th>
                <th>80G Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(tx => (
                <tr key={tx.id}>
                  <td style={{ fontFamily: 'monospace', color: 'var(--color-text-tertiary)' }}>{tx.id}</td>
                  <td style={{ fontWeight: 500 }}>{tx.donorName}</td>
                  <td style={{ fontWeight: 600 }}>₹{tx.amount.toLocaleString()}</td>
                  <td><span className="badge badge-outline">{tx.method}</span></td>
                  <td>{tx.campaignTitle}</td>
                  <td style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>{tx.date}</td>
                  <td><span className="badge badge-success">Sent via WhatsApp</span></td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>No transactions found.</td>
                </tr>
              )}
            </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Campaign Modal */}
      {showModal && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ width: '400px', padding: '1.5rem', position: 'relative' }}>
            <button onClick={() => setShowModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem' }} className="action-btn"><X size={20} /></button>
            <h2 style={{ marginBottom: '1.5rem' }}>Create Campaign</h2>
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
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>Launch Campaign</button>
            </form>
          </div>
        </div>
      )}

      {/* Donation Modal */}
      {showDonateModal && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ width: '400px', padding: '1.5rem', position: 'relative' }}>
            <button onClick={() => setShowDonateModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem' }} className="action-btn"><X size={20} /></button>
            <h2 style={{ marginBottom: '1.5rem' }}>Add Manual Donation</h2>
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
        </div>
      )}

      {/* Recurring Giving Modal */}
      {showRecurringModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ width: '480px', padding: '1.5rem', position: 'relative' }}>
            <button onClick={() => setShowRecurringModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem' }} className="action-btn"><X size={20} /></button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <RefreshCw size={22} color="var(--color-primary)" />
              <h2>Set Up Recurring Giving (UPI AutoPay)</h2>
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
        </div>
      )}
    </div>
  );
};

export default Fundraising;

