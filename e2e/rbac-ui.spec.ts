import { expect, test } from '@playwright/test';

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Work Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /Sign In/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

test.describe('RBAC — UI shell', () => {
  test('field role sees access restricted on /finance', async ({ page }) => {
    await login(page, 'field@indiango.org', 'demo1234');
    await page.goto('/finance');
    await expect(page.getByRole('heading', { name: /Access Restricted/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/does not have permission/i)).toBeVisible();
  });
});
