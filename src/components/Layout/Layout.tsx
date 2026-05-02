import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Sun, ClipboardList, Wallet, BarChart2,
  FileText, Cpu, Settings, Bell, Menu, X,
  Moon, Lock, Users, HeartHandshake, Building2,
  CalendarCheck, ShieldCheck
} from 'lucide-react';
import CommandPalette from '../CommandPalette/CommandPalette';
import IntentBar from './IntentBar';
import UserChip from '../Auth/UserChip';
import BottomNav from '../ui/BottomNav';
import NotificationCenter from '../Notifications/NotificationCenter';
import WelcomeModal from '../Onboarding/WelcomeModal';
import TrialPill from './TrialPill';
import TrialExpiredBanner from '../Onboarding/TrialExpiredBanner';
import TrialUpgradeModal from '../Onboarding/TrialUpgradeModal';
import { useAuth, ROLE_META } from '../../context/AuthContext';
import {
  daysSinceStart, isTrialExpired, nudgeFired, withNudgeFired,
  NUDGE_DAY_21, NUDGE_DAY_28, daysUntilDowngrade,
} from '../../utils/trial';
import type { SubscriptionTier } from '../../utils/trial';
import PastDueBanner from '../Billing/PastDueBanner';
import WelcomeBanner from '../Billing/WelcomeBanner';
import { useTranslation, type TranslationKey } from '../../i18n';
import toast from 'react-hot-toast';
import { apiFetch } from '../../api/client';
import { useStore, type ComplianceDocument, type Donor } from '../../store/useStore';
import { getPageVariants } from '../../motion/variants';
import { setLifecycleScope } from '../../utils/donorLifecycle';
import './Layout.css';

// ── Navigation Config ────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { path: '/',          icon: Sun,          label: 'Today',            module: 'dashboard',  section: 'workspace' },
  { path: '/programs',  icon: ClipboardList,label: 'Programs',         module: 'programs',   section: 'workspace' },
  { path: '/funding',   icon: Wallet,       label: 'Funding',          module: 'funding',    section: 'workspace' },
  { path: '/insights',  icon: BarChart2,    label: 'Insights',         module: 'insights',   section: 'workspace' },
  { path: '/reports',   icon: FileText,     label: 'Reports',          module: 'reports',    section: 'workspace' },
  { path: '/agent-hq',  icon: Cpu,          label: 'GoodJobs Copilot', module: 'agent-hq',   section: 'tools', accent: '#6366f1' },
  { path: '/settings',  icon: Settings,     label: 'Settings',         module: 'settings',   section: 'system'  },
];

// ── Component ────────────────────────────────────────────────────────────────
const Layout: React.FC = () => {
  const [isPaletteOpen,  setIsPaletteOpen]  = useState(false);
  const [isSidebarOpen,  setIsSidebarOpen]  = useState(false);
  const [isNotifOpen,    setIsNotifOpen]    = useState(false);
  const [isDarkMode,     setIsDarkMode]     = useState(false);
  const [trialModal,     setTrialModal]     = useState<null | 'day28' | 'expired'>(null);
  const { user, can, updateUser } = useAuth();
  const { t, lang, setLanguage } = useTranslation();
  const { setDonors, setTransactions, setCampaigns, setCsrCards, setComplianceDocs } = useStore();
  const { setVolunteers, setBeneficiaries } = useStore();
  const navigate       = useNavigate();
  const location       = useLocation();
  const reducedMotion  = useReducedMotion();
  const pageVariants   = useMemo(() => getPageVariants(!!reducedMotion), [reducedMotion]);
  const meta           = user ? ROLE_META[user.role] : null;

  // Close sidebar & more on route change
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  // ── Wizard gate: a brand-new user (just came through /signup) hasn't yet
  // completed onboarding. Push them to /onboarding from anywhere inside the app.
  useEffect(() => {
    if (user?.needsWizard && location.pathname !== '/onboarding') {
      navigate('/onboarding', { replace: true });
    }
  }, [user?.needsWizard, location.pathname, navigate]);

  // ── Trial nudge cadence: day-21 warning toast + day-28 upgrade modal,
  // each fires at most once thanks to the persistent nudge marker on AuthUser.
  // We re-evaluate on every route change (frequent in an SPA) AND on a 5-minute
  // interval, so a long-lived session that spans day thresholds still fires
  // nudges even without a logout/reload. nudgeFired() prevents duplicates.
  const [nudgeTick, setNudgeTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNudgeTick(t => t + 1), 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (!user?.trial) return;
    const days = daysSinceStart(user.trial);
    const expired = isTrialExpired(user.trial);

    if (expired && !nudgeFired(user.trial, 'day28')) {
      // Auto-show the modal in its expired variant the first time we land in
      // an expired session, even if the day-28 nudge was missed entirely.
      setTrialModal('expired');
      updateUser({ trial: withNudgeFired(user.trial, 'day28') });
      return;
    }

    if (!expired && days >= NUDGE_DAY_28 && !nudgeFired(user.trial, 'day28')) {
      setTrialModal('day28');
      updateUser({ trial: withNudgeFired(user.trial, 'day28') });
      return;
    }

    if (!expired && days >= NUDGE_DAY_21 && days < NUDGE_DAY_28 && !nudgeFired(user.trial, 'day21')) {
      const left = Math.max(0, 30 - days);
      toast(`⚠️ Your trial ends in ${left} day${left === 1 ? '' : 's'} — pick a plan to keep AI features on.`, {
        duration: 6000,
        style: { background: '#fef3c7', color: '#b45309', border: '1px solid #fbbf24' },
      });
      updateUser({ trial: withNudgeFired(user.trial, 'day21') });
    }
  }, [user?.id, user?.trial?.startedAt, user?.trial?.nudges?.day21, user?.trial?.nudges?.day28, location.pathname, nudgeTick, updateUser]);

  // ── Day-30 enforcement: durably downgrade to Starter the first time we see
  // an expired trial, so the change persists across reloads/logins (not just
  // computed at render time). Idempotent thanks to the tier guard.
  useEffect(() => {
    if (!user?.trial) return;
    if (!isTrialExpired(user.trial)) return;
    const current: SubscriptionTier | undefined = user.subscriptionTier;
    if (current && current !== 'trial') return; // already on a chosen plan
    updateUser({ subscriptionTier: 'starter' });
  }, [user?.trial?.endsAt, user?.subscriptionTier, nudgeTick, updateUser]);

  // ── Past-due hard-downgrade: if the org's payment has been past_due longer
  // than the grace window, force them to Starter and mark the subscription
  // canceled. Idempotent — the guard short-circuits once already on Starter.
  useEffect(() => {
    if (!user?.billing) return;
    if (user.billing.status !== 'past_due') return;
    if (daysUntilDowngrade(user.billing) > 0) return;
    if (user.subscriptionTier === 'starter') return;
    updateUser({
      subscriptionTier: 'starter',
      billing: { ...user.billing, status: 'canceled' },
    });
    toast(`Subscription downgraded to Starter — payment has been overdue past the ${7}-day grace period.`, {
      icon: '↘️', duration: 7000,
    });
  }, [user?.billing?.status, user?.billing?.pastDueSince, user?.subscriptionTier, nudgeTick, updateUser]);

  // Scope donor-lifecycle localStorage keys to the active tenant so different
  // orgs sharing this browser can't cross-read milestone state.
  useEffect(() => {
    setLifecycleScope(user?.ngoId ?? null);
  }, [user?.ngoId]);

  // ⌘K shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsPaletteOpen(true);
      }
      if (e.key === 'Escape') {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Hydrate CRM + transactions only when the role may access those modules (avoids 403 noise).
  useEffect(() => {
    if (!can('crm', 'canView')) return;
    let cancelled = false;
    const seedDemoDonorsIfDev = () => {
      if (!import.meta.env.DEV) return;
      if (cancelled) return;
      const existing = useStore.getState().donors;
      if (existing.length > 0) return;
      // Demo donors with varied lastGift dates so all lifecycle stages appear.
      // Dates are picked relative to a near-current window so they survive a
      // few months of clock drift without re-seeding.
      const today = new Date();
      const daysAgo = (n: number) => {
        const d = new Date(today); d.setDate(d.getDate() - n);
        return d.toISOString().split('T')[0];
      };
      const seed: Donor[] = [
        { id: '1', name: 'Anjali Desai',       type: 'Major Donor',    totalGiven: 450000,  lastGift: daysAgo(345), initial: 'A', pan: 'ABCP****4D', location: 'Mumbai, Maharashtra',  tags: ['Education Cause'] },
        { id: '2', name: 'Rohan Gupta',        type: 'Recurring',      totalGiven:  24000,  lastGift: daysAgo(15),  initial: 'R', pan: 'BVCX****9H', location: 'Delhi, NCR',           tags: ['Monthly Giver'] },
        { id: '3', name: 'Infosys Foundation', type: 'CSR Partner',    totalGiven: 5000000, lastGift: daysAgo(400), initial: 'I', pan: 'INFS****1C', location: 'Bangalore, Karnataka', tags: ['CSR'] },
        { id: '4', name: 'Priya Sharma',       type: 'Lapsing',        totalGiven:  15000,  lastGift: daysAgo(180), initial: 'P', pan: 'PRYS****3J', location: 'Pune, Maharashtra',    tags: ['Health'] },
        { id: '5', name: 'Vikram Singh',       type: 'Event Attendee', totalGiven:   5000,  lastGift: daysAgo(60),  initial: 'V', pan: 'VKRS****2K', location: 'Jaipur, Rajasthan',    tags: ['Events'] },
        { id: '6', name: 'Sneha Iyer',         type: 'Recurring',      totalGiven:  72000,  lastGift: daysAgo(95),  initial: 'S', pan: 'SNHI****6M', location: 'Chennai, Tamil Nadu',  tags: ['Renewal'] },
      ];
      setDonors(seed);
    };
    const run = async () => {
      try {
        const dRes = await apiFetch('/crm/donors');
        if (!dRes.ok) { seedDemoDonorsIfDev(); return; }
        const dData = await dRes.json();
        if (cancelled) return;
        if (Array.isArray(dData.donors)) {
          setDonors(dData.donors);
          if (dData.donors.length === 0) seedDemoDonorsIfDev();
        }
      } catch {
        seedDemoDonorsIfDev();
      }
    };
    run();
    return () => { cancelled = true; };
  }, [can, setDonors]);

  useEffect(() => {
    if (!can('finance', 'canView')) return;
    let cancelled = false;
    const run = async () => {
      try {
        const tRes = await apiFetch('/finance/transactions');
        if (!tRes.ok) return;
        const tData = await tRes.json();
        if (cancelled) return;
        if (Array.isArray(tData.transactions)) setTransactions(tData.transactions);
      } catch {
        /* keep store */
      }
    };
    run();
    return () => { cancelled = true; };
  }, [can, setTransactions]);

  // Warm cache for inbox + morning brief (first screen many users open)
  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        await Promise.all([apiFetch('/inbox'), apiFetch('/morning-brief')]);
      } catch {
        /* non-fatal */
      }
    })();
  }, [user?.token]);

  useEffect(() => {
    if (!can('fundraising', 'canView')) return;
    let cancelled = false;
    const run = async () => {
      try {
        const res = await apiFetch('/fundraising/campaigns');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data.campaigns)) setCampaigns(data.campaigns);
      } catch {
        /* keep store */
      }
    };
    run();
    return () => { cancelled = true; };
  }, [can, setCampaigns]);

  useEffect(() => {
    if (!can('csr', 'canView')) return;
    let cancelled = false;
    const seedDemoCsrIfDev = () => {
      if (!import.meta.env.DEV) return;
      if (cancelled) return;
      const existing = useStore.getState().csrCards;
      if (existing.length > 0) return;
      setCsrCards([
        { id: '1', company: 'Reliance Industries', amount: 5000000, project: 'Rural Healthcare Phase 2', tags: ['Health', 'Gujarat'], agent: 'AD', col: 'prospecting', date: 'Stale demo', win_probability: 52 },
        { id: '2', company: 'Tata Consultancy Services', amount: 2500000, project: 'Digital Literacy 2026', tags: ['Education', 'Tech'], agent: 'RS', col: 'pitch', date: 'Sent on: Oct 12', win_probability: 58 },
        { id: '3', company: 'HDFC Bank CSR', amount: 8000000, project: 'Women Livelihood Center', tags: ['Livelihood'], agent: 'AD', col: 'diligence', date: 'Audit pending', win_probability: 62 },
        { id: '4', company: 'Wipro Care', amount: 1200000, project: 'School Infrastructure', tags: ['Education', 'WASH'], agent: 'PM', col: 'mou', date: 'Signed: Oct 15', win_probability: 70 },
        { id: '5', company: 'Mahindra Finance', amount: 4500000, project: 'Farmer Support Init', tags: ['Agriculture'], agent: 'RS', col: 'live', date: 'Report due: Nov 30', win_probability: 80 },
        { id: '6', company: 'Infosys Foundation', amount: 6000000, project: 'STEM for Girls', tags: ['Education'], agent: 'AD', col: 'live', date: 'Report due: Dec 15', win_probability: 76 },
      ] as any);
    };
    const run = async () => {
      try {
        const res = await apiFetch('/csr/cards');
        if (!res.ok) { seedDemoCsrIfDev(); return; }
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data.cards)) {
          // Always honor the backend response (including empty), then in DEV
          // overlay demo seed data so the frontend is usable without the API.
          setCsrCards(data.cards as any);
          if (data.cards.length === 0) seedDemoCsrIfDev();
        }
      } catch {
        seedDemoCsrIfDev();
      }
    };
    run();
    return () => { cancelled = true; };
  }, [can, setCsrCards]);

  useEffect(() => {
    if (!can('volunteers', 'canView')) return;
    let cancelled = false;
    const run = async () => {
      try {
        const vRes = await apiFetch('/volunteers/roster');
        if (!vRes.ok) return;
        const vData = await vRes.json();
        if (cancelled) return;
        if (Array.isArray(vData.volunteers)) setVolunteers(vData.volunteers);
      } catch {
        /* keep store */
      }
    };
    run();
    return () => { cancelled = true; };
  }, [can, setVolunteers]);

  useEffect(() => {
    if (!can('programs', 'canView')) return;
    let cancelled = false;
    const run = async () => {
      try {
        const bRes = await apiFetch('/programs/beneficiaries');
        if (!bRes.ok) return;
        const bData = await bRes.json();
        if (cancelled) return;
        if (Array.isArray(bData.beneficiaries)) setBeneficiaries(bData.beneficiaries);
      } catch {
        /* keep store */
      }
    };
    run();
    return () => { cancelled = true; };
  }, [can, setBeneficiaries]);

  useEffect(() => {
    if (!can('compliance', 'canView')) return;
    let cancelled = false;
    const mapApiComplianceDoc = (d: Record<string, unknown>): ComplianceDocument => {
      const st = String(d.status ?? 'Valid');
      const status: ComplianceDocument['status'] =
        st === 'Expired' || st === 'Expiring Soon' ? st : 'Valid';
      const det = d.details;
      return {
        id: String(d.id ?? ''),
        name: String(d.name ?? ''),
        type: String(d.doc_type ?? ''),
        status,
        expiry: String(d.expiry_date ?? ''),
        uploadedAt: String(d.created_at ?? '').slice(0, 10),
        details:
          typeof det === 'object' && det !== null && !Array.isArray(det)
            ? (det as Record<string, unknown>)
            : undefined,
      };
    };
    const run = async () => {
      try {
        const res = await apiFetch('/compliance/documents');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data.documents)) {
          setComplianceDocs(data.documents.map((x: Record<string, unknown>) => mapApiComplianceDoc(x)));
        }
      } catch {
        /* keep store */
      }
    };
    run();
    return () => { cancelled = true; };
  }, [can, setComplianceDocs]);

  // Dark mode init
  useEffect(() => {
    const isDark = localStorage.getItem('theme') === 'dark' || 
      (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setIsDarkMode(isDark);
    if (isDark) document.documentElement.classList.add('dark');
  }, []);

  const toggleDarkMode = () => {
    const nextDark = !isDarkMode;
    setIsDarkMode(nextDark);
    localStorage.setItem('theme', nextDark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', nextDark);
  };

  // Prevent body scroll when drawer open
  useEffect(() => {
    document.body.style.overflow = isSidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isSidebarOpen]);

  const handleNavClick = useCallback((e: React.MouseEvent, module: string, label: string) => {
    const hasAccess = can(module, 'canView');
    if (!hasAccess) {
      e.preventDefault();
      toast(`🔒 ${label} is restricted for your role.`, { duration: 2500 });
    }
  }, [can]);

  // ── Sidebar NavItems ──────────────────────────────────────────────────────
  const renderNavItems = (items: typeof NAV_ITEMS) =>
    items.map(item => {
      const Icon = item.icon;
      const hasAccess = can(item.module, 'canView');
      // Look up translation key based on module name
      const tKey = item.module.replace('-', '') as TranslationKey;
      const label = t(tKey) || item.label;

      return (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/'}
          className={({ isActive }) =>
            `nav-item ${isActive ? 'active' : ''} ${!hasAccess ? 'nav-item-locked' : ''}`
          }
          onClick={e => handleNavClick(e, item.module, item.label)}
          title={label}
        >
          <Icon
            className="nav-icon"
            style={item.accent ? { color: item.accent } : undefined}
          />
          <span>{label}</span>
          {!hasAccess && <Lock size={10} className="nav-lock-icon" />}
        </NavLink>
      );
    });

  return (
    <div className="layout-container">

      {/* ── Drawer overlay (mobile) ────────────────────── */}
      <div
        className={`drawer-overlay ${isSidebarOpen ? 'open' : ''}`}
        onClick={() => setIsSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`} aria-label="Main navigation">

        <div className="sidebar-header">
          <div className="logo-icon">GJ</div>
          <div>
            <div className="brand-name">GoodJobs</div>
            <div className="brand-tagline">Infrastructure for Social Good</div>
          </div>
          <button
            className="sidebar-close-btn"
            onClick={() => setIsSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="nav-menu" aria-label="Sidebar navigation">
          <div className="nav-section-label">{t('main')}</div>
          {renderNavItems(NAV_ITEMS.filter(i => i.section === 'workspace'))}
          <div className="nav-section-label">Tools</div>
          {renderNavItems(NAV_ITEMS.filter(i => i.section === 'tools'))}
          <div className="nav-section-label">{t('system')}</div>
          {renderNavItems(NAV_ITEMS.filter(i => i.section === 'system'))}
        </nav>

        <div className="sidebar-footer">
          <UserChip />
        </div>
      </aside>

      {/* ── Main Content ─────────────────────────────────── */}
      <main className="main-content">

        {/* Top Header */}
        <header className="top-header">

          {/* Hamburger (mobile only) */}
          <button
            className="hamburger-btn"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Open navigation"
            aria-expanded={isSidebarOpen}
          >
            <Menu size={22} />
          </button>

          {/* Intent Bar (Zero-Manual-Work Directive Layer) */}
          <div className="header-intent-wrap">
            <IntentBar />
          </div>

          {/* Actions */}
          <div className="header-actions">
            <TrialPill />
            <select
              className="header-lang-select"
              value={lang}
              onChange={(e) => setLanguage(e.target.value as any)}
              aria-label="Interface language"
            >
              <option value="en">English</option>
              <option value="hi">हिंदी (HI)</option>
              <option value="ta">தமிழ் (TA)</option>
            </select>
            <button
              className="action-btn"
              aria-label="Toggle Dark Mode"
              onClick={toggleDarkMode}
            >
              {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button
              className="action-btn notif-btn"
              aria-label="Notifications"
              onClick={() => setIsNotifOpen(true)}
            >
              <Bell size={20} />
              <span className="notif-dot" aria-hidden="true" />
            </button>

            {user && meta && (
              <div
                className="header-user"
                onClick={() => navigate('/settings')}
                role="button"
                tabIndex={0}
                aria-label="User settings"
              >
                <div
                  className="header-user-avatar"
                  style={{ background: `linear-gradient(135deg, ${meta.color}, ${meta.color}bb)` }}
                >
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="header-user-info">
                  <span className="header-user-name">{user.name.split(' ')[0]}</span>
                  <span className="header-user-role">{meta.icon} {meta.label}</span>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Page Content */}
        <div className="page-content">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              className="page-transition-root"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ minHeight: '100%' }}
            >
              <div className="page-content-inner">
                <TrialExpiredBanner />
                <PastDueBanner />
                <WelcomeBanner />
                <Outlet />
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* ── Bottom Navigation (mobile) ───────────────────── */}
      <BottomNav />

      {/* Command Palette */}
      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
      />

      {/* Smart Notifications */}
      <NotificationCenter
        isOpen={isNotifOpen}
        onClose={() => setIsNotifOpen(false)}
      />

      {/* First-time welcome modal — auto-shows once per user (suppressed during wizard) */}
      <WelcomeModal />

      {/* Day-28 trial upgrade modal (also reused in day-30 expired variant) */}
      {trialModal && user?.trial && (
        <TrialUpgradeModal
          trial={user.trial}
          variant={trialModal}
          onDismiss={() => setTrialModal(null)}
        />
      )}
    </div>
  );
};

export default Layout;
