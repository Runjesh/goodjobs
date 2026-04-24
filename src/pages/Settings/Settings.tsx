import React, { useState } from 'react';
import { User, Building2, Shield, Bell, Trash2, Download, Key, Save, ChevronRight } from 'lucide-react';
import { useAuth, ROLE_META } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import './Settings.css';
import { apiFetch } from '../../api/client';

const TABS = [
  { id: 'profile',  label: 'Profile',      icon: <User size={16} /> },
  { id: 'ngo',      label: 'NGO Details',  icon: <Building2 size={16} /> },
  { id: 'security', label: 'Security',     icon: <Key size={16} /> },
  { id: 'privacy',  label: 'Privacy & DPDP', icon: <Shield size={16} /> },
  { id: 'notifs',   label: 'Notifications',icon: <Bell size={16} /> },
];

const Settings: React.FC = () => {
  const { user, login } = useAuth();
  const [activeTab, setActiveTab] = useState('profile');
  const [name, setName] = useState(user?.name || '');
  const [ngoName, setNgoName] = useState(user?.ngoName || 'India NGO Trust');
  const [regNo, setRegNo] = useState('MH/2015/0012345');
  const [fcraReg, setFcraReg] = useState('231650212');
  const [panNo, setPanNo] = useState('AABCI1234C');
  const [notifs, setNotifs] = useState({ agentApprovals: true, complianceDue: true, donorLapse: true, dailyBrief: false, weeklyReport: true });
  const [consentGiven, setConsentGiven] = useState(true);

  const meta = user ? ROLE_META[user.role] : null;

  const handleSaveProfile = () => {
    if (user) {
      login({ ...user, name, ngoName });
      toast.success('Profile updated!', { icon: '✅' });
    }
  };

  const handleExportData = () => {
    const data = JSON.stringify({ user, ngoName, regNo, fcraReg, panNo }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'sevasuite_data_export.json'; a.click();
    toast.success('Your data exported (DPDP §12 right to portability).', { icon: '📦', duration: 4000 });
  };

  return (
    <div className="settings-container">
      <div className="page-header">
        <div>
          <h1 className="page-title text-gradient">Settings</h1>
          <p className="page-subtitle">Manage your profile, NGO details, and privacy preferences.</p>
        </div>
      </div>

      <div className="settings-layout">
        {/* Mobile Tab Selector */}
        <div className="settings-mobile-nav">
          <label className="input-label" style={{ marginBottom: '0.25rem' }}>Settings Section</label>
          <select 
            className="input-field" 
            value={activeTab} 
            onChange={(e) => setActiveTab(e.target.value)}
          >
            {TABS.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Sidebar tabs (Desktop) */}
        <div className="settings-nav">
          {TABS.map(t => (
            <button key={t.id} className={`settings-nav-item ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}>
              {t.icon} <span>{t.label}</span> <ChevronRight size={14} style={{ marginLeft: 'auto', opacity: 0.4 }} />
            </button>
          ))}
        </div>

        {/* Panel */}
        <div className="settings-panel">

          {/* Profile */}
          {activeTab === 'profile' && (
            <div>
              <h3 className="settings-section-title">Your Profile</h3>
              {user && meta && (
                <div className="settings-user-hero">
                  <div style={{ width: 56, height: 56, borderRadius: '50%', background: `linear-gradient(135deg, ${meta.color}, ${meta.color}99)`, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 700 }}>
                    {user.name.charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1.125rem' }}>{user.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                      <span style={{ fontSize: '0.75rem', padding: '2px 10px', borderRadius: '99px', background: meta.bg, color: meta.color, fontWeight: 600 }}>
                        {meta.icon} {meta.label}
                      </span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{user.email}</span>
                    </div>
                  </div>
                </div>
              )}
              <div className="settings-form">
                <div className="input-group"><label className="input-label">Full Name</label>
                  <input className="input-field" value={name} onChange={e => setName(e.target.value)} /></div>
                <div className="input-group"><label className="input-label">Email</label>
                  <input className="input-field" value={user?.email || ''} disabled style={{ opacity: 0.6 }} /></div>
                <div className="input-group"><label className="input-label">Role</label>
                  <input className="input-field" value={meta?.label || ''} disabled style={{ opacity: 0.6 }} /></div>
                <button className="btn btn-primary" onClick={handleSaveProfile}><Save size={16} /> Save Changes</button>
              </div>
            </div>
          )}

          {/* NGO Details */}
          {activeTab === 'ngo' && (
            <div>
              <h3 className="settings-section-title">NGO Details</h3>
              <div className="settings-form">
                <div className="input-group"><label className="input-label">Organisation Name</label>
                  <input className="input-field" value={ngoName} onChange={e => setNgoName(e.target.value)} /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="input-group"><label className="input-label">Registration No.</label>
                    <input className="input-field" value={regNo} onChange={e => setRegNo(e.target.value)} /></div>
                  <div className="input-group"><label className="input-label">FCRA Reg. No.</label>
                    <input className="input-field" value={fcraReg} onChange={e => setFcraReg(e.target.value)} /></div>
                </div>
                <div className="input-group"><label className="input-label">PAN / TAN</label>
                  <input className="input-field" value={panNo} onChange={e => setPanNo(e.target.value)} /></div>
                <div className="input-group"><label className="input-label">State of Registration</label>
                  <select className="input-field"><option>Maharashtra</option><option>Delhi</option><option>Karnataka</option><option>Tamil Nadu</option></select></div>
                <button className="btn btn-primary" onClick={() => toast.success('NGO details saved!')}><Save size={16} /> Save NGO Details</button>
              </div>
            </div>
          )}

          {/* Security */}
          {activeTab === 'security' && (
            <div>
              <h3 className="settings-section-title">Security</h3>
              <div className="settings-form">
                <div className="settings-info-box">
                  🔐 You are signed in using a <strong>JWT session token</strong>. Token expires in 24 hours.
                </div>
                <div className="input-group"><label className="input-label">Current Password</label>
                  <input type="password" className="input-field" placeholder="••••••••" /></div>
                <div className="input-group"><label className="input-label">New Password</label>
                  <input type="password" className="input-field" placeholder="Min. 8 characters" /></div>
                <div className="input-group"><label className="input-label">Confirm Password</label>
                  <input type="password" className="input-field" placeholder="••••••••" /></div>
                <button className="btn btn-primary" onClick={() => toast.success('Password updated!')}><Key size={16} /> Change Password</button>
                <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#fff7ed', borderRadius: 'var(--radius-md)', border: '1px solid #fed7aa' }}>
                  <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: '#c2410c' }}>Active Sessions</div>
                  <div style={{ fontSize: '0.8rem', color: '#9a3412' }}>MacBook Pro • Mumbai, India • Active now</div>
                  <button className="btn btn-secondary" style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                    onClick={() => toast('All other sessions terminated.', { icon: '🔒' })}>Revoke All Other Sessions</button>
                </div>
              </div>
            </div>
          )}

          {/* Privacy & DPDP */}
          {activeTab === 'privacy' && (
            <div>
              <h3 className="settings-section-title">Privacy & Data Rights (DPDP Act 2023)</h3>
              <div style={{ padding: '0.875rem 1rem', background: '#eff6ff', borderRadius: 'var(--radius-md)', border: '1px solid #bfdbfe', fontSize: '0.8rem', color: '#1e40af', marginBottom: '1.5rem' }}>
                🏛️ Under the <strong>Digital Personal Data Protection Act 2023</strong>, you have rights to access, correct, and erase your personal data.
              </div>
              <div className="settings-form">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Data Processing Consent</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>Consent to process your data for NGO operations (required)</div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={consentGiven} onChange={e => { setConsentGiven(e.target.checked); toast(e.target.checked ? 'Consent granted.' : 'Consent withdrawn — some features may stop working.', { icon: '📋' }); }} />
                    <span style={{ fontSize: '0.8rem' }}>{consentGiven ? 'Granted' : 'Withdrawn'}</span>
                  </label>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button className="btn btn-secondary" style={{ flex: 1 }} onClick={handleExportData}><Download size={14} /> Export My Data (§12)</button>
                  <button className="btn btn-secondary" style={{ flex: 1, color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                    onClick={async () => {
                      if (!user) return;
                      try {
                        const res = await apiFetch('/compliance/erasure', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            name: user.name,
                            email: user.email,
                            reason: 'User requested account erasure from Settings.',
                          }),
                        });
                        const data = await res.json().catch(() => ({}));
                        if (res.ok) {
                          toast(
                            data.message || 'Erasure request logged. Must be completed within 30 days.',
                            { icon: '🗑️', duration: 6000 }
                          );
                        } else {
                          toast.error('Failed to submit erasure request.');
                        }
                      } catch {
                        toast.error('Failed to submit erasure request (backend not reachable).');
                      }
                    }}>
                    <Trash2 size={14} /> Request Erasure (§13)
                  </button>
                </div>
                <div style={{ padding: '1rem', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-md)', fontSize: '0.8rem' }}>
                  <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Data Fiduciary Information</div>
                  <div style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                    <strong>{ngoName}</strong> is the Data Fiduciary under DPDP Act 2023.<br />
                    Data Grievance Officer: <strong>compliance@{ngoName.toLowerCase().replace(/\s/g, '')}.org</strong><br />
                    Data stored in: <strong>India (AWS ap-south-1, Mumbai)</strong>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Notifications */}
          {activeTab === 'notifs' && (
            <div>
              <h3 className="settings-section-title">Notification Preferences</h3>
              <div className="settings-form">
                {[
                  { key: 'agentApprovals', label: 'Agent HITL approvals', desc: 'When an agent needs your approval' },
                  { key: 'complianceDue',  label: 'Compliance deadlines', desc: '7-day and 1-day reminders for filings' },
                  { key: 'donorLapse',     label: 'Donor lapse alerts',   desc: 'Donors silent for 90+ days' },
                  { key: 'dailyBrief',     label: 'Daily board brief',    desc: 'Morning AI summary at 6:30 AM IST' },
                  { key: 'weeklyReport',   label: 'Weekly impact digest', desc: 'Every Monday, 8 AM IST' },
                ].map(n => (
                  <div key={n.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 0', borderBottom: '1px solid var(--color-border-light)' }}>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{n.label}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{n.desc}</div>
                    </div>
                    <input type="checkbox" checked={notifs[n.key as keyof typeof notifs]}
                      onChange={e => { setNotifs(prev => ({ ...prev, [n.key]: e.target.checked })); toast(`${n.label} ${e.target.checked ? 'enabled' : 'disabled'}.`, { duration: 1500 }); }} />
                  </div>
                ))}
                <button className="btn btn-primary" onClick={() => toast.success('Notification preferences saved!')}><Save size={16} /> Save Preferences</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
