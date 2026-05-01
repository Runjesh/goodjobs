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
import { useAuth, ROLE_META } from '../../context/AuthContext';
import { useTranslation, type TranslationKey } from '../../i18n';
import toast from 'react-hot-toast';
import { apiFetch } from '../../api/client';
import { useStore, type ComplianceDocument } from '../../store/useStore';
import { getPageVariants } from '../../motion/variants';
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
  const { user, can } = useAuth();
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
    const run = async () => {
      try {
        const dRes = await apiFetch('/crm/donors');
        if (!dRes.ok) return;
        const dData = await dRes.json();
        if (cancelled) return;
        if (Array.isArray(dData.donors)) setDonors(dData.donors);
      } catch {
        /* keep store */
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
    const run = async () => {
      try {
        const res = await apiFetch('/csr/cards');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data.cards)) setCsrCards(data.cards as any);
      } catch {
        /* keep store */
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
    </div>
  );
};

export default Layout;
