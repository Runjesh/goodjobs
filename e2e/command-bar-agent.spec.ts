import { expect, test } from '@playwright/test';
import { dismissWelcomeIfPresent, login } from './helpers/auth';

/**
 * P1 — Header intention bar routes to agent proposal (command-bar path).
 */
test.describe('E2E — command bar agent', () => {
  test('intention bar processes directive and shows agent proposal', async ({ page }) => {
    await login(page, 'admin@indiango.org');
    await dismissWelcomeIfPresent(page);

    const input = page.getByPlaceholder(/Type an intention/i);
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.fill('Generate all pending receipts');
    await page.locator('form').filter({ has: input }).getByRole('button').last().click();

    await expect(
      page.getByText(/AGENT PROPOSAL|Added to Intent Queue/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});
