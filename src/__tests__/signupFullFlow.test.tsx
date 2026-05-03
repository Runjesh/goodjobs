/**
 * Task #14 — End-to-end test 1 of 3.
 *
 * Walks the brand-new-tenant happy path with the REAL Signup, SignupWizard
 * and Layout components: signup form → email verify → wizard renders →
 * "Skip for now" five times → home with the trial pill.
 *
 * Why this shape:
 *   - Layout's `useEffect` wizard-gate is the redirect this whole flow
 *     pivots on; mounting the real Layout means a regression in that
 *     effect (the exact risk the task calls out) actually fails the test.
 *   - Skipping every step covers the wizard's "advance without commit"
 *     code path AND the last-step handoff (`finishWizard` +
 *     `updateUser({ needsWizard: false })` + navigate to "/").
 *   - The TrialPill assertion proves the trial state survived the wizard
 *     hand-off — easy to break by clobbering `user.trial` on finish.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderApp, screen, fireEvent } from './_signupTrialHarness';
import type { AuthUser } from '../context/AuthContext';

beforeEach(() => {
  // Each test starts with a clean window.location too (in addition to
  // the localStorage clear from src/test/setup.ts).
  window.history.replaceState({}, '', '/');
});

describe('signup → 5-step wizard → trial pill (full flow)', () => {
  it('walks signup, skips every wizard step, and lands on / with the trial pill', async () => {
    renderApp('/signup');

    // 1. Form stage — fill required fields and submit.
    fireEvent.change(screen.getByLabelText(/NGO name/i),         { target: { value: 'Test Foundation' } });
    fireEvent.change(screen.getByLabelText(/Your name/i),         { target: { value: 'Anita Rao' } });
    fireEvent.change(screen.getByLabelText(/Work email/i),        { target: { value: 'anita@testfoundation.org' } });
    fireEvent.change(screen.getByLabelText(/Primary cause area/i),{ target: { value: 'Education' } });
    fireEvent.change(screen.getByLabelText(/Team size/i),         { target: { value: '6–15 people' } });

    fireEvent.click(screen.getByRole('button', { name: /Create my account/i }));

    // 2. Verify stage — Signup uses a 700ms UX delay before swapping panels.
    const verifyBtn = await screen.findByRole(
      'button', { name: /I clicked the link/i }, { timeout: 2000 },
    );
    fireEvent.click(verifyBtn);

    // 3. After 600ms verify + 800ms hand-off setTimeouts, navigation lands
    //    on /onboarding and the wizard renders Step 1 of 5 (Org profile).
    await screen.findByText(/Step 1 of 5/i, undefined, { timeout: 3000 });
    expect(window.location.pathname).toBe('/onboarding');

    // 4. Skip every step. The "Skip for now" footer button is on every
    //    step; the 5th click triggers finishWizard + navigate('/').
    for (let i = 1; i <= 5; i++) {
      const skip = await screen.findByRole('button', { name: /Skip for now/i });
      fireEvent.click(skip);
    }

    // 5. After the final skip, the wizard hands off to "/" and the
    //    real Layout renders the TrialPill in its header.
    await screen.findByTestId('home-main', undefined, { timeout: 3000 });
    expect(window.location.pathname).toBe('/');

    const pill = await screen.findByRole('button', { name: /Trial:.*day.*left/i });
    expect(pill).toBeInTheDocument();

    // And the wizard-gate did NOT bounce us back: needsWizard cleared.
    const stored = JSON.parse(localStorage.getItem('sevasuite_auth') ?? '{}') as AuthUser;
    expect(stored.needsWizard).toBe(false);
    expect(stored.trial).toBeDefined();
  });
});
