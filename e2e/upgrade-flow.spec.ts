import { expect, test } from '@playwright/test';

// End-to-end: a Starter user upgrades to Growth via the Plans modal. With no
// VITE_RAZORPAY_KEY_ID configured (the dev default) the Razorpay client falls
// back to a mock that resolves onSuccess after ~250 ms, which lets us drive
// the full UI path without hitting real checkout.
//
// We pre-seed the auth blob via addInitScript instead of going through /login
// so the spec stays focused on the upgrade flow and isn't coupled to backend
// auth wiring. This mirrors the keys AuthContext / useTier read at runtime
// (sevasuite_auth + gj_org_billing_v1) so the persistence assertions below
// match what production code writes.
const NGO_ID = 'ngo_e2e_upgrade';

const seedStarterUser = async (page: import('@playwright/test').Page) => {
  await page.addInitScript((ngoId) => {
    const user = {
      id: 'user_e2e_upgrade',
      email: 'upgrade@e2e.org',
      name: 'E2E Upgrade',
      role: 'ed',
      ngoId,
      ngoName: 'E2E NGO',
      token: 'e2e-jwt-upgrade',
      avatar: '👤',
      subscriptionTier: 'starter',
    };
    localStorage.setItem('sevasuite_auth', JSON.stringify(user));
    localStorage.setItem('access_token', user.token);
    // Suppress the first-login welcome modal so it doesn't intercept clicks
    // on the Plans modal CTAs.
    localStorage.setItem('gj_welcomed_v1', JSON.stringify({ [user.id]: Date.now() }));
    // Wipe any prior org billing for this ngoId so we start clean.
    localStorage.removeItem('gj_org_billing_v1');
  }, NGO_ID);
};

test.describe('Upgrade flow', () => {
  test('Starter → Growth via mock checkout persists tier in localStorage', async ({ page }) => {
    await seedStarterUser(page);
    await page.goto('/settings?tab=plans');

    // Open the comparison modal.
    const compareBtn = page.getByRole('button', { name: /Compare plans/i });
    await expect(compareBtn).toBeVisible({ timeout: 15_000 });
    await compareBtn.click();

    // Pick Growth (monthly is the default cycle).
    const growthCta = page.getByRole('button', { name: /Choose Growth/i });
    await expect(growthCta).toBeVisible({ timeout: 10_000 });
    await growthCta.click();

    // Mock Razorpay resolves after ~250 ms — poll the persisted auth blob
    // rather than racing on the success toast.
    await expect.poll(
      async () => {
        return await page.evaluate(() => {
          const raw = localStorage.getItem('sevasuite_auth');
          if (!raw) return null;
          try {
            const u = JSON.parse(raw);
            return {
              tier: u.subscriptionTier,
              status: u.billing?.status,
              cycle: u.billing?.billingCycle,
            };
          } catch {
            return null;
          }
        });
      },
      { timeout: 10_000, intervals: [200, 400, 800] },
    ).toEqual({ tier: 'growth', status: 'active', cycle: 'monthly' });

    // Per-org billing mirror should also reflect the upgrade so it survives
    // a logout/login cycle (the contract that AuthContext.updateUser ships).
    const orgBilling = await page.evaluate((ngoId) => {
      const raw = localStorage.getItem('gj_org_billing_v1');
      return raw ? JSON.parse(raw)?.[ngoId] : null;
    }, NGO_ID);
    expect(orgBilling?.subscriptionTier).toBe('growth');
    expect(orgBilling?.billing?.status).toBe('active');
    expect(orgBilling?.billing?.billingCycle).toBe('monthly');
  });
});
