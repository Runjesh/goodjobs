import { expect, test } from '@playwright/test';
import { apiToken, API, dismissWelcomeIfPresent, login } from './helpers/auth';

/**
 * P1 — Compliance renewal workspace ↔ Tasks sync.
 */
test.describe('E2E — compliance renewal', () => {
  test('renewal workspace opens from deep link and checklist syncs to Tasks', async ({ page }) => {
    const token = await apiToken('admin@indiango.org');
    const expiry = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

    const createRes = await fetch(`${API}/compliance/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'E2E FCRA Registration',
        doc_type: 'FCRA',
        status: 'Expiring Soon',
        expiry_date: expiry,
      }),
    });
    expect(createRes.ok).toBeTruthy();
    const created = await createRes.json();
    const docId = String(created.id);
    expect(docId).toBeTruthy();

    await login(page, 'admin@indiango.org');
    await dismissWelcomeIfPresent(page);
    await page.goto(`/compliance?alert=true&doc=${encodeURIComponent(docId)}`);

    await expect(page.getByRole('heading', { name: /Renewal workspace/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Checklist · synced to Tasks/i)).toBeVisible();

    const firstStepToggle = page.locator('.renewal-step-row .step-toggle').first();
    await firstStepToggle.click();
    await expect(page.getByText(/Step marked done/i)).toBeVisible({ timeout: 5_000 });

    await page.goto('/tasks');
    await expect(page.getByText(/Renewal:/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
