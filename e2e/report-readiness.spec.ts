import { expect, test } from '@playwright/test';
import { dismissWelcomeIfPresent, login } from './helpers/auth';

/**
 * P1 — Report readiness fix CTA navigates to the linked module.
 */
test.describe('E2E — report readiness', () => {
  test('readiness fix button opens Programs for missing outcomes data', async ({ page }) => {
    await login(page, 'admin@indiango.org');
    await dismissWelcomeIfPresent(page);
    await page.goto('/reports');

    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible({ timeout: 15_000 });
    await page.locator('.reports-workflow-select select').selectOption('5');

    const fixBtn = page.getByRole('button', { name: /Record outcomes/i });
    await expect(fixBtn).toBeVisible({ timeout: 10_000 });
    await fixBtn.click();

    await expect(page).toHaveURL(/\/programs/, { timeout: 10_000 });
  });
});
