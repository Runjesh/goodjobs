/**
 * Task #14 — End-to-end coverage for the new-tenant onboarding flow.
 *
 * The signup → wizard → trial pill path ties together five surfaces that have
 * historically broken in isolation:
 *
 *   1. `/signup` → email verify → `login({ needsWizard: true, trial })`
 *   2. Layout's wizard-gate effect that pushes a `needsWizard` user to
 *      `/onboarding` from anywhere inside the app.
 *   3. SignupWizard's per-step "Skip for now" that records skipped steps but
 *      does NOT block forward progress.
 *   4. The wizard's last-step handoff which calls `finishWizard()` +
 *      `updateUser({ needsWizard: false })` and navigates home.
 *   5. TrialPill rendering in the header for any user with `trial` set whose
 *      tier is still trial/starter.
 *
 * These three tests pin the contract end-to-end:
 *   - Test 1 walks the full flow with the actual Signup + SignupWizard pages.
 *   - Test 2 proves a finished wizard does NOT re-trigger on reload.
 *   - Test 3 proves a demo login (which sets `trial` but NOT `needsWizard`)
 *     lands on home with the pill but is never bounced to `/onboarding`.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import {
  BrowserRouter,
  Routes,
  Route,
  Outlet,
  useNavigate,
  useLocation,
} from 'react-router-dom';

import { AuthProvider, useAuth, type AuthUser } from '../context/AuthContext';
import Signup from '../pages/Auth/Signup';
import SignupWizard from '../pages/Onboarding/SignupWizard';
import TrialPill from '../components/Layout/TrialPill';
import { makeFreshTrial } from '../utils/trial';

// ─── Toast: no-op so the portal doesn't pollute the DOM tree under test. ──
vi.mock('react-hot-toast', async () => {
  const actual = await vi.importActual<typeof import('react-hot-toast')>('react-hot-toast');
  const fn = vi.fn();
  return {
    ...actual,
    default: Object.assign(fn, {
      success: fn, error: fn, loading: fn, dismiss: fn, custom: fn,
    }),
    Toaster: () => null,
  };
});

// ─── Fire-and-forget wizard persistence helpers — stub network out. ───────
vi.mock('../pages/Onboarding/wizardPersist', () => ({
  persistOrgProfile: vi.fn().mockResolvedValue(undefined),
  persistFirstProgram: vi.fn().mockResolvedValue(undefined),
  persistInvites: vi.fn().mockResolvedValue(undefined),
  persistBeneficiaries: vi.fn().mockResolvedValue(undefined),
  persistWhatsApp: vi.fn().mockResolvedValue(undefined),
}));

// ─── Test stand-in for the real Layout. We only need the two behaviours
// the flow under test relies on: (a) the wizard-gate redirect for users
// with `needsWizard`, and (b) the TrialPill mounted in the header. The
// real Layout pulls in the entire Sidebar + dozens of widgets which are
// irrelevant to this contract and would slow the test by 5+ seconds.
const HomeShell: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (user?.needsWizard && location.pathname !== '/onboarding') {
      navigate('/onboarding', { replace: true });
    }
  }, [user?.needsWizard, location.pathname, navigate]);
  return (
    <div>
      <header data-testid="app-header">
        <TrialPill />
      </header>
      <main data-testid="home-main">Today screen</main>
      <Outlet />
    </div>
  );
};

const renderApp = () => render(
  <BrowserRouter>
    <AuthProvider>
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="/onboarding" element={<SignupWizard />} />
        <Route path="/" element={<HomeShell />} />
      </Routes>
    </AuthProvider>
  </BrowserRouter>,
);

beforeEach(() => {
  // BrowserRouter uses window.location; reset between tests.
  window.history.replaceState({}, '', '/');
});

// ─────────────────────────────────────────────────────────────────────────
// Test 1: Full flow — signup form → verify → wizard (5 skips) → pill on /
// ─────────────────────────────────────────────────────────────────────────

describe('signup → 5-step wizard → trial pill', () => {
  it('walks signup, skips every wizard step, and lands on / with the trial pill', async () => {
    window.history.replaceState({}, '', '/signup');
    renderApp();

    // 1. Form stage — fill required fields and submit.
    fireEvent.change(screen.getByLabelText(/NGO name/i), { target: { value: 'Test Foundation' } });
    fireEvent.change(screen.getByLabelText(/Your name/i),  { target: { value: 'Anita Rao' } });
    fireEvent.change(screen.getByLabelText(/Work email/i), { target: { value: 'anita@testfoundation.org' } });
    fireEvent.change(screen.getByLabelText(/Primary cause area/i), { target: { value: 'Education' } });
    fireEvent.change(screen.getByLabelText(/Team size/i),   { target: { value: '6–15 people' } });

    fireEvent.click(screen.getByRole('button', { name: /Create my account/i }));

    // 2. Verify stage — Signup uses a 700ms UX delay before swapping panels.
    const verifyBtn = await screen.findByRole(
      'button', { name: /I clicked the link/i },
      { timeout: 2000 },
    );
    fireEvent.click(verifyBtn);

    // 3. After 600ms verify + 800ms hand-off setTimeouts, navigation lands
    //    on /onboarding and the wizard renders Step 1 of 5 (Org profile).
    await screen.findByText(/Step 1 of 5/i, undefined, { timeout: 3000 });

    // 4. Skip every step. The "Skip for now" footer button is present on
    //    every step; the 5th click triggers finishWizard + navigate('/').
    for (let i = 1; i <= 5; i++) {
      const skip = await screen.findByRole('button', { name: /Skip for now/i });
      fireEvent.click(skip);
    }

    // 5. After the final skip, the wizard hands off to "/" and the
    //    TrialPill renders for the brand-new tenant.
    await screen.findByTestId('home-main', undefined, { timeout: 3000 });
    expect(window.location.pathname).toBe('/');

    const pill = await screen.findByRole('button', { name: /Trial:.*day.*left/i });
    expect(pill).toBeInTheDocument();

    // And the wizard-gate did NOT bounce us back: user.needsWizard is false.
    const stored = JSON.parse(localStorage.getItem('sevasuite_auth') ?? '{}') as AuthUser;
    expect(stored.needsWizard).toBe(false);
    expect(stored.trial).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Test 2: Reload after a finished wizard does NOT re-trigger /onboarding.
// ─────────────────────────────────────────────────────────────────────────

describe('finished wizard survives reload', () => {
  it('does not redirect to /onboarding when needsWizard is false', async () => {
    // Seed the AuthProvider with a user that has finished the wizard:
    // trial present, needsWizard explicitly false. This simulates a fresh
    // page load after the user has already been through onboarding.
    const seededUser: AuthUser = {
      id: 'user_finished_xyz',
      email: 'finished@testfoundation.org',
      name: 'Finished User',
      role: 'ed',
      ngoId: 'ngo_finished_xyz',
      ngoName: 'Test Foundation',
      token: 'tok-finished',
      avatar: '👤',
      needsWizard: false,
      trial: makeFreshTrial(),
    };
    localStorage.setItem('sevasuite_auth', JSON.stringify(seededUser));

    renderApp();

    // We render at "/", and HomeShell's wizard-gate effect should NOT fire
    // because needsWizard is false. The home main should stay mounted.
    await screen.findByTestId('home-main');
    expect(window.location.pathname).toBe('/');

    // Pill still renders — the trial state survives independently of the
    // wizard completion flag.
    const pill = screen.getByRole('button', { name: /Trial:.*day.*left/i });
    expect(pill).toBeInTheDocument();

    // Give the wizard-gate effect a tick to (incorrectly) re-trigger. If
    // anything queued a redirect, this microtask flush would surface it.
    await act(async () => { await Promise.resolve(); });
    expect(window.location.pathname).toBe('/');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Test 3: Demo-login users see the pill, but never get bounced to wizard.
// ─────────────────────────────────────────────────────────────────────────

describe('demo login → trial pill but no wizard', () => {
  it('a demo-login user (trial set, needsWizard absent) renders the pill on /', async () => {
    // Mirror what Login.doLogin() builds: trial present, no needsWizard
    // flag at all. The wizard-gate must treat this as "skip the wizard".
    const demoUser: AuthUser = {
      id: 'user_demo_ed',
      email: 'demo.ed@indiatrust.org',
      name: 'Demo ED',
      role: 'ed',
      ngoId: 'ngo_001',
      ngoName: 'India NGO Trust',
      token: 'demo-jwt-ed',
      avatar: '👤',
      // needsWizard intentionally omitted (this is the bug-prone state).
      trial: makeFreshTrial(),
    };
    localStorage.setItem('sevasuite_auth', JSON.stringify(demoUser));

    renderApp();

    // Home should mount immediately — no wizard redirect.
    await screen.findByTestId('home-main');
    expect(window.location.pathname).toBe('/');

    // The trial pill is visible in the header.
    expect(screen.getByRole('button', { name: /Trial:.*day.*left/i })).toBeInTheDocument();

    // Sanity: even after a microtask flush the URL hasn't drifted.
    await act(async () => { await Promise.resolve(); });
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByText(/Step 1 of 5/i)).not.toBeInTheDocument();
  });
});
