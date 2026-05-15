import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Auth — backend login', () => {
  test('demo ED credentials reach dashboard without role picker', async ({ page }) => {
    await login(page, 'admin@indiango.org');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (Morning|Afternoon|Evening)/i, {
      timeout: 15_000,
    });
  });
});
