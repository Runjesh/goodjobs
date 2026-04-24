import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, HeartHandshake, Users, Wallet, ClipboardList,
  Building2, CalendarCheck, ShieldCheck, Search, Bell, Settings,
  Cpu, Lock, Menu, X, Wallet as Finance,
  Wallet as WalletIcon, Moon, Sun, Sparkles
} from 'lucide-react';
import CommandPalette from '../CommandPalette/CommandPalette';
import IntentBar from './IntentBar';
import UserChip from '../Auth/UserChip';
import BottomNav from '../ui/BottomNav';
import NotificationCenter from '../Notifications/NotificationCenter';
import { useAuth, ROLE_META } from '../../context/AuthContext';
import { useTranslation, type TranslationKey } from '../../i18n';
import toast from 'react-hot-toast';
import './Layout.css';

// ── Navigation Config ────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { path: '/',            icon: LayoutDashboard, label: 'Dashboard',         module: 'dashboard',   section: 'main'    },
  { path: '/agent-hq',   icon: Cpu,             label: 'SevaSuite Copilot', module: 'agent-hq',   section: 'main', accent: '#8b5cf6' },
  { path: '/fundraising', icon: HeartHandshake,  label: 'Fundraising Cloud', module: 'fundraising', section: 'main'    },
  { path: '/crm',         icon: Users,           label: 'Donor CRM',         module: 'crm',         section: 'main'    },
  { path: '/finance',     icon: Wallet,          label: 'Finance & FCRA',    module: 'finance',     section: 'ops'     },
  { path: '/programs',    icon: ClipboardList,   label: 'Programs MIS',      module: 'programs',    section: 'ops'     },
  { path: '/csr',         icon: Building2,       label: 'CSR Pipeline',      module: 'csr',         section: 'ops'     },
  { path: '/volunteers',  icon: CalendarCheck,   label: 'Volunteers',        module: 'volunteers',  section: 'ops'     },
  { path: '/compliance',  icon: ShieldCheck,     label: 'Compliance HQ',     module: 'compliance',  section: 'ops'     },
  { path: '/settings',    icon: Settings,        label: 'Settings',          module: 'settings',    section: 'system'  },
];

const MORE_ITEMS = NAV_ITEMS.slice(4); // Finance onwards in the "More" sheet

// ── Component ────────────────────────────────────────────────────────────────
const Layout: React.FC = () => {
  const [isPaletteOpen,  setIsPaletteOpen]  = useState(false);
  const [isSidebarOpen,  setIsSidebarOpen]  = useState(false);
  const [isMoreOpen,     setIsMoreOpen]     = useState(false);
  const [isNotifOpen,    setIsNotifOpen]    = useState(false);
  const [isDarkMode,     setIsDarkMode]     = useState(false);
  const { user, can }  = useAuth();
  const { t, lang, setLanguage } = useTranslation();
  const navigate       = useNavigate();
  const location       = useLocation();
  const meta           = user ? ROLE_META[user.role] : null;

  // Close sidebar & more on route change
  useEffect(() => {
    setIsSidebarOpen(false);
    setIsMoreOpen(false);
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
        setIsMoreOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
    document.body.style.overflow = (isSidebarOpen || isMoreOpen) ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isSidebarOpen, isMoreOpen]);

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
          <div className="logo-icon">SS</div>
          <div>
            <div className="brand-name">SevaSuite</div>
            <div className="brand-tagline">India's NGO OS</div>
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
          {renderNavItems(NAV_ITEMS.filter(i => i.section === 'main'))}
          <div className="nav-section-label">{t('operations')}</div>
          {renderNavItems(NAV_ITEMS.filter(i => i.section === 'ops'))}
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
          <div style={{ flex: 1, margin: '0 2rem' }}>
            <IntentBar />
          </div>

          {/* Actions */}
          <div className="header-actions">
            <select
              value={lang}
              onChange={(e) => setLanguage(e.target.value as any)}
              style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 6px', fontSize: '0.8rem', color: 'var(--color-text-secondary)', outline: 'none', cursor: 'pointer' }}
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
          <Outlet />
        </div>
      </main>

      {/* ── Bottom Navigation (mobile) ───────────────────── */}
      <BottomNav onMoreClick={() => setIsMoreOpen(true)} />

      {/* ── "More" Bottom Sheet (mobile) ─────────────────── */}
      <div
        className={`more-sheet-overlay ${isMoreOpen ? 'open' : ''}`}
        onClick={() => setIsMoreOpen(false)}
        aria-hidden="true"
      />
      {isMoreOpen && (
        <div className="more-sheet" role="dialog" aria-label="More navigation options">
          <div className="more-sheet-handle" />
          <div className="more-sheet-title">More Modules</div>
          <div className="more-sheet-grid">
            {MORE_ITEMS.map(item => {
              const Icon = item.icon;
              const hasAccess = can(item.module, 'canView');
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `more-sheet-item ${isActive ? 'active' : ''} ${!hasAccess ? 'locked' : ''}`
                  }
                  onClick={e => {
                    if (!hasAccess) {
                      e.preventDefault();
                      toast(`🔒 ${item.label} is restricted.`, { duration: 2000 });
                    }
                    setIsMoreOpen(false);
                  }}
                >
                  <div className="more-sheet-icon">
                    <Icon size={20} color={hasAccess ? 'var(--color-primary)' : 'var(--color-text-tertiary)'} />
                  </div>
                  {item.label.split(' ')[0]}
                </NavLink>
              );
            })}
          </div>
        </div>
      )}

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
