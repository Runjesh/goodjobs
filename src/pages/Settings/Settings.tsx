import React, { useEffect, useState } from 'react';
import { User, Building2, Shield, Bell, Trash2, Download, Key, Save, ChevronRight, CreditCard, Users, Mail, X as XIcon, Lock, MessageCircle, Sparkles } from 'lucide-react';
import JSZip from 'jszip';
import WhatsAppPortal from '../../components/Settings/WhatsAppPortal';
import { useAuth, ROLE_META } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import './Settings.css';
import { apiFetch, type ApiFetchInit } from '../../api/client';
import { readApiError } from '../../utils/apiPersist';
import PlansSection from '../../components/Billing/PlansSection';
import ContextualUpgradePrompt from '../../components/Billing/ContextualUpgradePrompt';
import { useTier, useUpgradeListener } from '../../hooks/useTier';
import { canAddTeamMember, normalizeTier, tierLimits } from '../../utils/trial';
import { useStore } from '../../store/useStore';
import { isMockEnabled } from '../../api/mockBackend';

type LlmKeyStatus = {
  configured: boolean;
  masked: string | null;
  source: string;
  env_fallback_available: boolean;
};

/** Production builds always hit the real API for LLM key routes (mock must not fake a successful save). */
function withProdLlmNoMock(init: ApiFetchInit = {}): ApiFetchInit {
  if (!import.meta.env.PROD) return init;
  return { ...init, noMockFallback: true };
}

const TABS = [
  { id: 'profile',  label: 'Profile',      icon: <User size={16} /> },
  { id: 'team',     label: 'Team',         icon: <Users size={16} /> },
  { id: 'ngo',      label: 'NGO Details',  icon: <Building2 size={16} /> },
  { id: 'plans',    label: 'Plans & Billing', icon: <CreditCard size={16} /> },
  { id: 'whatsapp', label: 'WhatsApp Portal', icon: <MessageCircle size={16} /> },
  { id: 'security', label: 'Security',     icon: <Key size={16} /> },
  { id: 'ai',       label: 'AI & Agents',  icon: <Sparkles size={16} /> },
  { id: 'privacy',  label: 'Privacy & DPDP', icon: <Shield size={16} /> },
  { id: 'notifs',   label: 'Notifications',icon: <Bell size={16} /> },
];

const Settings: React.FC = () => {
  const { user, login, updateUser } = useAuth();
  const setNgoDetails              = useStore(s => s.setNgoDetails);
  const updatePendingTeamMember    = useStore(s => s.updatePendingTeamMember);
  const removePendingTeamMember    = useStore(s => s.removePendingTeamMember);
  const pendingTeamMembers         = useStore(s => s.pendingTeamMembers);
  // Data slices for full-org export
  const exportDonors               = useStore(s => s.donors);
  const exportTransactions         = useStore(s => s.transactions);
  const exportBeneficiaries        = useStore(s => s.beneficiaries);
  const exportGrants               = useStore(s => s.csrCards);
  const exportCompliance           = useStore(s => s.complianceDocs);
  const exportVolunteers           = useStore(s => s.volunteers);
  const exportMisIntents           = useStore(s => s.misReviewIntents);
  const exportOutcomes             = useStore(s => s.beneficiaryOutcomes);
  // Honor ?tab=plans (or any other tab) so contextual upgrade prompts can
  // deep-link. We accept "billing" as an alias for "plans" because the
  // expired-trial banner and the day-28 upgrade modal historically link to
  // /settings?tab=billing — without this alias the tab silently falls back
  // to Profile and the upgrade CTA becomes a dead end.
  const initialTab = (() => {
    if (typeof window === 'undefined') return 'profile';
    const raw = new URL(window.location.href).searchParams.get('tab');
    const t = raw === 'billing' ? 'plans' : raw;
    return t && TABS.some(x => x.id === t) ? t : 'profile';
  })();
  const [activeTab, setActiveTab] = useState(initialTab);

  // ── Upgrade-event listener (always mounted on /settings) ────────────────────
  // Any contextual prompt anywhere in the app fires gj:open-upgrade. We catch
  // it here regardless of which tab is active, then:
  //   (1) Stamp the requested target/cycle into the URL so PlansSection — which
  //       only mounts a moment later when activeTab flips — can read the deep
  //       link from its mount effect (the in-flight CustomEvent has already
  //       fired and PlansSection's own listener wouldn't be subscribed yet).
  //   (2) Switch the active tab to 'plans' so PlansSection actually mounts.
  // This guarantees "open from anywhere" works even when the user is already
  // on /settings but on a different tab.
  // Team-tab state — local invite UX backed by AuthUser.pendingInvites so the
  // wizard's invites and the Settings invites share one list. Real backend
  // wiring (POST /team/invite) is a follow-up.
  const { tier, usage, openUpgrade } = useTier();
  const teamLims = tierLimits(tier);
  const teamCap = teamLims.teamMembers; // null = unlimited
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('PROGRAM_HEAD');
  const [teamUpgradeOpen, setTeamUpgradeOpen] = useState(false);
  const [confirmRemoveEmail, setConfirmRemoveEmail] = useState<string | null>(null);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);

  const handleRemoveMember = async (email: string) => {
    setRemovingEmail(email);
    try {
      const res = await apiFetch('/team/member', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
        noMockFallback: true,
      });
      if (!res.ok) {
        let detail = 'Failed to remove member. Please try again.';
        try {
          const err = await res.json();
          if (err?.detail) detail = err.detail;
        } catch { /* ignore */ }
        toast.error(detail);
        return;
      }
      removePendingTeamMember(email);
      setConfirmRemoveEmail(null);
      toast(`${email} removed from the workspace.`, { icon: '✕' });
    } catch {
      toast.error('Could not reach the server. Please try again.');
    } finally {
      setRemovingEmail(null);
    }
  };

  const sendInvite = () => {
    const email = inviteEmail.trim();
    if (!email || !email.includes('@')) {
      toast.error('Enter a valid email address.');
      return;
    }
    // Block at the cap. canAddTeamMember treats null cap as unlimited.
    if (!canAddTeamMember(tier, usage.team)) {
      setTeamUpgradeOpen(true);
      return;
    }
    if (!user) return;
    const next = [
      ...(user.pendingInvites ?? []),
      { email, role: inviteRole, invitedAt: new Date().toISOString() },
    ];
    updateUser({ pendingInvites: next });
    setInviteEmail('');
    toast.success(`Invite sent to ${email}.`);
  };

  const revokeInvite = (email: string) => {
    if (!user) return;
    const next = (user.pendingInvites ?? []).filter(p => p.email !== email);
    updateUser({ pendingInvites: next });
    toast(`Invite to ${email} revoked.`, { icon: '✕' });
  };

  useUpgradeListener((detail) => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'plans');
      if (detail.targetTier) url.searchParams.set('plan', detail.targetTier);
      if (detail.cycle) url.searchParams.set('cycle', detail.cycle);
      if (detail.source) url.searchParams.set('src', detail.source);
      window.history.replaceState(null, '', url.toString());
    }
    setActiveTab('plans');
  });
  const storedNgoDetails = useStore(s => s.ngoDetails);
  const [name, setName] = useState(user?.name || '');
  const [ngoName, setNgoName] = useState(user?.ngoName || storedNgoDetails.name || 'India NGO Trust');
  const [regNo, setRegNo] = useState(storedNgoDetails.reg_no || 'MH/2015/0012345');
  const [fcraReg, setFcraReg] = useState(storedNgoDetails.fcra_reg || '231650212');
  const [panNo, setPanNo] = useState(storedNgoDetails.pan || 'AABCI1234C');
  // 80G certificate No. is now the Compliance Registry's responsibility.
  // We read it from complianceDocs (via useStore) for display only — never edited here.
  const complianceDocs = useStore(s => s.complianceDocs);
  const eightyGNo = complianceDocs.find(d => d.type === 'Donor Deduction' && d.registration_number)?.registration_number ?? storedNgoDetails.eighty_g_no ?? '';
  const [ngoState, setNgoState] = useState(storedNgoDetails.state || 'Maharashtra');
  const [notifs, setNotifs] = useState({ agentApprovals: true, complianceDue: true, donorLapse: true, dailyBrief: false, weeklyReport: true });
  const [consentGiven, setConsentGiven] = useState(true);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNext, setPwNext] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [exportScheduleEnabled, setExportScheduleEnabled] = useState(false);
  const [exportScheduleFreq, setExportScheduleFreq] = useState<'weekly' | 'monthly'>('weekly');
  const [savingSchedule, setSavingSchedule] = useState(false);

  const [llmStatus, setLlmStatus] = useState<LlmKeyStatus | null>(null);
  const [llmKeyInput, setLlmKeyInput] = useState('');
  const [llmSaving, setLlmSaving] = useState(false);

  const meta = user ? ROLE_META[user.role] : null;

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      setLoadingSettings(true);
      try {
        const res = await apiFetch('/settings');
        if (!res.ok) return;
        const data = await res.json();
        if (data?.profile?.full_name) setName(data.profile.full_name);
        if (data?.ngo?.name) setNgoName(data.ngo.name);
        if (typeof data?.ngo?.reg_no !== 'undefined') setRegNo(data.ngo.reg_no || '');
        if (typeof data?.ngo?.fcra_reg !== 'undefined') setFcraReg(data.ngo.fcra_reg || '');
        if (typeof data?.ngo?.pan !== 'undefined') setPanNo(data.ngo.pan || '');
        if (typeof data?.ngo?.state !== 'undefined') setNgoState(data.ngo.state || 'Maharashtra');
        // Hydrate the global ngoDetails slice so Finance and Compliance get
        // the same values without requiring the user to visit Settings first.
        if (data?.ngo) {
          setNgoDetails({
            name:     data.ngo.name     ?? undefined,
            reg_no:   data.ngo.reg_no   ?? undefined,
            fcra_reg: data.ngo.fcra_reg ?? undefined,
            pan:      data.ngo.pan      ?? undefined,
            state:    data.ngo.state    ?? undefined,
            // eighty_g_no intentionally omitted — sourced from Compliance Registry
          });
        }
        if (data?.notification_prefs && typeof data.notification_prefs === 'object') {
          setNotifs(prev => ({ ...prev, ...data.notification_prefs }));
        }
        if (data?.export_schedule && typeof data.export_schedule === 'object') {
          if (typeof data.export_schedule.enabled === 'boolean') setExportScheduleEnabled(data.export_schedule.enabled);
          if (data.export_schedule.frequency === 'weekly' || data.export_schedule.frequency === 'monthly') {
            setExportScheduleFreq(data.export_schedule.frequency);
          }
        }
      } finally {
        setLoadingSettings(false);
      }
    };
    load();
  }, [user]);

  useEffect(() => {
    if (activeTab !== 'ai' || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/settings/llm', withProdLlmNoMock());
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as LlmKeyStatus;
        if (!cancelled) setLlmStatus(data);
      } catch {
        /* offline or backend down */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, user]);

  const handleSaveExportSchedule = async () => {
    setSavingSchedule(true);
    try {
      const res = await apiFetch('/settings/export-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: exportScheduleEnabled, frequency: exportScheduleFreq }),
      });
      if (!res.ok) throw new Error('schedule');
      toast.success(exportScheduleEnabled
        ? `Scheduled ${exportScheduleFreq} exports enabled. Reports will be emailed to ${user?.email}.`
        : 'Scheduled exports disabled.');
    } catch {
      toast.error('Failed to save export schedule.');
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleSaveLlmKey = async () => {
    const key = llmKeyInput.trim();
    if (!key.startsWith('sk-') || key.length < 20) {
      toast.error('Paste a valid OpenAI secret key (starts with sk-).');
      return;
    }
    if (!user) return;
    setLlmSaving(true);
    try {
      const res = await apiFetch(
        '/settings/llm',
        withProdLlmNoMock({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openai_api_key: key }),
        }),
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error((data as { detail?: string }).detail || 'Failed to save key.');
        return;
      }
      setLlmKeyInput('');
      setLlmStatus(data as LlmKeyStatus);
      toast.success('OpenAI key saved. Agents can use the live model now.');
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setLlmSaving(false);
    }
  };

  const handleClearLlmKey = async () => {
    setLlmSaving(true);
    try {
      const res = await apiFetch('/settings/llm', withProdLlmNoMock({ method: 'DELETE' }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error('Failed to remove organisation key.');
        return;
      }
      setLlmStatus(data as LlmKeyStatus);
      toast.success('Organisation key removed.');
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setLlmSaving(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    try {
      const res = await apiFetch('/settings/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: name }),
      });
      if (!res.ok) throw new Error('profile');
      const data = await res.json().catch(() => ({}));
      login({ ...user, name: data?.profile?.full_name || name, ngoName });
      toast.success('Profile updated.');
    } catch {
      toast.error('Failed to update profile.');
    }
  };

  const handleExportData = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const filename = `goodjobs_export_${today}.zip`;
    // In production (real backend), delegate to the /dpdp/export endpoint which
    // has access to the full database — Zustand may only be partially hydrated.
    if (!isMockEnabled()) {
      try {
        const res = await apiFetch('/dpdp/export', { noMockFallback: true });
        if (res.ok) {
          const ct = res.headers.get('content-type') ?? '';
          const blob = ct.includes('application/zip')
            ? await res.blob()
            : new Blob([JSON.stringify(await res.json(), null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = ct.includes('application/zip') ? filename : `goodjobs_export_${today}.json`;
          a.click();
          URL.revokeObjectURL(url);
          toast.success('Your data export has been downloaded.');
          return;
        }
      } catch { /* fall through to client-side build */ }
    }
    // Mock / dev mode — build the ZIP client-side from the Zustand store.
    try {
      const toCsv = (rows: Record<string, unknown>[], fallbackHeaders?: string[]): string => {
        if (rows.length === 0) return fallbackHeaders ? fallbackHeaders.join(',') + '\n' : '';
        const headers = Object.keys(rows[0]);
        const escape = (v: unknown): string => {
          const s = v == null ? '' : String(v);
          return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"` : s;
        };
        return [
          headers.join(','),
          ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
        ].join('\n');
      };

      const zip = new JSZip();

      // Helper: safely serialize nested objects as JSON strings inside a cell
      const ser = (v: unknown) => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

      zip.file('donors.csv', toCsv(exportDonors.map(d => ({
        id: d.id, name: d.name, initial: d.initial, type: d.type,
        total_given: d.totalGiven, last_gift: d.lastGift, pan: d.pan,
        location: d.location, email: d.email ?? '', phone: d.phone ?? '',
        tags: (d.tags ?? []).join(';'), meta: ser(d.meta),
      }))));

      zip.file('transactions.csv', toCsv(exportTransactions.map(t => ({
        id: t.id, donor_id: t.donorId, donor_name: t.donorName,
        amount: t.amount, method: t.method,
        campaign_id: t.campaignId, campaign_title: t.campaignTitle,
        programme_id: t.programmeId ?? '', grant_id: t.grantId ?? '',
        date: t.date, timestamp: t.timestamp,
      }))));

      // Beneficiaries include joined outcomes rows for each beneficiary
      const outcomesByBen = new Map<string, typeof exportOutcomes>();
      exportOutcomes.forEach(o => {
        const arr = outcomesByBen.get(o.beneficiaryId) ?? [];
        arr.push(o);
        outcomesByBen.set(o.beneficiaryId, arr);
      });
      zip.file('beneficiaries.csv', toCsv(exportBeneficiaries.map(b => {
        const outs = (outcomesByBen.get(b.id) ?? []).map(o =>
          `${o.metricLabel}:${o.current}${o.unit ? o.unit : ''}`
        ).join(';');
        return {
          id: b.id, name: b.name, program: b.program, location: b.location,
          aadhaar: b.aadhaar ? 'yes' : 'no', family_size: b.familySize,
          details: ser(b.details), outcomes: outs,
        };
      })));

      zip.file('grants.csv', toCsv(exportGrants.map(g => ({
        id: g.id, company: g.company, amount: g.amount, project: g.project,
        tags: (g.tags ?? []).join(';'), status: g.col, agent: g.agent ?? '',
        date: g.date, report_due_date: g.report_due_date ?? '',
        win_probability: g.win_probability ?? '',
        last_activity_at: g.last_activity_at ?? '',
        stage_entered_at: g.stage_entered_at ?? '',
        updated_at: g.updated_at ?? '', created_at: g.created_at ?? '',
        details: ser(g.details),
      }))));

      zip.file('compliance_docs.csv', toCsv(exportCompliance.map(c => ({
        id: c.id, name: c.name, type: c.type, status: c.status,
        expiry: c.expiry, registration_number: c.registration_number ?? '',
        assigned_to: c.assigned_to ?? '', uploaded_at: c.uploadedAt,
        details: ser(c.details),
      }))));

      zip.file('volunteers.csv', toCsv(exportVolunteers.map(v => ({
        id: v.id, name: v.name, skills: (v.skills ?? []).join(';'),
        hours: v.hours, verified: v.verified ? 'yes' : 'no',
        profile: ser(v.profile),
      }))));

      zip.file('form_submissions.csv', toCsv(exportMisIntents.map(m => ({
        id: m.id, reporter_id: m.reporterId, report_date: m.reportDate,
        status: m.status, narrative: m.narrative,
        beneficiary: m.extracted?.beneficiary ?? '', location: m.extracted?.location ?? '',
        metric: m.extracted?.metric ?? '', value: m.extracted?.value ?? '',
        program: m.extracted?.program ?? '', created_at: m.createdAt,
        decided_at: m.decidedAt ?? '',
      }))));

      zip.file('programme_outcomes.csv', toCsv(exportOutcomes.map(o => ({
        id: o.id, beneficiary_id: o.beneficiaryId, program_id: o.programId,
        metric: o.metric, metric_label: o.metricLabel, baseline: o.baseline,
        current: o.current, unit: o.unit ?? '',
        higher_is_better: o.higherIsBetter ? 'yes' : 'no',
        measured_at: o.measuredAt, note: o.note ?? '',
        toc_node_id: o.tocNodeId ?? '',
      }))));

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Full data export downloaded as ZIP.', { duration: 4000 });
    } catch {
      toast.error('Failed to export your data.');
    }
  };

  const handleSaveNgo = async () => {
    if (!user) return;
    try {
      const res = await apiFetch('/settings/ngo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ngoName, reg_no: regNo || null, fcra_reg: fcraReg || null, pan: panNo || null, state: ngoState || null }),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      const data = await res.json().catch(() => ({}));
      login({ ...user, ngoName: data?.ngo?.name || ngoName, name });
      // Single source of truth: write to Zustand so Finance, Compliance, and
      // every other module always reads the same canonical org identity.
      setNgoDetails({
        name:     data?.ngo?.name    || ngoName,
        reg_no:   data?.ngo?.reg_no  ?? regNo,
        fcra_reg: data?.ngo?.fcra_reg ?? fcraReg,
        pan:      data?.ngo?.pan     ?? panNo,
        state:    data?.ngo?.state   ?? ngoState,
        // 80G number: carry through from compliance docs if available, else keep
        // existing value in store (Compliance Registry is the canonical source,
        // but Settings must propagate whatever is currently resolved).
        eighty_g_no: eightyGNo || undefined,
      });
      toast.success('NGO details saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save NGO details.');
    }
  };

  const handleSaveNotifs = async () => {
    try {
      const res = await apiFetch('/settings/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefs: notifs }),
      });
      if (!res.ok) throw new Error('notifs');
      toast.success('Notification preferences saved.');
    } catch {
      toast.error('Failed to save preferences.');
    }
  };

  const handleChangePassword = async () => {
    if (pwNext.length < 8) return toast.error('Password must be at least 8 characters.');
    if (pwNext !== pwConfirm) return toast.error('New passwords do not match.');
    try {
      const res = await apiFetch('/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: pwCurrent, new_password: pwNext }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || 'pw');
      setPwCurrent(''); setPwNext(''); setPwConfirm('');
      toast.success('Password updated.');
    } catch {
      toast.error('Failed to update password.');
    }
  };

  const handleRevokeOtherSessions = async () => {
    try {
      const res = await apiFetch('/auth/sessions/revoke-other', { method: 'POST' });
      if (!res.ok) throw new Error('revoke');
      const data = await res.json().catch(() => ({}));
      toast(data?.note || 'Requested session revocation.', { icon: '🔒' });
    } catch {
      toast.error('Failed to revoke sessions.');
    }
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
              {loadingSettings && (
                <div className="settings-info-box">Loading settings…</div>
              )}
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

          {/* Plans & Billing */}
          {activeTab === 'plans' && <PlansSection />}

          {/* WhatsApp Field Portal */}
          {activeTab === 'whatsapp' && <WhatsAppPortal />}

          {/* Team & Invites */}
          {activeTab === 'team' && (
            <div>
              <h3 className="settings-section-title">Team & Invites</h3>
              <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', marginTop: '-0.25rem', marginBottom: '1rem' }}>
                Invite colleagues so they can log into the same NGO workspace. Roles control which modules each person can access.
              </p>

              {/* Tier-cap meter */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  padding: '0.75rem 1rem',
                  background: 'var(--color-bg-main)',
                  border: '1px solid var(--color-border-light)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '1.25rem',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                    {usage.team} of {teamCap === null ? 'unlimited' : teamCap} team members on your {normalizeTier(tier)} plan
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                    Counts you + outstanding invites. Invites you revoke don't count.
                  </div>
                </div>
                {teamCap !== null && usage.team >= teamCap && (
                  <span style={{
                    background: '#fef3c7', color: '#b45309',
                    padding: '4px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}>
                    <Lock size={12} /> Limit reached
                  </span>
                )}
              </div>

              {/* Invite form */}
              <div className="settings-form" style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Colleague's email</label>
                    <input
                      className="input-field"
                      type="email"
                      placeholder="name@yourngo.org"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                    />
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Role</label>
                    <select
                      className="input-field"
                      value={inviteRole}
                      onChange={e => setInviteRole(e.target.value)}
                    >
                      <option value="ED">Executive Director</option>
                      <option value="PROGRAM_HEAD">Program Head</option>
                      <option value="FUNDRAISER">Fundraiser</option>
                      <option value="FINANCE">Finance Officer</option>
                      <option value="FIELD_OPS">Field Officer</option>
                    </select>
                  </div>
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={sendInvite}
                    style={{ height: 38 }}
                  >
                    <Mail size={14} /> Send invite
                  </button>
                </div>
              </div>

              {/* Existing team members (wizard + store) with role change */}
              {pendingTeamMembers.length > 0 && (
                <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: '1rem' }}>
                  <div style={{
                    padding: '0.55rem 0.85rem', background: 'var(--color-bg-main)',
                    fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                    color: 'var(--color-text-tertiary)', borderBottom: '1px solid var(--color-border-light)',
                  }}>
                    Team members
                  </div>
                  {pendingTeamMembers.map(member => (
                    <div key={member.email}>
                      <div
                        style={{
                          display: 'flex', alignItems: 'center',
                          padding: '0.65rem 0.85rem',
                          borderBottom: confirmRemoveEmail === member.email ? 'none' : '1px solid var(--color-border-light)',
                          fontSize: '0.85rem', gap: '0.75rem',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.email}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                            Joined {new Date(member.invitedAt).toLocaleDateString('en-IN')}
                          </div>
                        </div>
                        <select
                          className="input-field"
                          style={{ width: 'auto', minWidth: 140, fontSize: '0.8rem', padding: '4px 8px', height: 34 }}
                          value={member.role}
                          disabled={confirmRemoveEmail === member.email}
                          onChange={e => {
                            updatePendingTeamMember(member.email, e.target.value);
                            toast.success(`${member.email.split('@')[0]}'s role updated to ${ROLE_META[e.target.value as keyof typeof ROLE_META]?.label ?? e.target.value}.`);
                          }}
                        >
                          <option value="ED">Executive Director</option>
                          <option value="PROGRAM_HEAD">Program Head</option>
                          <option value="FUNDRAISER">Fundraiser</option>
                          <option value="FINANCE">Finance Officer</option>
                          <option value="FIELD_OPS">Field Officer</option>
                        </select>
                        <button
                          type="button"
                          title="Remove member"
                          aria-label={`Remove ${member.email}`}
                          onClick={() => setConfirmRemoveEmail(member.email)}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, color: 'var(--color-text-tertiary)', flexShrink: 0 }}
                        >
                          <XIcon size={16} />
                        </button>
                      </div>
                      {confirmRemoveEmail === member.email && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: '0.6rem',
                          padding: '0.55rem 0.85rem',
                          background: 'var(--color-danger-bg, #fef2f2)',
                          borderBottom: '1px solid var(--color-border-light)',
                          fontSize: '0.8rem',
                        }}>
                          <span style={{ flex: 1, color: 'var(--color-danger, #dc2626)', fontWeight: 500 }}>
                            Remove <strong>{member.email}</strong> from workspace? This cannot be undone.
                          </span>
                          <button
                            type="button"
                            className="btn btn-danger"
                            style={{ padding: '3px 12px', fontSize: '0.78rem', height: 30 }}
                            disabled={removingEmail === member.email}
                            onClick={() => handleRemoveMember(member.email)}
                          >
                            {removingEmail === member.email ? 'Removing…' : 'Remove'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '3px 12px', fontSize: '0.78rem', height: 30 }}
                            onClick={() => setConfirmRemoveEmail(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Invite list */}
              <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                <div style={{
                  padding: '0.55rem 0.85rem', background: 'var(--color-bg-main)',
                  fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                  color: 'var(--color-text-tertiary)', borderBottom: '1px solid var(--color-border-light)',
                }}>
                  Pending invites
                </div>
                {(user?.pendingInvites ?? []).length === 0 ? (
                  <div style={{ padding: '1rem', fontSize: '0.85rem', color: 'var(--color-text-tertiary)' }}>
                    No pending invites yet.
                  </div>
                ) : (
                  (user!.pendingInvites!).map(inv => (
                    <div
                      key={inv.email}
                      style={{
                        display: 'flex', alignItems: 'center',
                        padding: '0.65rem 0.85rem',
                        borderBottom: '1px solid var(--color-border-light)',
                        fontSize: '0.85rem', gap: '0.75rem',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.email}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                          invited {new Date(inv.invitedAt).toLocaleDateString('en-IN')}
                        </div>
                      </div>
                      <select
                        className="input-field"
                        style={{ width: 'auto', minWidth: 140, fontSize: '0.8rem', padding: '4px 8px', height: 34, flexShrink: 0 }}
                        value={inv.role}
                        onChange={e => {
                          const newRole = e.target.value;
                          const next = (user!.pendingInvites!).map(p =>
                            p.email === inv.email ? { ...p, role: newRole } : p
                          );
                          updateUser({ pendingInvites: next });
                          toast.success(`${inv.email.split('@')[0]}'s role updated to ${ROLE_META[newRole as keyof typeof ROLE_META]?.label ?? newRole}.`);
                        }}
                      >
                        <option value="ED">Executive Director</option>
                        <option value="PROGRAM_HEAD">Program Head</option>
                        <option value="FUNDRAISER">Fundraiser</option>
                        <option value="FINANCE">Finance Officer</option>
                        <option value="FIELD_OPS">Field Officer</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => revokeInvite(inv.email)}
                        title="Revoke invite"
                        aria-label={`Revoke invite to ${inv.email}`}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, color: 'var(--color-text-tertiary)', flexShrink: 0 }}
                      >
                        <XIcon size={16} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <ContextualUpgradePrompt
                open={teamUpgradeOpen}
                onClose={() => setTeamUpgradeOpen(false)}
                blockedAction="More team members"
                reason={`Your ${normalizeTier(tier)} plan caps your workspace at ${teamCap ?? 'unlimited'} members.`}
                nextBenefits={[
                  'Up to 50 team members on Growth (or unlimited on Scale)',
                  'AI Copilot, WhatsApp data entry, AI report drafting',
                  'Unlimited beneficiaries · unlimited programs',
                  'Priority support + onboarding call',
                ]}
                targetTier={tier === 'scale' ? 'scale' : 'growth'}
                onUpgrade={() => {
                  setTeamUpgradeOpen(false);
                  // Hand off to the global upgrade flow so the Plans tab opens
                  // pre-selected on the next tier and the user can complete
                  // checkout in one click — matches the spec's friction-moment
                  // upgrade requirement.
                  openUpgrade({
                    targetTier: tier === 'scale' ? 'scale' : 'growth',
                    source: 'team_cap',
                  });
                }}
              />
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="input-group"><label className="input-label">PAN / TAN</label>
                    <input className="input-field" value={panNo} onChange={e => setPanNo(e.target.value)} /></div>
                  <div className="input-group">
                    <label className="input-label">80G Certificate No.</label>
                    <input
                      className="input-field"
                      readOnly
                      style={{ background: 'var(--color-bg-secondary)', cursor: 'default', color: 'var(--color-text-secondary)' }}
                      value={eightyGNo || 'Set via Compliance HQ → upload 80G certificate'}
                      title="Upload your 80G certificate in Compliance HQ to set this automatically"
                    />
                    <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem', display: 'block' }}>
                      Managed in Compliance HQ — upload your 80G certificate there to update this value.
                    </span>
                  </div>
                </div>
                <div className="input-group"><label className="input-label">State of Registration</label>
                  <select className="input-field" value={ngoState} onChange={e => setNgoState(e.target.value)}>
                    <option>Andhra Pradesh</option><option>Delhi</option><option>Gujarat</option><option>Karnataka</option>
                    <option>Kerala</option><option>Maharashtra</option><option>Rajasthan</option><option>Tamil Nadu</option>
                    <option>Telangana</option><option>Uttar Pradesh</option><option>West Bengal</option>
                  </select>
                </div>
                {storedNgoDetails.whatsapp && (
                  <div className="input-group">
                    <label className="input-label">WhatsApp Number (from onboarding)</label>
                    <input className="input-field" readOnly value={storedNgoDetails.whatsapp} style={{ background: 'var(--color-bg-secondary)', cursor: 'default' }} />
                  </div>
                )}
                <button className="btn btn-primary" onClick={handleSaveNgo}><Save size={16} /> Save NGO Details</button>
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
                  <input type="password" className="input-field" placeholder="••••••••" value={pwCurrent} onChange={e => setPwCurrent(e.target.value)} /></div>
                <div className="input-group"><label className="input-label">New Password</label>
                  <input type="password" className="input-field" placeholder="Min. 8 characters" value={pwNext} onChange={e => setPwNext(e.target.value)} /></div>
                <div className="input-group"><label className="input-label">Confirm Password</label>
                  <input type="password" className="input-field" placeholder="••••••••" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} /></div>
                <button className="btn btn-primary" onClick={handleChangePassword}><Key size={16} /> Change Password</button>
                <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#fff7ed', borderRadius: 'var(--radius-md)', border: '1px solid #fed7aa' }}>
                  <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: '#c2410c' }}>Active Sessions</div>
                  <div style={{ fontSize: '0.8rem', color: '#9a3412' }}>MacBook Pro • Mumbai, India • Active now</div>
                  <button className="btn btn-secondary" style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                    onClick={handleRevokeOtherSessions}>Revoke All Other Sessions</button>
                </div>
              </div>
            </div>
          )}

          {/* AI & Agents — OpenAI key for LangGraph agents */}
          {activeTab === 'ai' && (
            <div>
              <h3 className="settings-section-title">AI and agents</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '1rem', maxWidth: '36rem', lineHeight: 1.5 }}>
                Donor nurture, grant drafts, field MIS, intent routing, and GenAI features call OpenAI when a key is configured.
                You can set a key for this organisation here, or your hosting provider can set <code style={{ fontSize: '0.78em' }}>OPENAI_API_KEY</code> for all tenants.
              </p>
              <div className="settings-form" style={{ maxWidth: '28rem' }}>
                <div className="settings-info-box" style={{ marginBottom: '1rem' }}>
                  {llmStatus?.configured ? (
                    <>
                      <strong>Model access:</strong> active ({llmStatus.source === 'organisation' ? 'organisation key' : 'server environment'})
                      {llmStatus.masked ? (
                        <div style={{ marginTop: '0.35rem', fontFamily: 'ui-monospace, monospace', fontSize: '0.82rem' }}>
                          {llmStatus.masked}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <span>No OpenAI key is configured for this workspace. Agents will use template fallbacks until you add a key or the server sets OPENAI_API_KEY.</span>
                  )}
                </div>
                <div className="input-group">
                  <label className="input-label">OpenAI API key (organisation)</label>
                  <input
                    type="password"
                    className="input-field"
                    autoComplete="off"
                    placeholder="sk-…"
                    value={llmKeyInput}
                    onChange={e => setLlmKeyInput(e.target.value)}
                  />
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem', display: 'block' }}>
                    Stored encrypted when the database is enabled. Never shown again after save.
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-primary" onClick={handleSaveLlmKey} disabled={llmSaving}>
                    <Save size={16} /> {llmSaving ? 'Saving…' : 'Save key'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                    onClick={handleClearLlmKey}
                    disabled={llmSaving || !llmStatus?.configured || llmStatus?.source !== 'organisation'}
                  >
                    Remove organisation key
                  </button>
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

                {/* Scheduled Exports */}
                <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                  <div style={{ padding: '0.875rem 1rem', borderBottom: exportScheduleEnabled ? '1px solid var(--color-border-light)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Mail size={14} style={{ color: 'var(--color-primary)' }} /> Scheduled Automatic Exports
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '0.2rem' }}>
                        Receive a full data export ZIP by email on a recurring schedule
                      </div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={exportScheduleEnabled} onChange={e => setExportScheduleEnabled(e.target.checked)} />
                      <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{exportScheduleEnabled ? 'On' : 'Off'}</span>
                    </label>
                  </div>
                  {exportScheduleEnabled && (
                    <div style={{ padding: '0.875rem 1rem', background: 'var(--color-bg-main)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 500, whiteSpace: 'nowrap' }}>Frequency:</span>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          {(['weekly', 'monthly'] as const).map(f => (
                            <button
                              key={f}
                              onClick={() => setExportScheduleFreq(f)}
                              style={{
                                padding: '0.3rem 0.75rem',
                                borderRadius: 'var(--radius-sm)',
                                border: `1px solid ${exportScheduleFreq === f ? 'var(--color-primary)' : 'var(--color-border-light)'}`,
                                background: exportScheduleFreq === f ? 'var(--color-primary)' : 'transparent',
                                color: exportScheduleFreq === f ? '#fff' : 'var(--color-text-secondary)',
                                fontSize: '0.8rem',
                                fontWeight: exportScheduleFreq === f ? 600 : 400,
                                cursor: 'pointer',
                                textTransform: 'capitalize',
                              }}
                            >{f}</button>
                          ))}
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                          {exportScheduleFreq === 'weekly' ? '— every Monday at 6:00 AM IST' : '— 1st of every month at 6:00 AM IST'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', padding: '0.5rem 0.75rem', background: '#f0fdf4', borderRadius: 'var(--radius-sm)', border: '1px solid #bbf7d0' }}>
                        📧 Export ZIP will be emailed to <strong>{user?.email}</strong>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  className="btn btn-primary"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={handleSaveExportSchedule}
                  disabled={savingSchedule}
                >
                  <Save size={14} /> {savingSchedule ? 'Saving…' : 'Save Export Schedule'}
                </button>

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
                <button className="btn btn-primary" onClick={handleSaveNotifs}><Save size={16} /> Save Preferences</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
