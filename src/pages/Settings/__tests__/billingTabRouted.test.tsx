/**
 * Task #13 follow-up to the code-review comments: an integration test that
 * actually exercises the navigation path from the expired-trial banner
 * (which calls navigate('/settings?tab=billing')) into Settings, proving
 * end-to-end that the deep link lands on the Plans & Billing surface and
 * not on the default Profile tab.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../../components/Billing/PlansSection', () => ({
  default: () => <div data-testid="plans-section">PLANS</div>,
}));
vi.mock('../../../components/Settings/WhatsAppPortal', () => ({
  default: () => <div data-testid="whatsapp-portal">WA</div>,
}));
vi.mock('../../../components/Billing/ContextualUpgradePrompt', () => ({
  default: () => null,
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      name: 'A', email: 'a@x.org', ngoName: 'X', role: 'ed', token: 't',
      // Expired trial: started 60 days ago, ended 30 days ago. The banner
      // only renders for a real, expired trial — this satisfies that gate.
      trial: {
        startedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
        endsAt:    new Date(Date.now() - 30 * 86_400_000).toISOString(),
        tier: 'trial',
        nudges: {},
      },
      subscriptionTier: 'trial',
    },
    login: vi.fn(),
    updateUser: vi.fn(),
  }),
  ROLE_META: { ed: { label: 'ED', icon: '🧭', color: '#0F766E', bg: '#ccfbf1' } },
}));
vi.mock('../../../hooks/useTier', () => ({
  useTier: () => ({
    tier: 'starter',
    usage: { team: 1, beneficiaries: 0, reportsThisMonth: 0 },
    openUpgrade: vi.fn(),
  }),
  useUpgradeListener: () => {},
}));
vi.mock('../../../api/client', () => ({
  apiFetch: () => Promise.resolve({ ok: false, json: () => ({}) }),
}));

import Settings from '../Settings';
import TrialExpiredBanner from '../../../components/Onboarding/TrialExpiredBanner';

beforeEach(() => {
  cleanup();
  // BrowserRouter syncs with window.location, which Settings.initialTab
  // reads from. Reset to /dashboard so the banner mounts first.
  window.history.replaceState({}, '', '/dashboard');
});

describe('TrialExpiredBanner → /settings?tab=billing → Plans surface', () => {
  it('clicking "Choose a plan" lands on the Plans & Billing tab end-to-end', () => {
    render(
      <BrowserRouter>
        <Routes>
          <Route path="/dashboard" element={<TrialExpiredBanner />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </BrowserRouter>,
    );
    // The banner should render because the mocked user has an expired trial.
    const cta = screen.getByRole('button', { name: /choose a plan/i });
    fireEvent.click(cta);
    // After navigation, Settings mounts and the alias resolves billing → plans.
    expect(screen.getByTestId('plans-section')).toBeTruthy();
  });
});
