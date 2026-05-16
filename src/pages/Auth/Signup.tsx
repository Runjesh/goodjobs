import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ShieldCheck, Sparkles, Mail, ArrowRight, Building2, Users,
  Phone, CheckCircle2, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth, ROLE_META } from '../../context/AuthContext';
import { apiFetch, expectsRealBackend } from '../../api/client';
import { makeFreshTrial } from '../../utils/trial';
import { clearWizardState } from '../../utils/wizard';
import { GoogleSignInButton } from '../../components/Auth/GoogleSignInButton';
import { decodeGoogleCredentialPayload, getGoogleClientId } from '../../lib/googleIdentity';
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
  password: string;
  phone: string;
  causeArea: string;
  teamSize: string;
}

const EMPTY_FORM: SignupForm = {
  ngoName: '', fullName: '', email: '', password: '', phone: '',
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
  const [googleCredential, setGoogleCredential] = useState<string | null>(null);
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

  // ── Google Sign-In: pre-fills form; full account is created on verify ─────────
  const isFormValid =
    form.ngoName.trim() &&
    form.fullName.trim() &&
    /\S+@\S+\.\S+/.test(form.email) &&
    (googleCredential || form.password.length >= 8) &&
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

  const handleVerify = async () => {
    setVerifyBusy(true);
    const email = form.email.trim().toLowerCase();
    const ngoSlug = form.ngoName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 48) || 'org';

    const finishSignup = (userId: string, ngoId: string, token: string, ngoName: string) => {
      clearWizardState(userId);
      login({
        id: userId,
        email,
        name: form.fullName.trim(),
        role: 'ed',
        ngoId,
        ngoName,
        token,
        avatar: ROLE_META.ed.icon,
        needsWizard: true,
        trial: makeFreshTrial(),
        orgProfile: {
          causeArea: form.causeArea,
          teamSize: form.teamSize,
          phone: form.phone,
        },
      });
      if (form.causeArea) {
        void apiFetch('/settings/ngo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cause_area: form.causeArea }),
        });
      }
      setStage('verified');
    };

    try {
      if (googleCredential) {
        const res = await apiFetch('/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          noMockFallback: expectsRealBackend(),
          body: JSON.stringify({
            credential: googleCredential,
            mode: 'signup',
            ngo_name: form.ngoName.trim(),
            ngo_slug: ngoSlug,
            full_name: form.fullName.trim(),
          }),
        });
        if (res.ok) {
          const data = await res.json() as {
            access_token?: string;
            user_id?: string;
            ngo_id?: string;
            ngo_name?: string;
          };
          if (data.access_token && data.user_id && data.ngo_id) {
            finishSignup(
              data.user_id,
              data.ngo_id,
              data.access_token,
              data.ngo_name ?? form.ngoName.trim(),
            );
            setVerifyBusy(false);
            setTimeout(() => navigate('/onboarding', { replace: true }), 800);
            return;
          }
        }
        const errBody = await res.json().catch(() => ({})) as { detail?: string };
        toast.error(
          typeof errBody.detail === 'string'
            ? errBody.detail
            : 'Could not create your account with Google. Try email or sign in.',
        );
        setVerifyBusy(false);
        return;
      }

      const res = await apiFetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        noMockFallback: expectsRealBackend(),
        body: JSON.stringify({
          ngo_name: form.ngoName.trim(),
          ngo_slug: ngoSlug,
          email,
          password: form.password,
          full_name: form.fullName.trim(),
          role: 'ed',
        }),
      });
      if (res.ok) {
        const data = await res.json() as {
          access_token?: string;
          user_id?: string;
          ngo_id?: string;
          ngo_name?: string;
          name?: string;
          role?: string;
        };
        if (data.access_token && data.user_id && data.ngo_id) {
          finishSignup(
            data.user_id,
            data.ngo_id,
            data.access_token,
            data.ngo_name ?? form.ngoName.trim(),
          );
          setVerifyBusy(false);
          setTimeout(() => navigate('/onboarding', { replace: true }), 800);
          return;
        }
      }
      const errBody = await res.json().catch(() => ({})) as { detail?: string };
      toast.error(
        typeof errBody.detail === 'string'
          ? errBody.detail
          : 'Could not create your account. Try a different email or sign in.',
      );
    } catch {
      toast.error('Could not reach the server. Check your connection and try again.');
    }

    setVerifyBusy(false);
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

              {getGoogleClientId() ? (
                <>
                  <GoogleSignInButton
                    className="signup-google-slot"
                    onCredential={(resp) => {
                      if (!resp.credential) return;
                      setGoogleCredential(resp.credential);
                      const p = decodeGoogleCredentialPayload(resp.credential);
                      if (p?.email || p?.name) {
                        setForm((f) => ({
                          ...f,
                          email: p.email ?? f.email,
                          fullName: p.name ?? f.fullName,
                        }));
                      }
                      toast.success('Google account linked — add your NGO details below.', { icon: '🔐' });
                    }}
                  />
                  {googleCredential && (
                    <p className="signup-google-hint">
                      Using Google for this account — password not required.{' '}
                      <button
                        type="button"
                        className="signup-google-clear"
                        onClick={() => { setGoogleCredential(null); }}
                      >
                        Clear
                      </button>
                    </p>
                  )}
                  <div className="auth-divider"><span>or use email</span></div>
                </>
              ) : null}

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

                <div className="input-group">
                  <label className="input-label" htmlFor="su-password">
                    Password *{googleCredential ? ' (optional with Google)' : ''}
                  </label>
                  <input
                    id="su-password"
                    type="password"
                    className="input-field"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder={googleCredential ? 'Not needed when using Google' : 'At least 8 characters'}
                    required={!googleCredential}
                    minLength={googleCredential ? 0 : 8}
                    autoComplete="new-password"
                  />
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
              <button className="signup-verify-back" onClick={() => { setGoogleCredential(null); setStage('form'); }}>
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
