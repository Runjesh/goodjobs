/**
 * Shared harness for the Task #14 onboarding-flow tests. Centralises:
 *
 *   - The vi.mock list that pares down Layout's heavy children (Sidebar
 *     widgets, modals, network hydration) without touching the wizard-gate
 *     effect or TrialPill — both of which the tests must exercise from
 *     production code, not a stub.
 *   - A `renderApp(initialPath)` helper that sets up BrowserRouter +
 *     AuthProvider + the three routes the flow walks across:
 *       /signup     → real Signup page
 *       /onboarding → real SignupWizard page
 *       /           → real Layout with an index Outlet child rendering a
 *                     `home-main` testid (proxy for the Today screen).
 *
 * Importing this module also installs the mocks (vi.mock side-effects), so
 * every test file just imports `renderApp` + RTL utilities from here.
 */

import React from 'react';
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';

// ─── Toast: no-op so Toaster doesn't pollute the DOM tree under test. ────
vi.mock('react-hot-toast', () => {
  const fn = vi.fn();
  return {
    default: Object.assign(fn, {
      success: fn, error: fn, loading: fn, dismiss: fn, custom: fn,
    }),
    Toaster: () => null,
    toast: Object.assign(fn, { success: fn, error: fn, loading: fn, dismiss: fn, custom: fn }),
  };
});

// ─── Wizard's fire-and-forget persistence helpers — stub network out. ────
vi.mock('../pages/Onboarding/wizardPersist', () => ({
  persistOrgProfile: vi.fn().mockResolvedValue(undefined),
  persistFirstProgram: vi.fn().mockResolvedValue(undefined),
  persistInvites: vi.fn().mockResolvedValue(undefined),
  persistBeneficiaries: vi.fn().mockResolvedValue(undefined),
  persistWhatsApp: vi.fn().mockResolvedValue(undefined),
}));

// ─── Layout's network hydration: short-circuit so no real fetches fly. ───
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    expectsRealBackend: () => false,
    apiFetch: vi.fn(async (path: string) => {
      if (String(path).includes('/auth/register')) {
        return new Response(JSON.stringify({
          access_token: 'test-jwt',
          user_id: 'user_test_flow',
          ngo_id: 'ngo_test_flow',
          email: 'anita@testfoundation.org',
          name: 'Anita Rao',
          role: 'ed',
          ngo_name: 'Test Foundation',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({}), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }),
  };
});
vi.mock('../utils/donorLifecycle', async () => {
  const actual = await vi.importActual<typeof import('../utils/donorLifecycle')>('../utils/donorLifecycle');
  return {
    ...actual,
    hydrateDonorLifecycles: vi.fn().mockResolvedValue(undefined),
    setLifecycleScope: vi.fn(),
  };
});

// ─── Heavy Layout children we don't need under test (sidebars, modals,
// command palette, banners). Stubbing keeps real Layout chrome + the
// wizard-gate effect intact while shaving ~5s off each test. ───────────
vi.mock('../components/CommandPalette/CommandPalette', () => ({
  default: () => null,
}));
vi.mock('../components/Layout/IntentBar', () => ({
  default: () => <div data-testid="intent-bar-stub" />,
}));
vi.mock('../components/Auth/UserChip', () => ({
  default: () => <div data-testid="user-chip-stub" />,
}));
vi.mock('../components/ui/BottomNav', () => ({
  default: () => null,
}));
vi.mock('../components/Notifications/NotificationCenter', () => ({
  default: () => null,
}));
vi.mock('../components/Onboarding/WelcomeModal', () => ({
  default: () => null,
}));
vi.mock('../components/Layout/DemoModePill', () => ({
  default: () => null,
}));
vi.mock('../components/Onboarding/TrialExpiredBanner', () => ({
  default: () => null,
}));
vi.mock('../components/Onboarding/TrialUpgradeModal', () => ({
  default: () => null,
}));
vi.mock('../components/Billing/PastDueBanner', () => ({
  default: () => null,
}));
vi.mock('../components/Billing/WelcomeBanner', () => ({
  default: () => null,
}));

// ─── Imports happen AFTER vi.mock so mocked deps are picked up. ──────────
import { AuthProvider } from '../context/AuthContext';
import Signup from '../pages/Auth/Signup';
import SignupWizard from '../pages/Onboarding/SignupWizard';
import Layout from '../components/Layout/Layout';

const HomeStub: React.FC = () => <div data-testid="home-main">Today screen</div>;

export function renderApp(initialPath: string = '/') {
  window.history.replaceState({}, '', initialPath);
  return render(
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/signup" element={<Signup />} />
          <Route path="/onboarding" element={<SignupWizard />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<HomeStub />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>,
  );
}

export { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
export { vi } from 'vitest';
