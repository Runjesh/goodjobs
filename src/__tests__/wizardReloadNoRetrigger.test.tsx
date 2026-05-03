/**
 * Task #14 — End-to-end test 2 of 3.
 *
 * Reload-after-finish: a user who already completed (or fully skipped)
 * the wizard must NOT be bounced back to /onboarding when they next land
 * on the app. This is the contract that broke in earlier iterations
 * where `needsWizard` lingered in localStorage.
 *
 * We seed the AuthProvider with a real user blob (needsWizard=false,
 * trial present) and mount the REAL Layout at "/". A regression in the
 * wizard-gate effect (e.g. dropping the `needsWizard` guard) would
 * redirect away from "/" and fail the testid assertion.
 */

import { describe, it, expect } from 'vitest';
import { renderApp, screen, act } from './_signupTrialHarness';
import { makeFreshTrial } from '../utils/trial';
import type { AuthUser } from '../context/AuthContext';

describe('finished wizard survives reload', () => {
  it('does not redirect to /onboarding when needsWizard is false', async () => {
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

    renderApp('/');

    // Real Layout mounts; the wizard-gate effect should NOT fire because
    // needsWizard is false. The Today proxy must still be in the DOM.
    await screen.findByTestId('home-main');
    expect(window.location.pathname).toBe('/');

    // Pill still renders — trial state is independent of the wizard flag.
    const pill = await screen.findByRole('button', { name: /Trial:.*day.*left/i });
    expect(pill).toBeInTheDocument();

    // Give Layout's useEffects a tick to (incorrectly) re-trigger.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(window.location.pathname).toBe('/');
  });
});
