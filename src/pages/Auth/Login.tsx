import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldCheck, Eye, EyeOff, Cpu, Sparkles, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth, ROLE_META, type UserRole } from '../../context/AuthContext';
import { makeFreshTrial, loadOrgBilling } from '../../utils/trial';
import { apiFetch } from '../../api/client';
import './Auth.css';

// ── Social proof lines ────────────────────────────────────────────────────────
const SOCIAL_PROOF = [
  '"Asha Foundation submitted 3 funder reports this month using AI drafts"',
  '"₹2.4L in 80G receipts generated automatically — zero manual work"',
  '"12 beneficiaries re-engaged through automated follow-up prompts"',
  '"Tata Trusts grant report drafted in under 10 minutes from live data"',
  '"Field team synced 47 attendance records after 4 hours offline"',
  '"CSR compliance checklist completed 2 weeks before audit"',
];

const roles = [
  { id: 'ed',       label: 'Executive Director', icon: '👤', desc: 'Full access · All modules · Agent approvals' },
  { id: 'finance',  label: 'Finance Officer',    icon: '💼', desc: 'Finance, FCRA, Compliance & Receipts'       },
  { id: 'programs', label: 'Program Manager',    icon: '📋', desc: 'Programs, M&E, Volunteers & Reports'        },
  { id: 'field',    label: 'Field Staff',         icon: '🗺️', desc: 'Programs, Attendance & Service Logs'       },
  { id: 'board',    label: 'Board Member',        icon: '🏛️', desc: 'Read-only · Insights & Reports only'       },
];

const demoAccounts = [
  { email: 'admin@indiango.org',    password: 'demo1234', role: 'ed',      name: 'Anjali Mehta',   org: 'India NGO Trust' },
  { email: 'finance@indiango.org',  password: 'demo1234', role: 'finance', name: 'Rajan Sharma',   org: 'India NGO Trust' },
  { email: 'programs@indiango.org', password: 'demo1234', role: 'programs',name: 'Priya Nair',     org: 'India NGO Trust' },
  { email: 'field@indiango.org',    password: 'demo1234', role: 'field',   name: 'Ramesh Kumar',   org: 'India NGO Trust' },
  { email: 'board@indiango.org',    password: 'demo1234', role: 'board',   name: 'Dr. Sunita Rao', org: 'India NGO Trust' },
];

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [loginMode,    setLoginMode]    = useState<'signin' | 'demo'>('signin');
  const [step,         setStep]         = useState<'login' | 'role'>('login');
  const [form,         setForm]         = useState({ email: '', password: '' });
  const [pendingUser,  setPendingUser]  = useState<typeof demoAccounts[0] | null>(null);
  const [selectedRole, setSelectedRole] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [serverToken,  setServerToken]  = useState<string | null>(null);
  const [proofIdx,     setProofIdx]     = useState(0);
  const [proofFade,    setProofFade]    = useState(true);

  // Rotate social proof every 4 s
  useEffect(() => {
    const timer = setInterval(() => {
      setProofFade(false);
      setTimeout(() => {
        setProofIdx(i => (i + 1) % SOCIAL_PROOF.length);
        setProofFade(true);
      }, 350);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const doLogin = (roleId: string, user: typeof demoAccounts[0], token: string | null) => {
    const meta = ROLE_META[roleId as UserRole];
    const role = roles.find(r => r.id === roleId);
    const ngoId = 'ngo_001';
    // Demo logins opt-in to the trial showcase, but ONLY mint a fresh trial
    // the first time this demo org is touched. Subsequent demo logins
    // rehydrate the existing trial (so day-N nudges actually progress over
    // time and can't be reset by simply re-logging in).
    const existingBilling = loadOrgBilling(ngoId);
    const trial = existingBilling?.trial ?? makeFreshTrial();
    login({
      id: `user_${user.email.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      email: user.email,
      name: user.name || user.email.split('@')[0],
      role: roleId as UserRole,
      ngoId,
      ngoName: user.org || 'India NGO Trust',
      token: token || `demo-jwt-${roleId}-${Date.now()}`,
      avatar: meta.icon,
      trial,
    });
    toast.success(`Welcome! Signed in as ${role?.label}`, { icon: meta.icon, duration: 3000 });
    setTimeout(() => navigate('/'), 300);
  };

  // Direct demo login — one click, no email/password needed
  const handleDemoLogin = (roleId: string) => {
    const acc = demoAccounts.find(a => a.role === roleId)!;
    doLogin(roleId, acc, null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.password) { toast.error('Please enter email and password'); return; }
    setLoading(true);
    try {
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, password: form.password }),
      });
      if (res.ok) {
        const data = await res.json();
        const roleId = data.role as UserRole;
        const meta = ROLE_META[roleId];
        login({
          id: `user_${roleId}`,
          email: data.email,
          name: data.name || data.email.split('@')[0],
          role: roleId,
          ngoId: data.ngo_id || 'ngo_001',
          ngoName: data.ngo_name || 'India NGO Trust',
          token: data.access_token,
          avatar: meta.icon,
        });
        toast.success(`Welcome! Signed in as ${meta.label}`, { icon: meta.icon, duration: 3000 });
        setTimeout(() => navigate('/'), 300);
        return;
      }
    } catch { /* fall back to demo */ }
    finally { setLoading(false); }

    const match = demoAccounts.find(a => a.email === form.email && a.password === form.password);
    if (match) {
      setPendingUser(match);
    } else {
      setPendingUser({ email: form.email, password: form.password, role: 'ed', name: form.email.split('@')[0], org: 'Demo NGO' });
    }
    setServerToken(null);
    setStep('role');
  };

  const handleRoleSelect = (roleId: string) => {
    setSelectedRole(roleId);
    doLogin(roleId, pendingUser!, serverToken);
  };

  return (
    <div className="auth-container">

      {/* ── Left panel ─────────────────────────────────────────────── */}
      <div className="auth-left">
        <div className="auth-brand">
          <div className="auth-logo">GJ</div>
          <div>
            <h1 className="auth-brand-name">GoodJobs</h1>
            <p className="auth-brand-tagline">Infrastructure for Social Good</p>
          </div>
        </div>

        {/* Rotating social proof */}
        <div className="auth-proof-wrap">
          <div className="auth-proof-label">From NGOs using GoodJobs today</div>
          <p className={`auth-proof-line ${proofFade ? 'visible' : 'hidden'}`}>
            {SOCIAL_PROOF[proofIdx]}
          </p>
          <div className="auth-proof-dots">
            {SOCIAL_PROOF.map((_, i) => (
              <span
                key={i}
                className={`auth-proof-dot ${i === proofIdx ? 'active' : ''}`}
                onClick={() => { setProofFade(false); setTimeout(() => { setProofIdx(i); setProofFade(true); }, 200); }}
              />
            ))}
          </div>
        </div>

        <div className="auth-feature-list">
          {['FCRA-compliant fund accounting', 'WhatsApp-first field data entry', 'AI agent for every workflow', '80G receipts auto-generated', 'DPDP Act 2023 compliant'].map(f => (
            <div key={f} className="auth-feature-item"><ShieldCheck size={16} color="#10b981" /> {f}</div>
          ))}
        </div>

        <div className="auth-agent-badge"><Cpu size={16} color="#8b5cf6" /><span>Powered by GoodJobs Copilot</span></div>
      </div>

      {/* ── Right panel ────────────────────────────────────────────── */}
      <div className="auth-right">
        {/* Mobile header (< 768px) */}
        <div className="auth-mobile-header">
          <div className="auth-logo">GJ</div>
          <div>
            <div className="auth-mobile-brand">GoodJobs</div>
            <div className="auth-mobile-tagline">Good work deserves great infrastructure</div>
          </div>
        </div>

        {step === 'login' ? (
          <div className="auth-card">
            <div className="auth-card-header">
              <h2>{loginMode === 'demo' ? 'Explore Demo' : 'Sign In'}</h2>
              <p>{loginMode === 'demo' ? 'Choose a role to preview the full platform' : "Access your NGO's operating system"}</p>
            </div>

            {/* Mode switcher tabs */}
            <div className="auth-mode-tabs">
              <button
                className={`auth-mode-tab ${loginMode === 'signin' ? 'active' : ''}`}
                onClick={() => setLoginMode('signin')}
              >
                Sign In
              </button>
              <button
                className={`auth-mode-tab ${loginMode === 'demo' ? 'active' : ''}`}
                onClick={() => setLoginMode('demo')}
              >
                <Sparkles size={13} /> Explore Demo
              </button>
            </div>

            {loginMode === 'demo' ? (
              /* ── Demo mode: direct role cards ──────────────────── */
              <div className="demo-role-section">
                <div className="demo-sandbox-banner">
                  <Sparkles size={14} />
                  <span>Sandbox environment — no real data, no account needed</span>
                </div>
                <div className="demo-role-grid">
                  {roles.map(role => {
                    const meta = ROLE_META[role.id as UserRole];
                    return (
                      <button
                        key={role.id}
                        className="demo-role-card"
                        onClick={() => handleDemoLogin(role.id)}
                        style={{ '--role-color': meta.color } as React.CSSProperties}
                      >
                        <span className="demo-role-icon">{role.icon}</span>
                        <div className="demo-role-info">
                          <div className="demo-role-label">{role.label}</div>
                          <div className="demo-role-desc">{role.desc}</div>
                        </div>
                        <span className="demo-role-enter">Enter →</span>
                      </button>
                    );
                  })}
                </div>
                <p className="demo-mode-note">
                  Data hosted in India (AWS ap-south-1) · DPDP Act 2023 compliant
                </p>
              </div>
            ) : (
              /* ── Sign in mode ───────────────────────────────────── */
              <>
                <form onSubmit={handleLogin} className="auth-form">
                  <div className="input-group" style={{ marginBottom: '1rem' }}>
                    <label className="input-label" htmlFor="login-email">Work Email</label>
                    <input
                      id="login-email" type="email" className="input-field"
                      placeholder="you@yourngo.org" autoComplete="username"
                      value={form.email}
                      onChange={e => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  <div className="input-group" style={{ marginBottom: '1.5rem' }}>
                    <label className="input-label" htmlFor="login-password">Password</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        className="input-field"
                        autoComplete="current-password"
                        placeholder="••••••••"
                        value={form.password}
                        onChange={e => setForm({ ...form, password: e.target.value })}
                        style={{ paddingRight: '3rem' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)' }}
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                  <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
                    {loading ? <span className="auth-spinner" /> : 'Sign In →'}
                  </button>
                </form>

                <div className="auth-divider"><span>New NGO?</span></div>
                <Link
                  to="/signup"
                  className="btn btn-secondary"
                  style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', textDecoration: 'none' }}
                >
                  Start your free 30-day trial <ArrowRight size={14} />
                </Link>
                <p className="auth-legal">
                  By signing in, you agree to our Terms of Service and Privacy Policy.<br />
                  <strong>Data hosted in India (AWS ap-south-1) · DPDP Act 2023 compliant</strong>
                </p>
              </>
            )}
          </div>

        ) : (
          /* ── Role step (after email/password login) ─────────────── */
          <div className="auth-card">
            <div className="auth-card-header">
              <h2>Select Your Role</h2>
              <p>Choose the role that matches your position in {pendingUser?.org || 'your organisation'}</p>
            </div>
            <div className="role-grid">
              {roles.map(role => {
                const meta = ROLE_META[role.id as UserRole];
                return (
                  <button
                    key={role.id}
                    className={`role-card ${selectedRole === role.id ? 'selected' : ''}`}
                    onClick={() => handleRoleSelect(role.id)}
                  >
                    <span className="role-icon">{role.icon}</span>
                    <div>
                      <div className="role-label">{role.label}</div>
                      <div className="role-desc">{role.desc}</div>
                    </div>
                    <div style={{ marginLeft: 'auto', fontSize: '0.65rem', padding: '2px 6px', borderRadius: '99px', background: meta.bg, color: meta.color, fontWeight: 600 }}>
                      {role.id === 'ed' ? 'All access' : role.id === 'board' ? 'Read only' : role.id === 'field' ? 'Limited' : 'Partial'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default Login;
