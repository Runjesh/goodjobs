import React, { useState } from 'react';
import { ShieldCheck, Upload, Calendar, Users, X, CheckCircle2, AlertTriangle, Download, Plus, Shield } from 'lucide-react';
import { useStore } from '../../store/useStore';
import toast from 'react-hot-toast';
import DPDPModule from './DPDPModule';
import './Compliance.css';

const PAGE_TABS = [
  { id: 'vault',  label: '📁 Registration Vault' },
  { id: 'dpdp',   label: '🛡️ DPDP Act 2023' },
];

const filings = [
  { id: 1, name: 'TDS Return (Q3)', due: 'Nov 30, 2026', assignee: 'CA Mehta', status: 'Due Soon' },
  { id: 2, name: 'IT Form 10B', due: 'Dec 15, 2026', assignee: 'CA Mehta', status: 'Pending' },
  { id: 3, name: 'FCRA Annual Return', due: 'Dec 31, 2026', assignee: 'CFO', status: 'Pending' },
  { id: 4, name: 'Darpan NGO Renewal', due: 'Mar 31, 2027', assignee: 'Admin', status: 'Pending' },
];

const boardMembers = [
  { id: 1, name: 'Dr. Arun Sharma', role: 'Chairperson', din: 'DIN00****12', tenure: 'Since 2019' },
  { id: 2, name: 'Ms. Kavita Patel', role: 'Treasurer', din: 'DIN00****34', tenure: 'Since 2021' },
  { id: 3, name: 'Mr. Suresh Iyer', role: 'Secretary', din: 'DIN00****56', tenure: 'Since 2020' },
];

const Compliance: React.FC = () => {
  const { complianceDocs, addComplianceDoc } = useStore();
  const [pageTab, setPageTab] = useState('vault');
  const [showDocModal, setShowDocModal] = useState(false);
  const [docForm, setDocForm] = useState({ name: '', type: 'Tax Exemption', status: 'Valid' as 'Valid' | 'Expiring Soon' | 'Expired', expiry: '' });

  const handleAddDoc = (e: React.FormEvent) => {
    e.preventDefault();
    addComplianceDoc({
      name: docForm.name,
      type: docForm.type,
      status: docForm.status,
      expiry: docForm.expiry,
    });
    toast.success(`${docForm.name} added to Document Vault!`);
    setDocForm({ name: '', type: 'Tax Exemption', status: 'Valid', expiry: '' });
    setShowDocModal(false);
  };

  const handleDownload = (name: string) => {
    toast.success(`Downloading ${name}...`, { icon: '📄' });
  };

  const handleFilingAction = (filing: typeof filings[0]) => {
    toast(`Preparing data package for "${filing.name}"...`, { icon: '📋' });
  };

  const validDocs = complianceDocs.filter(d => d.status === 'Valid').length;
  const expiringSoon = complianceDocs.filter(d => d.status === 'Expiring Soon').length;

  return (
    <div className="compliance-container">
      <div className="page-header">
        <div>
          <h1 className="page-title text-gradient">Compliance HQ</h1>
          <p className="page-subtitle">Statutory registrations, filings, board governance & DPDP Act 2023 compliance.</p>
        </div>
        <div className="flex gap-4">
          <button className="btn btn-secondary" onClick={() => toast('Generating Compliance Health Report PDF...', { icon: '📊' })}>
            <Download size={16} /> Health Report
          </button>
          {pageTab === 'vault' && (
            <button className="btn btn-primary" onClick={() => setShowDocModal(true)}>
              <Upload size={16} /> Upload Document
            </button>
          )}
        </div>
      </div>

      {/* Page-level Tab Switcher */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '2px solid var(--color-border-light)' }}>
        {PAGE_TABS.map(t => (
          <button key={t.id} onClick={() => setPageTab(t.id)}
            style={{ padding: '0.6rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer',
              borderBottom: pageTab === t.id ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: pageTab === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)', marginBottom: '-2px', transition: 'color 0.2s' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* DPDP Module */}
      {pageTab === 'dpdp' && <DPDPModule />}

      {/* Registration Vault content — only shown on vault tab */}
      {pageTab === 'vault' && <>

      {/* Health Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem', marginBottom: '2rem' }}>
        <div className="card" style={{ borderTop: '3px solid var(--color-success)', textAlign: 'center', padding: '1.5rem' }}>
          <CheckCircle2 size={28} color="var(--color-success)" style={{ margin: '0 auto 0.5rem' }} />
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{validDocs}</div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>Documents Valid</div>
        </div>
        <div className="card" style={{ borderTop: '3px solid var(--color-warning)', textAlign: 'center', padding: '1.5rem' }}>
          <AlertTriangle size={28} color="var(--color-warning)" style={{ margin: '0 auto 0.5rem' }} />
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{expiringSoon}</div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>Expiring Soon</div>
        </div>
        <div className="card" style={{ borderTop: '3px solid var(--color-primary)', textAlign: 'center', padding: '1.5rem' }}>
          <Calendar size={28} color="var(--color-primary)" style={{ margin: '0 auto 0.5rem' }} />
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{filings.length}</div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>Upcoming Filings</div>
        </div>
      </div>

      {/* Document Vault */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header flex justify-between items-center">
          <h3 className="card-title">📁 Registration Vault ({complianceDocs.length} documents)</h3>
          <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }} onClick={() => setShowDocModal(true)}>
            <Plus size={14} /> Add
          </button>
        </div>
        <div className="table-scroll-wrap">
          <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--color-bg-main)' }}>
                  {['Document', 'Type', 'Status', 'Expiry', 'Action'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '0.75rem 1rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border-light)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {complianceDocs.map(doc => (
                  <tr key={doc.id} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                    <td style={{ padding: '1rem', fontWeight: 500 }}>{doc.name}</td>
                    <td style={{ padding: '1rem', color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>{doc.type}</td>
                    <td style={{ padding: '1rem' }}>
                      <span className={`badge ${doc.status === 'Valid' ? 'badge-success' : doc.status === 'Expiring Soon' ? '' : ''}`}
                        style={doc.status === 'Expiring Soon' ? { background: '#fef3c7', color: '#92400e' } : doc.status === 'Expired' ? { background: '#fee2e2', color: '#991b1b' } : {}}>
                        {doc.status}
                      </span>
                    </td>
                    <td style={{ padding: '1rem', fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>{doc.expiry}</td>
                    <td style={{ padding: '1rem' }}>
                      <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => handleDownload(doc.name)}>
                        <Download size={14} /> Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Filing Calendar + Board */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <div className="card">
          <div className="card-header">
            <h3 className="card-title flex items-center gap-2"><Calendar size={18} /> Upcoming Filings</h3>
          </div>
          <div className="card-body">
            {filings.map(f => (
              <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 0', borderBottom: '1px solid var(--color-border-light)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{f.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>Due: {f.due} • {f.assignee}</div>
                </div>
                <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => handleFilingAction(f)}>
                  Prepare
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title flex items-center gap-2"><Users size={18} /> Board of Trustees</h3>
          </div>
          <div className="card-body">
            {boardMembers.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.875rem 0', borderBottom: '1px solid var(--color-border-light)' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--color-primary-light)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>
                  {m.name.charAt(0)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{m.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>{m.role} • {m.din} • {m.tenure}</div>
                </div>
                <ShieldCheck size={16} color="var(--color-success)" />
              </div>
            ))}
            <button className="btn btn-secondary" style={{ marginTop: '1rem', width: '100%', fontSize: '0.875rem' }} onClick={() => toast('Board member management panel coming soon!', { icon: '👥' })}>
              <Plus size={14} /> Add Board Member
            </button>
          </div>
        </div>
      </div>

      {showDocModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ width: '460px', padding: '1.5rem', position: 'relative' }}>
            <button onClick={() => setShowDocModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem' }} className="action-btn"><X size={20} /></button>
            <h2 style={{ marginBottom: '1.5rem' }}>Upload Compliance Document</h2>
            <form onSubmit={handleAddDoc} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Document Name</label>
                <input required type="text" className="input-field" placeholder="e.g. 80G Renewal Certificate" value={docForm.name} onChange={e => setDocForm({ ...docForm, name: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Document Type</label>
                <select className="input-field" value={docForm.type} onChange={e => setDocForm({ ...docForm, type: e.target.value })}>
                  {['Tax Exemption', 'Donor Deduction', 'Foreign Contribution', 'CSR Eligibility', 'Other'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Expiry Date</label>
                <input required type="date" className="input-field" value={docForm.expiry} onChange={e => setDocForm({ ...docForm, expiry: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Status</label>
                <select className="input-field" value={docForm.status} onChange={e => setDocForm({ ...docForm, status: e.target.value as any })}>
                  <option>Valid</option>
                  <option>Expiring Soon</option>
                  <option>Expired</option>
                </select>
              </div>
              <div style={{ border: '2px dashed var(--color-border)', borderRadius: 'var(--radius-md)', padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
                <Upload size={20} style={{ margin: '0 auto 0.5rem' }} />
                Click to select PDF file (simulated)
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Add to Vault</button>
            </form>
          </div>
        </div>
      )}
      </>}
    </div>
  );
};

export default Compliance;
