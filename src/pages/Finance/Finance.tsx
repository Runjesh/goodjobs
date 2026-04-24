import React, { useEffect, useState } from 'react';
import { IndianRupee, RefreshCw, FileText, Download, AlertCircle, ArrowUpRight, Plus, X, Bot, Globe } from 'lucide-react';
import toast from 'react-hot-toast';
import './Finance.css';
import { apiFetch } from '../../api/client';

const initialGrants = [
  { id: 'G-2026-01', name: 'Rural Digital Literacy (CSR)', total: 2500000, spent: 1800000, variance: 50000, status: 'On Track' },
  { id: 'G-2026-02', name: 'Women Empowerment (FCRA)', total: 4000000, spent: 3800000, variance: -150000, status: 'Over Budget' },
  { id: 'G-2026-03', name: 'Healthcare Camp Fund', total: 1000000, spent: 400000, variance: 0, status: 'On Track' },
];

const Finance: React.FC = () => {
  const [grants, setGrants] = useState(initialGrants);
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [editingGrantId, setEditingGrantId] = useState<string | null>(null);
  const [grantForm, setGrantForm] = useState<{ name: string; total: number; spent: number; status: string }>({
    name: '',
    total: 1000000,
    spent: 0,
    status: 'On Track',
  });
  const [entry, setEntry] = useState({ description: '', amount: 1000, type: 'Expense', fund: 'General' });
  const [classification, setClassification] = useState<{category: string, confidence: number} | null>(null);
  const [isClassifying, setIsClassifying] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [grantsLoading, setGrantsLoading] = useState(false);

  const loadGrants = async () => {
    setGrantsLoading(true);
    try {
      const res = await apiFetch('/finance/grants');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.grants) && data.grants.length > 0) {
          setGrants(data.grants);
        }
      }
    } catch {
      // ignore (demo fallback)
    } finally {
      setGrantsLoading(false);
    }
  };

  useEffect(() => {
    loadGrants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fcraTotal = 4000000;
  const fcraAdminSpent = 750000;
  const fcraAdminLimit = fcraTotal * 0.2;
  const fcraAdminPercent = (fcraAdminSpent / fcraAdminLimit) * 100;
  const isFcraWarning = fcraAdminPercent > 85;

  const handleJournalEntry = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success(`Journal entry recorded: ₹${Number(entry.amount).toLocaleString()} (${entry.type}) in ${entry.fund} fund.`);
    setShowEntryModal(false);
    setEntry({ description: '', amount: 1000, type: 'Expense', fund: 'General' });
  };

  const handleTallySync = () => {
    setSyncing(true);
    setTimeout(() => {
      setSyncing(false);
      toast.success('Tally Prime sync complete! 24 vouchers exported.', { icon: 'T' });
    }, 2000);
  };

  const handleTallyXMLExport = async () => {
    try {
      // Use backend generator so the format stays consistent.
      const res = await apiFetch('/export/tally-xml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ngo_name: 'India NGO Trust',
          transactions: [
            {
              id: 'TRX-1090',
              date: new Date().toISOString().slice(0, 10),
              amount: 5000,
              donor_name: 'Anjali Desai',
              method: 'UPI',
              fund: 'General',
            },
          ],
        }),
      });
      if (!res.ok) {
        toast.error('Failed to export Tally XML.');
        return;
      }
      const xml = await res.text();
      const blob = new Blob([xml], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sevasuite_tally_${new Date().toISOString().split('T')[0]}.xml`;
      a.click();
      toast.success('Tally Prime XML exported from backend.', { duration: 5000, icon: '💾' });
    } catch {
      toast.error('Failed to export Tally XML (backend not reachable).');
    }
  };

  const handleExportReport = () => {
    const csv = ['Grant ID,Name,Total,Spent,Variance,Status',
      ...grants.map(g => `${g.id},${g.name},${g.total},${g.spent},${g.variance},${g.status}`)
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'grant_utilization.csv'; a.click();
    toast.success('Grant utilization report exported!');
  };

  const handleGenerateUC = () => {
    toast.success('Generating Utilization Certificate (CSR-1) PDF...', { icon: '📄' });
  };

  const openCreateGrant = () => {
    setEditingGrantId(null);
    setGrantForm({ name: '', total: 1000000, spent: 0, status: 'On Track' });
    setShowGrantModal(true);
  };

  const openEditGrant = (g: any) => {
    setEditingGrantId(g.id);
    setGrantForm({ name: g.name, total: Number(g.total) || 0, spent: Number(g.spent) || 0, status: g.status || 'On Track' });
    setShowGrantModal(true);
  };

  const saveGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: grantForm.name,
        total: Number(grantForm.total),
        spent: Number(grantForm.spent),
        variance: Number(grantForm.total) - Number(grantForm.spent),
        status: grantForm.status,
      };
      const res = await apiFetch(editingGrantId ? `/finance/grants/${encodeURIComponent(editingGrantId)}` : '/finance/grants', {
        method: editingGrantId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('save grant');
      toast.success(editingGrantId ? 'Grant updated.' : 'Grant created.');
      setShowGrantModal(false);
      await loadGrants();
    } catch {
      toast.error('Failed to save grant.');
    }
  };

  const deleteGrant = async (id: string) => {
    if (!confirm('Delete this grant?')) return;
    try {
      const res = await apiFetch(`/finance/grants/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete');
      toast.success('Grant deleted.');
      await loadGrants();
    } catch {
      toast.error('Failed to delete grant.');
    }
  };

  return (
    <div className="finance-container">
      <div className="page-header">
        <div>
          <h1 className="page-title text-gradient">Finance & FCRA</h1>
          <p className="page-subtitle">Fund accounting, automated compliance, and Tally Prime sync.</p>
        </div>
        <div className="flex gap-4">
          <button className="btn btn-secondary" onClick={handleTallyXMLExport}>
            <Download size={16} /> Tally XML Export
          </button>
          <button className="btn btn-secondary" onClick={handleGenerateUC}>
            <FileText size={16} /> Generate UC (CSR-1)
          </button>
          <button className="btn btn-primary" onClick={() => setShowEntryModal(true)}>
            <Plus size={16} /> New Journal Entry
          </button>
        </div>
      </div>

      {/* Tally Sync Banner */}
      <div className="tally-sync-banner">
        <div className="tally-info">
          <div className="tally-logo">T</div>
          <div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.25rem' }}>Tally Prime Sync Active</h3>
            <div className="sync-status">
              <div className="sync-dot"></div>
              {syncing ? 'Syncing...' : 'Last synced: 12 mins ago • 24 vouchers exported'}
            </div>
          </div>
        </div>
        <button className="btn btn-secondary" style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)' }} onClick={handleTallySync} disabled={syncing}>
          <RefreshCw size={16} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} /> {syncing ? 'Syncing...' : 'Force Sync'}
        </button>
      </div>

      {/* Bank Auto-Ingestion (Account Aggregator) */}
      <div className="card" style={{ marginBottom: '2rem', border: '1px solid #e2e8f0', background: 'linear-gradient(to right, #f8fafc, #ffffff)' }}>
        <div style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="flex items-center gap-4">
            <div style={{ width: '40px', height: '40px', background: '#3b82f6', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
              <Globe size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Bank Auto-Ingestion (AA Framework)</h3>
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>Autonomous reconciliation active for HDFC, Axis, and SBI FCRA accounts.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div style={{ textAlign: 'right', marginRight: '1rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-success)' }}>● LIVE SYNC</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>12 transactions auto-reconciled today</div>
            </div>
            <button className="btn btn-secondary" onClick={() => toast('Re-authenticating AA consent...')}>
              Manage Consents
            </button>
          </div>
        </div>
      </div>

      {/* Fund Balances */}
      <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Fund Balances</h2>
      <div className="finance-grid">
        <div className="finance-card">
          <div className="fund-label"><span>General Fund (Unrestricted)</span></div>
          <div className="fund-amount">₹12,45,000</div>
          <div className="fund-meta">
            <span className="flex items-center gap-1" style={{ color: 'var(--color-success)' }}><ArrowUpRight size={14} /> +4.2%</span>
            <span>HDFC Bank ••••4521</span>
          </div>
        </div>
        <div className="finance-card">
          <div className="fund-label"><span>CSR Fund (Restricted)</span></div>
          <div className="fund-amount">₹45,80,000</div>
          <div className="fund-meta">
            <span className="flex items-center gap-1" style={{ color: 'var(--color-success)' }}><ArrowUpRight size={14} /> +12.5%</span>
            <span>Axis Bank ••••8912</span>
          </div>
        </div>
        <div className="finance-card fcra-card">
          <div className="fcra-card-header">
            <div className="fund-label" style={{ color: '#4f46e5' }}><span>Foreign Contribution (FCRA) Fund</span></div>
            <span className="fcra-badge">SBI Main Branch, ND</span>
          </div>
          <div className="fcra-card-body">
            <div>
              <div className="fund-amount" style={{ color: '#312e81' }}>₹82,50,000</div>
              <div className="fund-meta mt-1" style={{ color: '#6366f1' }}>SBI Account ••••0001 (Mandatory)</div>
            </div>
            <div className="fcra-limit-box">
              <div className="flex justify-between items-center" style={{ fontSize: '0.75rem', marginBottom: '0.25rem', color: '#475569' }}>
                <span className="flex items-center gap-1">
                  {isFcraWarning && <AlertCircle size={12} color="var(--color-danger)" />}
                  Admin Overhead (20% cap)
                </span>
                <span style={{ fontWeight: 600, color: isFcraWarning ? 'var(--color-danger)' : 'inherit' }}>{Math.round(fcraAdminPercent)}%</span>
              </div>
              <div className="fcra-limit-bar">
                <div className={`fcra-limit-fill ${isFcraWarning ? 'danger' : ''}`} style={{ width: `${Math.min(fcraAdminPercent, 100)}%` }}></div>
              </div>
              <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.25rem', textAlign: 'right' }}>
                ₹{fcraAdminSpent.toLocaleString()} / ₹{fcraAdminLimit.toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Grant Utilization */}
      <div className="card">
        <div className="card-header flex justify-between items-center">
          <h3 className="card-title">Grant Budget & Utilization</h3>
          <div className="flex gap-2">
            <button className="btn btn-primary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={openCreateGrant}>
              <Plus size={14} /> Add Grant
            </button>
            <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={loadGrants} disabled={grantsLoading}>
              <RefreshCw size={14} /> {grantsLoading ? 'Loading…' : 'Refresh'}
            </button>
            <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={handleExportReport}>
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>
        <div className="table-scroll-wrap">
          <div className="table-scroll">
            <table className="budget-table">
              <thead>
                <tr><th>Grant Name / ID</th><th>Total Budget</th><th>Utilization</th><th>Variance</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                {grants.map(grant => {
                  const progress = (grant.spent / grant.total) * 100;
                  return (
                    <tr key={grant.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{grant.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>{grant.id}</div>
                      </td>
                      <td style={{ fontWeight: 600 }}>₹{grant.total.toLocaleString()}</td>
                      <td>
                        <div className="progress-inline">
                          <div className="progress-track">
                            <div className="progress-val" style={{ width: `${progress}%`, background: progress > 90 ? 'var(--color-warning)' : 'var(--color-primary)' }}></div>
                          </div>
                          <span style={{ fontSize: '0.75rem', width: '35px' }}>{Math.round(progress)}%</span>
                        </div>
                      </td>
                      <td>
                        <span className={grant.variance > 0 ? 'variance-positive' : grant.variance < 0 ? 'variance-negative' : ''}>
                          {grant.variance === 0 ? '-' : grant.variance > 0 ? `+₹${grant.variance.toLocaleString()}` : `-₹${Math.abs(grant.variance).toLocaleString()}`}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${grant.status === 'On Track' ? 'badge-success' : ''}`}
                          style={grant.status === 'Over Budget' ? { borderColor: 'var(--color-danger)', color: 'var(--color-danger)', border: '1px solid' } : {}}>
                          {grant.status}
                        </span>
                      </td>
                      <td>
                        <div className="flex gap-2">
                          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                            onClick={() => toast(`Generating P&L report for ${grant.name}...`, { icon: '📊' })}>
                            View P&L
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                            onClick={() => openEditGrant(grant)}>
                            Edit
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                            onClick={() => deleteGrant(grant.id)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showEntryModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ width: '440px', padding: '1.5rem', position: 'relative' }}>
            <button onClick={() => setShowEntryModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem' }} className="action-btn"><X size={20} /></button>
            <h2 style={{ marginBottom: '1.5rem' }}>New Journal Entry</h2>
            <form onSubmit={handleJournalEntry} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Description</label>
                <div style={{ position: 'relative' }}>
                  <input required type="text" className="input-field" placeholder="e.g. Staff salary disbursement" 
                    value={entry.description} 
                    onChange={async (e) => {
                      const val = e.target.value;
                      setEntry({ ...entry, description: val });
                      if (val.length > 5 && entry.fund === 'FCRA') {
                        setIsClassifying(true);
                        try {
                          const res = await apiFetch(`/workflows/classify-transaction?description=${encodeURIComponent(val)}`, { method: 'POST' });
                          if (res.ok) {
                            const data = await res.json();
                            setClassification(data);
                          }
                        } catch (err) {} finally { setIsClassifying(false); }
                      }
                    }} 
                  />
                  {entry.fund === 'FCRA' && (classification || isClassifying) && (
                    <div style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--color-bg-card)', padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid var(--color-border)', fontSize: '0.7rem', zIndex: 5 }}>
                      {isClassifying ? 'Classifying...' : (
                        <>
                          <Bot size={12} color="var(--color-primary)" />
                          <span style={{ fontWeight: 600 }}>{classification?.category}</span>
                          <span style={{ color: (classification?.confidence || 0) > 0.8 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                            {Math.round((classification?.confidence || 0) * 100)}%
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Amount (₹)</label>
                  <input required type="number" className="input-field" min="1" value={entry.amount} onChange={e => setEntry({ ...entry, amount: Number(e.target.value) })} />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Type</label>
                  <select className="input-field" value={entry.type} onChange={e => setEntry({ ...entry, type: e.target.value })}>
                    <option>Expense</option>
                    <option>Income</option>
                    <option>Transfer</option>
                  </select>
                </div>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Fund Classification</label>
                <select className="input-field" value={entry.fund} onChange={e => setEntry({ ...entry, fund: e.target.value })}>
                  <option>General</option>
                  <option>FCRA</option>
                  <option>CSR</option>
                  <option>Restricted Grant</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>Record Entry</button>
            </form>
          </div>
        </div>
      )}

      {showGrantModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ width: '440px', padding: '1.5rem', position: 'relative' }}>
            <button onClick={() => setShowGrantModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem' }} className="action-btn"><X size={20} /></button>
            <h2 style={{ marginBottom: '1.25rem' }}>{editingGrantId ? 'Edit Grant' : 'Add Grant'}</h2>
            <form onSubmit={saveGrant} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Grant name</label>
                <input required className="input-field" value={grantForm.name} onChange={(e) => setGrantForm({ ...grantForm, name: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Total budget (₹)</label>
                  <input type="number" className="input-field" min={0} value={grantForm.total} onChange={(e) => setGrantForm({ ...grantForm, total: Number(e.target.value) })} />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Spent (₹)</label>
                  <input type="number" className="input-field" min={0} value={grantForm.spent} onChange={(e) => setGrantForm({ ...grantForm, spent: Number(e.target.value) })} />
                </div>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Status</label>
                <select className="input-field" value={grantForm.status} onChange={(e) => setGrantForm({ ...grantForm, status: e.target.value })}>
                  <option value="On Track">On Track</option>
                  <option value="Over Budget">Over Budget</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary">
                {editingGrantId ? 'Save changes' : 'Create grant'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Finance;
