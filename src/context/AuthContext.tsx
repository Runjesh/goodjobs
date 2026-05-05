import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { makeFreshTrial, loadOrgBilling, saveOrgBilling, type TrialState, type SubscriptionTier, type BillingState } from '../utils/trial';

// ── Role Definitions ──────────────────────────────────────────────────────────
export type UserRole = 'ed' | 'finance' | 'programs' | 'field' | 'board';

export interface Permission {
  module: string;
  canView: boolean;
  canEdit: boolean;
  canExport: boolean;
  canApproveAgents: boolean;
}

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  ed: [
    { module: 'dashboard',   canView: true,  canEdit: true,  canExport: true,  canApproveAgents: true },
    { module: 'tasks',       canView: true,  canEdit: true,  canExport: true,  canApproveAgents: true },
    { module: 'fundraising', canView: true,  canEdit: true,  canExport: true,  canApproveAgents: true },
    { module: 'crm',         canView: true,  canEdit: true,  canExport: true,  canApproveAgents: true },
    { module: 'finance',     canView: true,  canEdit: true,  canExport: true,  canApproveAgents: true },
    { module: 'programs',    canView: true,  canEdit: true,  canExport: true,  canApproveAgents: true },
    { module: 'csr',         canView: true,  canEdit: true,  canExport: true,  canApproveAgents: true },
    { module: 'volunteers',  canView: true,  canEdit: true,  canExport: true,  canApproveAgents: true },
    { module: 'compliance',  canView: true,  canEdit: true,  canExport: true,  canApproveAgents: true },
    { module: 'agent-hq',    canView: true,  canEdit: true,  canExport: true,  canApproveAgents: true },
    { module: 'settings',    canView: true,  canEdit: true,  canExport: true,  canApproveAgents: true },
    { module: 'funding',     canView: true,  canEdit: true,  canExport: true,  canApproveAgents: true },
    { module: 'insights',    canView: true,  canEdit: true,  canExport: true,  canApproveAgents: true },
    { module: 'reports',     canView: true,  canEdit: true,  canExport: true,  canApproveAgents: true },
  ],
  finance: [
    { module: 'dashboard',   canView: true,  canEdit: false, canExport: true,  canApproveAgents: false },
    { module: 'tasks',       canView: true,  canEdit: false, canExport: true,  canApproveAgents: false },
    { module: 'fundraising', canView: true,  canEdit: true,  canExport: true,  canApproveAgents: false },
    { module: 'crm',         canView: true,  canEdit: false, canExport: true,  canApproveAgents: false },
    { module: 'finance',     canView: true,  canEdit: true,  canExport: true,  canApproveAgents: true },
    { module: 'programs',    canView: true,  canEdit: false, canExport: true,  canApproveAgents: false },
    { module: 'csr',         canView: true,  canEdit: false, canExport: true,  canApproveAgents: false },
    { module: 'volunteers',  canView: false, canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'compliance',  canView: true,  canEdit: true,  canExport: true,  canApproveAgents: false },
    { module: 'agent-hq',    canView: true,  canEdit: false, canExport: false, canApproveAgents: true },
    { module: 'settings',    canView: false, canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'funding',     canView: true,  canEdit: true,  canExport: true,  canApproveAgents: false },
    { module: 'insights',    canView: true,  canEdit: false, canExport: true,  canApproveAgents: false },
    { module: 'reports',     canView: true,  canEdit: true,  canExport: true,  canApproveAgents: false },
  ],
  programs: [
    { module: 'dashboard',   canView: true,  canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'tasks',       canView: true,  canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'fundraising', canView: true,  canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'crm',         canView: true,  canEdit: true,  canExport: false, canApproveAgents: false },
    { module: 'finance',     canView: false, canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'programs',    canView: true,  canEdit: true,  canExport: true,  canApproveAgents: true },
    { module: 'csr',         canView: true,  canEdit: true,  canExport: false, canApproveAgents: false },
    { module: 'volunteers',  canView: true,  canEdit: true,  canExport: true,  canApproveAgents: false },
    { module: 'compliance',  canView: true,  canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'agent-hq',    canView: true,  canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'settings',    canView: false, canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'funding',     canView: true,  canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'insights',    canView: true,  canEdit: true,  canExport: true,  canApproveAgents: false },
    { module: 'reports',     canView: true,  canEdit: true,  canExport: true,  canApproveAgents: false },
  ],
  field: [
    { module: 'dashboard',   canView: true,  canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'tasks',       canView: true,  canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'fundraising', canView: false, canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'crm',         canView: false, canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'finance',     canView: false, canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'programs',    canView: true,  canEdit: true,  canExport: false, canApproveAgents: false },
    { module: 'csr',         canView: false, canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'volunteers',  canView: true,  canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'compliance',  canView: false, canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'agent-hq',    canView: false, canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'settings',    canView: false, canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'funding',     canView: false, canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'insights',    canView: false, canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'reports',     canView: false, canEdit: false, canExport: false, canApproveAgents: false },
  ],
  board: [
    { module: 'dashboard',   canView: true,  canEdit: false, canExport: true,  canApproveAgents: false },
    { module: 'tasks',       canView: true,  canEdit: false, canExport: true,  canApproveAgents: false },
    { module: 'fundraising', canView: true,  canEdit: false, canExport: true,  canApproveAgents: false },
    { module: 'crm',         canView: false, canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'finance',     canView: true,  canEdit: false, canExport: true,  canApproveAgents: false },
    { module: 'programs',    canView: true,  canEdit: false, canExport: true,  canApproveAgents: false },
    { module: 'csr',         canView: true,  canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'volunteers',  canView: false, canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'compliance',  canView: true,  canEdit: false, canExport: true,  canApproveAgents: false },
    { module: 'agent-hq',    canView: true,  canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'settings',    canView: false, canEdit: false, canExport: false, canApproveAgents: false },
    { module: 'funding',     canView: true,  canEdit: false, canExport: true,  canApproveAgents: false },
    { module: 'insights',    canView: true,  canEdit: false, canExport: true,  canApproveAgents: false },
    { module: 'reports',     canView: true,  canEdit: false, canExport: true,  canApproveAgents: false },
  ],
};

export const ROLE_META: Record<UserRole, { label: string; icon: string; color: string; bg: string }> = {
  ed:       { label: 'Executive Director', icon: '👤', color: '#0F766E', bg: '#ccfbf1' },
  finance:  { label: 'Finance Officer',    icon: '💼', color: '#0891b2', bg: '#e0f2fe' },
  programs: { label: 'Program Manager',   icon: '📋', color: '#059669', bg: '#d1fae5' },
  field:    { label: 'Field Staff',        icon: '🗺️', color: '#d97706', bg: '#fef3c7' },
  board:    { label: 'Board Member',       icon: '🏛️', color: '#7c3aed', bg: '#f3e8ff' },
};

// ── Types ─────────────────────────────────────────────────────────────────────
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  ngoId: string;
  ngoName: string;
  token: string;
  avatar: string;
  /** True only on the very first login after `/signup`; cleared once wizard exits. */
  needsWizard?: boolean;
  /** 30-day trial state — present for newly-signed-up tenants. */
  trial?: TrialState;
  /** Persisted subscription tier when user has chosen one (Task #5). */
  subscriptionTier?: SubscriptionTier;
  /** Paid-subscription billing state (status, period end, past-due tracking). */
  billing?: BillingState;
  /** Org metadata captured at signup (cause area, team size, phone). */
  orgProfile?: {
    causeArea?: string;
    teamSize?: string;
    phone?: string;
    /** Optional org logo (data URL) captured in the wizard. */
    logoDataUrl?: string;
    registrationNumber?: string;
    section80GNumber?: string;
    fcraStatus?: 'none' | 'pending' | 'active';
  };
  /** Team members invited from the wizard (mock — no backend send yet). */
  pendingInvites?: { email: string; role: string; invitedAt: string }[];
  /** WhatsApp phone wired up during onboarding. */
  whatsapp?: { phone?: string; verified?: boolean; connectedAt?: string };
  /**
   * Dashboard preset (Session 3): re-orders Today cards and hides modules
   * irrelevant to the chosen working mode. Independent of `role` (which still
   * drives module-level permissions); a Programme Manager can temporarily
   * switch their dashboard to a Field Officer view without changing what they
   * can access.
   */
  dashboardPreset?: DashboardPreset;
}

// ── Dashboard presets (Session 3) ─────────────────────────────────────────────
export type DashboardPreset = 'field' | 'programs' | 'ed';

export const DASHBOARD_PRESETS: { id: DashboardPreset; label: string; description: string; icon: string }[] = [
  { id: 'field',    label: 'Field Officer',       description: 'Today, programs and tasks first. Hides finance & funding.', icon: '🗺️' },
  { id: 'programs', label: 'Programme Manager',   description: 'Programs, beneficiaries and insights up top.',                icon: '📋' },
  { id: 'ed',       label: 'Executive Director',  description: 'Funding, compliance and full org view.',                      icon: '👤' },
];

/** Map a user's permission role to a sensible default dashboard preset. */
export function defaultPresetForRole(role: UserRole): DashboardPreset {
  switch (role) {
    case 'field':    return 'field';
    case 'programs': return 'programs';
    case 'finance':
    case 'board':
    case 'ed':
    default:         return 'ed';
  }
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  permissions: Permission[];
  login: (user: AuthUser) => void;
  logout: () => void;
  can: (module: string, action: keyof Omit<Permission, 'module'>) => boolean;
  /** Patch the active user (persists to storage). No-op if no user is logged in. */
  updateUser: (patch: Partial<AuthUser>) => void;
  /** Session-only demo role override — does not persist to localStorage. */
  demoRole: UserRole | null;
  setDemoRole: (role: UserRole | null) => void;
  /**
   * The effective role for the current session. Use this everywhere instead of
   * `user.role` directly so demo role-switch overrides apply across the whole app.
   */
  currentRole: UserRole;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'sevasuite_auth';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const [demoRole, setDemoRole] = useState<UserRole | null>(null);

  const permissions = user ? ROLE_PERMISSIONS[demoRole ?? user.role] : [];

  const login = useCallback((newUser: AuthUser) => {
    // Trial + subscriptionTier belong to the *org*, not the individual user.
    // Look up any persisted billing for this ngoId so trial timing survives
    // logout/login (a user cannot reset their trial by signing back in).
    //
    // Trial issuance rules (do NOT auto-mint for legacy/real-tenant logins):
    //   1. If the caller explicitly supplies `trial`, honour it (signup flow,
    //      demo logins that opt-in to the showcase experience).
    //   2. Otherwise use any stored org billing.
    //   3. Otherwise leave trial undefined — pre-existing tenants without a
    //      trial record do NOT silently receive one.
    const stored = loadOrgBilling(newUser.ngoId);

    const trial: TrialState | undefined =
      newUser.trial ?? stored?.trial;
    const subscriptionTier: SubscriptionTier | undefined =
      newUser.subscriptionTier ?? stored?.subscriptionTier;
    const billing: BillingState | undefined =
      newUser.billing ?? stored?.billing;

    const merged: AuthUser = { ...newUser, trial, subscriptionTier, billing };

    // Only persist org billing when there's actually something to persist.
    if (trial || subscriptionTier || billing) {
      saveOrgBilling(newUser.ngoId, { trial, subscriptionTier, billing });
    }

    setUser(merged);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    // Back-compat for pages that read access_token directly
    localStorage.setItem('access_token', merged.token);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setDemoRole(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('access_token');
  }, []);

  const updateUser = useCallback((patch: Partial<AuthUser>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next: AuthUser = { ...prev, ...patch };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      // Mirror billing-related fields to per-org storage so trial state and
      // tier choices survive logout/login and propagate to other roles.
      if ('trial' in patch || 'subscriptionTier' in patch || 'billing' in patch) {
        saveOrgBilling(next.ngoId, {
          trial: next.trial,
          subscriptionTier: next.subscriptionTier,
          billing: next.billing,
        });
      }
      return next;
    });
  }, []);

  const can = useCallback((module: string, action: keyof Omit<Permission, 'module'>): boolean => {
    if (!user) return false;
    const effectiveRole = demoRole ?? user.role;
    const perm = ROLE_PERMISSIONS[effectiveRole].find(p => p.module === module);
    return perm ? perm[action] : false;
  }, [user, demoRole]);

  const currentRole: UserRole = user ? (demoRole ?? user.role) : 'ed';

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, permissions, login, logout, can, updateUser, demoRole, setDemoRole, currentRole }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
