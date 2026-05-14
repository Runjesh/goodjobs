import { expect, test } from '@playwright/test';

test.describe('Auth — backend login', () => {
  test('demo ED credentials reach dashboard without role picker', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Work Email').fill('admin@indiango.org');
    await page.getByLabel('Password').fill('demo1234');
    await page.getByRole('button', { name: /Sign In/i }).click();

    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good Morning/i, {
      timeout: 15_000,
    });
  });
});
