import { expect, test } from '@playwright/test';
import { dismissWelcomeIfPresent, login } from './helpers/auth';

/**
 * Black-box RC day — compatibility (mobile viewport + i18n).
 * FCRA boundaries and grant closure decision table are covered in pytest + grant-closure-gate.spec.ts.
 */
test.describe('Black-box RC — compatibility', () => {
  test('mobile Today shell renders without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await login(page, 'admin@indiango.org');
    await dismissWelcomeIfPresent(page);

    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientW = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollW).toBeLessThanOrEqual(clientW + 2);
  });

  test('Hindi interface language switch keeps main nav usable', async ({ page }) => {
    await login(page, 'admin@indiango.org');
    await dismissWelcomeIfPresent(page);

    await page.getByLabel('Interface language').selectOption('हिंदी (HI)');
    await expect(page.getByRole('navigation', { name: /Sidebar navigation/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'आज' })).toBeVisible();
  });
});
