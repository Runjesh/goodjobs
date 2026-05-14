/**
 * Task #14 — End-to-end test 3 of 3.
 *
 * Demo logins (Login.tsx → handleDemoLogin) deliberately set `trial` so
 * the showcase UI renders, but they do NOT set `needsWizard`. The
 * contract: those users see the TrialPill on home and are NEVER bounced
 * to /onboarding by Layout's wizard-gate.
 *
 * This test seeds the canonical demo-user blob into localStorage and
 * mounts the REAL Layout at "/", proving the wizard-gate effect treats
 * `needsWizard === undefined` exactly like `false`. A regression that
 * accidentally truthy-checks the absence of the flag (e.g. swapping
 * `user?.needsWizard` for `user?.needsWizard !== false`) would fail
 * here.
 */

import { describe, it, expect } from 'vitest';
import { renderApp, screen, act } from './_signupTrialHarness';
import { makeFreshTrial } from '../utils/trial';
import type { AuthUser } from '../context/AuthContext';

describe('demo login → trial pill but no wizard', () => {
  it('a demo-login user (trial set, needsWizard absent) renders the pill on /', async () => {
    // Mirror what Login.doLogin() builds for a demo ED account.
    const demoUser: AuthUser = {
      id: 'user_demo_ed',
      email: 'demo.ed@indiatrust.org',
      name: 'Demo ED',
      role: 'ed',
      ngoId: 'ngo_001',
      ngoName: 'India NGO Trust',
      token: 'demo-jwt-ed',
      avatar: '👤',
      // needsWizard intentionally omitted — this is the bug-prone state.
      trial: makeFreshTrial(),
    };
    localStorage.setItem('sevasuite_auth', JSON.stringify(demoUser));

    renderApp('/');

    // Real Layout mounts at / — no wizard redirect.
    await screen.findByTestId('home-main');
    expect(window.location.pathname).toBe('/');

    // Trial pill is in the header.
    expect(await screen.findByRole('button', { name: /Trial:.*day.*left/i })).toBeInTheDocument();

    // Wizard chrome (e.g. "Step 1 of 5") must NOT have rendered.
    expect(screen.queryByText(/Step 1 of 5/i)).not.toBeInTheDocument();

    // Sanity: even after a microtask flush the URL hasn't drifted.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(window.location.pathname).toBe('/');
  });
});
