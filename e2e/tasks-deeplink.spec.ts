import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Unified inbox deep link', () => {
  test('focus query does not white-screen', async ({ page }) => {
    await login(page, 'admin@indiango.org');
    await page.goto('/tasks?focus=unknown_kind%3Aref-999');
    await expect(page.getByText(/Unified inbox/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
