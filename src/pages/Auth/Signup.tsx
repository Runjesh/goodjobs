import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ShieldCheck, Sparkles, Mail, ArrowRight, Building2, Users,
  Phone, CheckCircle2, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth, ROLE_META } from '../../context/AuthContext';
import { makeFreshTrial } from '../../utils/trial';
import { clearWizardState } from '../../utils/wizard';
import './Auth.css';
import './Signup.css';

const CAUSE_AREAS = [
  'Education', 'Health & Nutrition', 'Livelihoods', 'Women & Child Welfare',
  'Environment', 'Disability & Inclusion', 'Disaster Relief', 'Animal Welfare',
  'Arts & Culture', 'Other',
];

const TEAM_SIZES = ['Just me', '2–5 people', '6–15 people', '16–50 people', '50+ people'];

type Stage = 'form' | 'verify' | 'verified';

interface SignupForm {
  ngoName: string;
  fullName: string;
  email: string;
  phone: string;
  causeArea: string;
  teamSize: string;
}

const EMPTY_FORM: SignupForm = {
  ngoName: '', fullName: '', email: '', phone: '',
  causeArea: '', teamSize: '',
};

const Signup: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [stage, setStage] = useState<Stage>('form');
  const [form, setForm] = useState<SignupForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleResend = () => {
    if (resendCooldown > 0) return;
    toast.success('Verification email resent!', { icon: '📧' });
    setResendCooldown(60);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((c) => {
        if (c <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  // ── Mock OAuth: pre-fills the form, doesn't bypass verification ─────────
  const handleGoogleOAuth = () => {
    setForm({
      ngoName: 'Asha Foundation',
      fullName: 'Anjali Mehta',
      email: 'anjali@ashafoundation.org',
      phone: '+91 98200 12345',
      causeArea: 'Education',
      teamSize: '6–15 people',
    });
    toast.success('Pulled details from Google account', { icon: '🔐' });
  };

  const isFormValid =
    form.ngoName.trim() &&
    form.fullName.trim() &&
    /\S+@\S+\.\S+/.test(form.email) &&
    form.causeArea &&
    form.teamSize;

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) {
      toast.error('Please fill in all required fields');
      return;
    }
    setSubmitting(true);
    // Simulate sending the verification email — UX-only delay.
    setTimeout(() => {
      setSubmitting(false);
      setStage('verify');
    }, 700);
  };

  const handleVerify = () => {
    setVerifyBusy(true);
    setTimeout(() => {
      // Build a brand new tenant + ED user and log them in with needsWizard=true.
      const slug = form.email.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const ngoSlug = form.ngoName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const userId = `user_${slug}_${Date.now().toString(36)}`;
      const ngoId = `ngo_${ngoSlug}_${Date.now().toString(36)}`;
      // Reset any stale wizard state (defensive — should never exist for a brand-new id).
      clearWizardState(userId);

      login({
        id: userId,
        email: form.email,
        name: form.fullName,
        role: 'ed',
        ngoId,
        ngoName: form.ngoName,
        token: `signup-jwt-${Date.now()}`,
        avatar: ROLE_META.ed.icon,
        needsWizard: true,
        trial: makeFreshTrial(),
        orgProfile: {
          causeArea: form.causeArea,
          teamSize: form.teamSize,
          phone: form.phone,
        },
      });
      setVerifyBusy(false);
      setStage('verified');
      // Brief celebratory beat, then into the wizard.
      setTimeout(() => navigate('/onboarding'), 800);
    }, 600);
  };

  return (
    <div className="auth-container signup-container">
      {/* ── Left brand panel (reuses Login styles) ──────────────── */}
      <div className="auth-left">
        <div className="auth-brand">
          <div className="auth-logo">GJ</div>
          <div>
            <h1 className="auth-brand-name">GoodJobs</h1>
            <p className="auth-brand-tagline">Infrastructure for Social Good</p>
          </div>
        </div>

        <div className="signup-trial-card">
          <div className="signup-trial-pill">
            <Sparkles size={13} /> 30-day free trial
          </div>
          <h2 className="signup-trial-title">Run your nonprofit on one calm dashboard.</h2>
          <p className="signup-trial-body">
            Programs, funding, compliance, donors, reports — all working together.
            Set up in about 5 minutes. No credit card needed.
          </p>
          <ul className="signup-trial-bullets">
            <li><CheckCircle2 size={14} /> AI Copilot drafts reports & 80G receipts</li>
            <li><CheckCircle2 size={14} /> WhatsApp data entry for field staff</li>
            <li><CheckCircle2 size={14} /> FCRA-ready fund accounting</li>
            <li><CheckCircle2 size={14} /> Data hosted in India (DPDP-compliant)</li>
          </ul>
        </div>

        <div className="auth-agent-badge">
          <ShieldCheck size={14} color="#5eead4" /> 1,200+ Indian NGOs trust GoodJobs
        </div>
      </div>

      {/* ── Right form panel ─────────────────────────────────────── */}
      <div className="auth-right">
        <div className="auth-mobile-header">
          <div className="auth-logo">GJ</div>
          <div>
            <div className="auth-mobile-brand">GoodJobs</div>
            <div className="auth-mobile-tagline">30-day free trial · No credit card</div>
          </div>
        </div>

        <div className="auth-card signup-card">
          {stage === 'form' && (
            <>
              <div className="auth-card-header">
                <h2>Start your free trial</h2>
                <p>Tell us about your NGO. You'll be running in 5 minutes.</p>
              </div>

              <button type="button" className="signup-google-btn" onClick={handleGoogleOAuth}>
                <span className="signup-google-icon">G</span>
                Continue with Google
              </button>

              <div className="auth-divider"><span>or use email</span></div>

              <form onSubmit={handleSubmitForm} className="signup-form">
                <div className="signup-row">
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label" htmlFor="su-ngo">NGO name *</label>
                    <input id="su-ngo" className="input-field" value={form.ngoName}
                      onChange={(e) => setForm({ ...form, ngoName: e.target.value })}
                      placeholder="e.g. Asha Foundation" required autoComplete="organization" />
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label" htmlFor="su-name">Your name *</label>
                    <input id="su-name" className="input-field" value={form.fullName}
                      onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                      placeholder="Anjali Mehta" required autoComplete="name" />
                  </div>
                </div>

                <div className="signup-row">
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label" htmlFor="su-email">Work email *</label>
                    <input id="su-email" type="email" className="input-field" value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="you@yourngo.org" required autoComplete="email" />
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label" htmlFor="su-phone">Phone</label>
                    <input id="su-phone" className="input-field" value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder="+91 ..." autoComplete="tel" />
                  </div>
                </div>

                <div className="signup-row">
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label" htmlFor="su-cause">Primary cause area *</label>
                    <select id="su-cause" className="input-field" value={form.causeArea}
                      onChange={(e) => setForm({ ...form, causeArea: e.target.value })} required>
                      <option value="">Choose one…</option>
                      {CAUSE_AREAS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label" htmlFor="su-team">Team size *</label>
                    <select id="su-team" className="input-field" value={form.teamSize}
                      onChange={(e) => setForm({ ...form, teamSize: e.target.value })} required>
                      <option value="">Choose one…</option>
                      {TEAM_SIZES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>

                <button type="submit" className="btn btn-primary auth-submit"
                  disabled={!isFormValid || submitting}>
                  {submitting ? <span className="auth-spinner" /> : <>Create my account <ArrowRight size={16} /></>}
                </button>

                <p className="auth-legal">
                  By creating an account you agree to our Terms of Service and Privacy Policy.<br />
                  <strong>30-day trial · No credit card · Cancel anytime</strong>
                </p>
              </form>

              <div className="signup-footer-link">
                Already have an account? <Link to="/login">Sign in</Link>
              </div>
            </>
          )}

          {stage === 'verify' && (
            <div className="signup-verify">
              <div className="signup-verify-icon"><Mail size={28} /></div>
              <h2>Check your email</h2>
              <p>
                We've sent a verification link to <strong>{form.email}</strong>.
                Click the link to confirm your account and continue setup.
              </p>
              <p className="signup-verify-hint">
                <Sparkles size={12} /> Demo: no actual email is sent. Click below to simulate
                clicking the link.
              </p>
              <button className="btn btn-primary auth-submit" onClick={handleVerify} disabled={verifyBusy}>
                {verifyBusy ? <span className="auth-spinner" /> : <>I clicked the link — verify <ArrowRight size={16} /></>}
              </button>
              <p className="signup-verify-resend">
                Didn't get it?{' '}
                <button
                  type="button"
                  className="signup-verify-resend-btn"
                  onClick={handleResend}
                  disabled={resendCooldown > 0}
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend verification email'}
                </button>
              </p>
              <button className="signup-verify-back" onClick={() => setStage('form')}>
                ← Back to edit details
              </button>
            </div>
          )}

          {stage === 'verified' && (
            <div className="signup-verify signup-verify--done">
              <div className="signup-verify-icon signup-verify-icon--ok">
                <CheckCircle2 size={32} />
              </div>
              <h2>Email verified!</h2>
              <p>Setting up your workspace…</p>
              <div className="signup-verify-spinner"><Loader2 size={22} className="signup-spin" /></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Signup;
