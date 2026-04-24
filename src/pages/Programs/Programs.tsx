import React, { useState } from 'react';
import { Users, Smartphone, MapPin, CheckCircle2, UserCheck, ShieldCheck, Activity, Target, Download, X, ClipboardList, MessageCircle, Send, Bot, Loader2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import toast from 'react-hot-toast';
import FormBuilder from '../../components/FormBuilder/FormBuilder';
import TheoryOfChangeBuilder from '../../components/Programs/TheoryOfChangeBuilder';
import '../../components/FormBuilder/FormBuilder.css';
import './Programs.css';
import { apiFetch } from '../../api/client';

const programs = ['Women Livelihood Center', 'Digital Literacy 2026', 'Healthcare Camp', 'STEM for Girls'];

const fieldVisits = [
  { id: 1, title: 'Session: Sewing Skills', date: 'Today, 10:30 AM', agent: 'Priya M.', location: 'Nashik Center (Geo-tagged)' },
  { id: 2, title: 'Household Survey', date: 'Yesterday, 2:15 PM', agent: 'Ramesh K.', location: 'Village Block A (Geo-tagged)' },
  { id: 3, title: 'Health Checkup Camp', date: 'Oct 15, 09:00 AM', agent: 'Dr. Sharma', location: 'Pune Main (Geo-tagged)' },
];

const Programs: React.FC = () => {
  const { beneficiaries, addBeneficiary } = useStore();
  const [showModal, setShowModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'mis' | 'forms' | 'toc'>('mis');
  const [form, setForm] = useState({ name: '', program: programs[0], location: '', aadhaar: false, familySize: 1 });
  const [showConversationalModal, setShowConversationalModal] = useState(false);
  const [conversationalInput, setConversationalInput] = useState('');
  const [isParsing, setIsParsing] = useState(false);

  const handleEnroll = (e: React.FormEvent) => {
    e.preventDefault();
    addBeneficiary({
      name: form.name,
      program: form.program,
      location: form.location,
      aadhaar: form.aadhaar,
      familySize: Number(form.familySize),
    });
    toast.success(`${form.name} enrolled in ${form.program}!`);
    setForm({ name: '', program: programs[0], location: '', aadhaar: false, familySize: 1 });
    setShowModal(false);
  };

  const handleExport = () => {
    const csv = ['ID,Name,Program,Location,Aadhaar,Family Size',
      ...beneficiaries.map(b => `${b.id},${b.name},${b.program},${b.location},${b.aadhaar},${b.familySize}`)
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'beneficiaries.csv'; a.click();
    toast.success('Beneficiary data exported to CSV!');
  };

  const aadhaarVerifiedPct = Math.round((beneficiaries.filter(b => b.aadhaar).length / Math.max(beneficiaries.length, 1)) * 100);

  return (
    <div className="programs-container">
      <div className="page-header">
        <div>
          <h1 className="page-title text-gradient">Programs MIS</h1>
          <p className="page-subtitle">Track beneficiaries, measure outcomes, and monitor field operations.</p>
        </div>
        <div className="flex gap-4">
          <button className="btn btn-secondary" style={{ border: '1px solid #16a34a', color: '#16a34a' }} onClick={() => setShowConversationalModal(true)}>
            <MessageCircle size={16} /> Conversational MIS
          </button>
          <button className="btn btn-secondary" onClick={handleExport}>
            <Download size={16} /> Export Data
          </button>
          <button className="btn btn-secondary" onClick={() => setActiveTab('forms')}>
            <ClipboardList size={16} /> Form Builder
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <UserCheck size={16} /> Enroll Beneficiary
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2" style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border-light)', paddingBottom: 0 }}>
        {[
          { id: 'mis', label: '📊 MIS Dashboard' }, 
          { id: 'forms', label: '📋 Form Builder' },
          { id: 'toc', label: '🎯 Theory of Change' }
        ].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id as any)}
            style={{ padding: '0.625rem 1.25rem', fontWeight: 600, fontSize: '0.875rem', background: 'none', border: 'none', borderBottom: activeTab === t.id ? '2px solid var(--color-primary)' : '2px solid transparent', color: activeTab === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)', cursor: 'pointer', marginBottom: '-1px' }}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'forms' && <FormBuilder />}
      {activeTab === 'toc' && <TheoryOfChangeBuilder />}

      {activeTab === 'mis' && (<>
        <div className="flex items-center gap-3">
          <Smartphone size={24} />
          <div>
            <div style={{ fontWeight: 600 }}>Offline Mobile App Sync</div>
            <div style={{ fontSize: '0.875rem', opacity: 0.9 }}>14 field agents online. Last sync: 5 mins ago.</div>
          </div>
        </div>
        <div className="badge" style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}>
          <CheckCircle2 size={14} style={{ marginRight: '4px' }} /> All Systems Operational
        </div>

      <div className="programs-stats-row">
        <div className="mis-card">
          <div className="mis-card-header"><div className="mis-card-title"><Users size={16} color="var(--color-primary)" /> Total Beneficiaries</div></div>
          <div className="mis-card-value">{(beneficiaries.length + 12446).toLocaleString()}</div>
        </div>
        <div className="mis-card">
          <div className="mis-card-header"><div className="mis-card-title"><ShieldCheck size={16} color="var(--color-success)" /> Aadhaar Verified</div></div>
          <div className="mis-card-value">{aadhaarVerifiedPct}%</div>
        </div>
        <div className="mis-card">
          <div className="mis-card-header"><div className="mis-card-title"><Activity size={16} color="var(--color-warning)" /> Active Programs</div></div>
          <div className="mis-card-value">{programs.length}</div>
        </div>
        <div className="mis-card">
          <div className="mis-card-header"><div className="mis-card-title"><MapPin size={16} color="var(--color-danger)" /> Field Visits (Month)</div></div>
          <div className="mis-card-value">342</div>
        </div>
      </div>

      <div className="programs-grid">
        <div className="flex-col gap-6 flex">
          <div className="card">
            <div className="card-header flex justify-between items-center">
              <h3 className="card-title">Recent Enrollments ({beneficiaries.length})</h3>
              <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setShowModal(true)}>+ Enroll</button>
            </div>
            <div className="card-body">
              <div className="beneficiary-list">
                {beneficiaries.slice(0, 6).map(ben => (
                  <div key={ben.id} className="beneficiary-item">
                    <div className="ben-avatar">{ben.name.charAt(0)}</div>
                    <div className="ben-info">
                      <div className="ben-name">
                        {ben.name}
                        {ben.aadhaar && <CheckCircle2 size={14} className="aadhaar-verified" />}
                      </div>
                      <div className="ben-meta">{ben.program} • {ben.location} • Family of {ben.familySize}</div>
                    </div>
                    <div><span className="badge badge-outline" style={{ fontSize: '0.7rem' }}>{ben.id}</span></div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title flex items-center gap-2"><Target size={18} color="var(--color-primary)" />Impact (SDG Alignment)</h3>
            </div>
            <div className="card-body">
              <div className="sdg-tags">
                <div className="sdg-tag sdg-1">1: No Poverty</div>
                <div className="sdg-tag sdg-3">3: Good Health</div>
                <div className="sdg-tag sdg-4">4: Quality Education</div>
                <div className="sdg-tag sdg-5">5: Gender Equality</div>
              </div>
              <div style={{ marginTop: '1.5rem', background: 'var(--color-bg-main)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>KEY OUTCOME</div>
                <div style={{ fontWeight: 500 }}>85% of women in the Livelihood Center reported 2x income increase within 6 months.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3 className="card-title">Geo-Tagged Field Activity</h3></div>
          <div className="card-body">
            <div style={{ height: '180px', background: 'linear-gradient(135deg, #e2e8f0, #f1f5f9)', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '0.875rem', border: '1px dashed var(--color-border)' }}>
              🗺️ Interactive Map (Google Maps / Leaflet)
            </div>
            <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem' }}>Recent Check-ins</h4>
            <div className="field-visit-list">
              {fieldVisits.map(visit => (
                <div key={visit.id} className="field-visit-item">
                  <div className="fv-header">
                    <div className="fv-title">{visit.title}</div>
                    <div className="fv-date">{visit.date}</div>
                  </div>
                  <div className="fv-meta">
                    <span className="flex items-center gap-1"><Users size={12} /> {visit.agent}</span>
                    <span className="flex items-center gap-1"><MapPin size={12} /> {visit.location}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {activeTab === 'mis' && showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ width: '460px', padding: '1.5rem', position: 'relative' }}>
            <button onClick={() => setShowModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem' }} className="action-btn"><X size={20} /></button>
            <h2 style={{ marginBottom: '1.5rem' }}>Enroll Beneficiary</h2>
            <form onSubmit={handleEnroll} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Full Name</label>
                <input required type="text" className="input-field" placeholder="e.g. Meena Devi" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Program</label>
                <select className="input-field" value={form.program} onChange={e => setForm({ ...form, program: e.target.value })}>
                  {programs.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Location (District, State)</label>
                <input required type="text" className="input-field" placeholder="e.g. Nashik, MH" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Family Size</label>
                <input type="number" className="input-field" min="1" max="20" value={form.familySize} onChange={e => setForm({ ...form, familySize: Number(e.target.value) })} />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="aadhaar" checked={form.aadhaar} onChange={e => setForm({ ...form, aadhaar: e.target.checked })} />
                <label htmlFor="aadhaar" style={{ fontSize: '0.875rem' }}>Aadhaar Verified</label>
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>Enroll Beneficiary</button>
            </form>
          </div>
        </div>
      )}
      </>)}

      {/* Conversational MIS Modal */}
      {showConversationalModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ width: '500px', padding: '1.5rem', position: 'relative' }}>
            <button onClick={() => setShowConversationalModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem' }} className="action-btn"><X size={20} /></button>
            <div className="flex items-center gap-2 mb-4">
              <MessageCircle size={22} color="#16a34a" />
              <h2 style={{ fontSize: '1.25rem' }}>Conversational MIS (WhatsApp)</h2>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
              Field staff can send activity narratives. The MIS Agent extracts structured data and geo-tags automatically.
            </p>
            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#0369a1', marginBottom: '0.5rem' }}>EXAMPLE NARRATIVE</div>
              <div style={{ fontSize: '0.8125rem', fontStyle: 'italic', color: '#0c4a6e' }}>
                "Today visited Sunita Devi, village Rampur, attended nutrition session, weight 42kg up from 38kg last month."
              </div>
            </div>
            <div className="input-group">
              <label className="input-label">Type or paste field narrative</label>
              <textarea 
                className="input-field" 
                rows={4} 
                placeholder="e.g. Conducted sewing class for 12 women in Block B..."
                value={conversationalInput}
                onChange={(e) => setConversationalInput(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }} 
              disabled={!conversationalInput || isParsing}
              onClick={async () => {
                setIsParsing(true);
                try {
                  const res = await apiFetch('/webhook/field-report', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      report_text: conversationalInput,
                      reporter_id: 'field_staff_001',
                      program: form.program,
                      report_date: new Date().toISOString().slice(0, 10),
                    }),
                  });
                  if (res.ok) {
                    toast.success("Submitted to MIS Agent. Processing in background.", { icon: '🤖' });
                    setShowConversationalModal(false);
                    setConversationalInput('');
                  } else {
                    toast.error("Failed to submit to MIS Agent.");
                  }
                } catch {
                  toast.error("Failed to submit (backend not reachable).");
                } finally {
                  setIsParsing(false);
                }
              }}
            >
              {isParsing ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
              {isParsing ? 'Agent Parsing...' : 'Submit to MIS Agent'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Programs;
