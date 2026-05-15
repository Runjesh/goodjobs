import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('RBAC — UI shell', () => {
  test('field role sees access restricted on /finance', async ({ page }) => {
    await login(page, 'field@indiango.org');
    await page.goto('/finance');
    await expect(page.getByRole('heading', { name: /Access Restricted/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Finance Officer or ED access/i)).toBeVisible();
  });
});
