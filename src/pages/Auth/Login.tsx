import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Eye, EyeOff, Cpu } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth, ROLE_META, type UserRole } from '../../context/AuthContext';
import './Auth.css';

const roles = [
  { id: 'ed',       label: 'Executive Director', icon: '👤', desc: 'Full access to all modules' },
  { id: 'finance',  label: 'Finance Officer',    icon: '💼', desc: 'Finance, FCRA & Compliance' },
  { id: 'programs', label: 'Program Manager',    icon: '📋', desc: 'MIS, Volunteers & CSR' },
  { id: 'field',    label: 'Field Staff',         icon: '🗺️', desc: 'Programs & WhatsApp only' },
  { id: 'board',    label: 'Board Member',        icon: '🏛️', desc: 'Dashboard & reports only' },
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
  const [step, setStep] = useState<'login' | 'role'>('login');
  const [form, setForm] = useState({ email: '', password: '' });
  const [pendingUser, setPendingUser] = useState<typeof demoAccounts[0] | null>(null);
  const [selectedRole, setSelectedRole] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.password) { toast.error('Please enter email and password'); return; }
    setLoading(true);
    await new Promise(r => setTimeout(r, 900));
    setLoading(false);
    // Match demo accounts
    const match = demoAccounts.find(a => a.email === form.email && a.password === form.password);
    if (match) {
      setPendingUser(match);
      setStep('role');
    } else {
      // Any email/password combo works in demo mode
      setPendingUser({ email: form.email, password: form.password, role: 'ed', name: form.email.split('@')[0], org: 'Demo NGO' });
      setStep('role');
    }
  };

  const handleRoleSelect = (roleId: string) => {
    setSelectedRole(roleId);
    const role = roles.find(r => r.id === roleId);
    const user = pendingUser!;
    const meta = ROLE_META[roleId as UserRole];

    // Store in AuthContext (persisted to localStorage)
    login({
      id: `user_${roleId}`,
      email: user.email,
      name: user.name || user.email.split('@')[0],
      role: roleId as UserRole,
      ngoId: 'ngo_001',
      ngoName: user.org || 'India NGO Trust',
      token: `demo-jwt-${roleId}-${Date.now()}`,
      avatar: meta.icon,
    });

    toast.success(`Welcome! Signed in as ${role?.label}`, { icon: meta.icon, duration: 3000 });
    setTimeout(() => navigate('/'), 300);
  };

  const fillDemo = (account: typeof demoAccounts[0]) => {
    setForm({ email: account.email, password: account.password });
    toast(`Demo credentials filled for ${account.name}`, { icon: '💡', duration: 2000 });
  };

  return (
    <div className="auth-container">
      <div className="auth-left">
        <div className="auth-brand">
          <div className="auth-logo">GJ</div>
          <div>
            <h1 className="auth-brand-name">GoodJobs</h1>
            <p className="auth-brand-tagline">SevaSuite — India's Nonprofit OS</p>
          </div>
        </div>
        <div className="auth-hero">
          <div className="hero-stat"><span className="hero-num">3.3M+</span><span className="hero-desc">NGOs in India</span></div>
          <div className="hero-stat"><span className="hero-num">₹0</span><span className="hero-desc">Admin spend with AI</span></div>
          <div className="hero-stat"><span className="hero-num">8</span><span className="hero-desc">Autonomous Agents</span></div>
        </div>
        <div className="auth-feature-list">
          {['FCRA-compliant fund accounting', 'WhatsApp-first field data entry', 'AI agent for every workflow', '80G receipts auto-generated', 'DPDP Act 2023 compliant'].map(f => (
            <div key={f} className="auth-feature-item"><ShieldCheck size={16} color="#10b981" /> {f}</div>
          ))}
        </div>
        <div className="auth-agent-badge"><Cpu size={16} color="#8b5cf6" /><span>Powered by SevaSuite Copilot</span></div>
      </div>

      <div className="auth-right">
        {/* Mobile Header (visible only on < 768px) */}
        <div className="auth-mobile-header">
          <div className="auth-logo">SS</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.25rem', color: 'var(--color-primary)' }}>SevaSuite</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>India's Nonprofit OS</div>
          </div>
        </div>

        {step === 'login' ? (
          <div className="auth-card">
            <div className="auth-card-header">
              <h2>Sign In</h2>
              <p>Access your NGO's operating system</p>
            </div>

            <div className="demo-accounts">
              <div className="demo-label">Quick demo access:</div>
              <div className="demo-btns">
                {demoAccounts.map(acc => {
                  const meta = ROLE_META[acc.role as UserRole];
                  return (
                    <button key={acc.email} className="demo-btn" onClick={() => fillDemo(acc)}
                      title={`${acc.name} — ${meta.label}`}>
                      {meta.icon} {acc.role === 'ed' ? 'ED' : acc.role === 'finance' ? 'Finance' : acc.role === 'programs' ? 'Programs' : acc.role === 'field' ? 'Field' : 'Board'}
                    </button>
                  );
                })}
              </div>
            </div>

            <form onSubmit={handleLogin} className="auth-form">
              <div className="input-group" style={{ marginBottom: '1rem' }}>
                <label className="input-label">Work Email</label>
                <input type="email" className="input-field" placeholder="you@yourngo.org"
                  value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: '1.5rem' }}>
                <label className="input-label">Password</label>
                <div style={{ position: 'relative' }}>
                  <input type={showPassword ? 'text' : 'password'} className="input-field"
                    placeholder="••••••••" value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    style={{ paddingRight: '3rem' }} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)' }}>
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
                {loading ? <span className="auth-spinner" /> : 'Sign In →'}
              </button>
            </form>

            <div className="auth-divider"><span>New NGO?</span></div>
            <button className="btn btn-secondary" style={{ width: '100%' }}
              onClick={() => toast('NGO registration flow coming soon!', { icon: '📝' })}>
              Register your NGO for free
            </button>
            <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
              By signing in, you agree to our Terms of Service and Privacy Policy.<br />
              <strong>Data hosted in India (AWS ap-south-1) • DPDP Act 2023 compliant</strong>
            </div>
          </div>
        ) : (
          <div className="auth-card">
            <div className="auth-card-header">
              <h2>Select Your Role</h2>
              <p>Choose the role that matches your position in {pendingUser?.org || 'your organisation'}</p>
            </div>
            <div className="role-grid">
              {roles.map(role => {
                const meta = ROLE_META[role.id as UserRole];
                return (
                  <button key={role.id} className={`role-card ${selectedRole === role.id ? 'selected' : ''}`}
                    onClick={() => handleRoleSelect(role.id)}>
                    <span className="role-icon">{role.icon}</span>
                    <div>
                      <div className="role-label">{role.label}</div>
                      <div className="role-desc">{role.desc}</div>
                    </div>
                    {/* Permission hint */}
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
