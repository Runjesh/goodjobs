import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { makeFreshTrial, type TrialState, type SubscriptionTier } from '../utils/trial';

// ── Role Definitions ──────────────────────────────────────────────────────────
export type UserRole = 'ed' | 'finance' | 'programs' | 'field' | 'board';

export interface Permission {
  module: string;
  canView: boolean;
  canEdit: boolean;
  canExport: boolean;
  canApproveAgents: boolean;
}

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
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
  /** Org metadata captured at signup (cause area, team size, phone). */
  orgProfile?: {
    causeArea?: string;
    teamSize?: string;
    phone?: string;
  };
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

  const permissions = user ? ROLE_PERMISSIONS[user.role] : [];

  const login = useCallback((newUser: AuthUser) => {
    // Auto-attach a fresh 30-day trial state if this user has none yet — every
    // new tenant gets a trial whether they came in via /signup or demo login.
    const withTrial: AuthUser = newUser.trial
      ? newUser
      : { ...newUser, trial: makeFreshTrial() };
    setUser(withTrial);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(withTrial));
    // Back-compat for pages that read access_token directly
    localStorage.setItem('access_token', withTrial.token);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('access_token');
  }, []);

  const updateUser = useCallback((patch: Partial<AuthUser>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next: AuthUser = { ...prev, ...patch };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const can = useCallback((module: string, action: keyof Omit<Permission, 'module'>): boolean => {
    if (!user) return false;
    const perm = ROLE_PERMISSIONS[user.role].find(p => p.module === module);
    return perm ? perm[action] : false;
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, permissions, login, logout, can, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
