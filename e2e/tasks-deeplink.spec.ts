import { expect, test } from '@playwright/test';

test.describe('Unified inbox deep link', () => {
  test('focus query does not white-screen', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Work Email').fill('admin@indiango.org');
    await page.getByLabel('Password').fill('demo1234');
    await page.getByRole('button', { name: /Sign In/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });

    await page.goto('/tasks?focus=unknown_kind%3Aref-999');
    await expect(page.getByText(/Unified inbox/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
