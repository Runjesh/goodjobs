import { expect, test } from '@playwright/test';
import { apiToken, API, login } from './helpers/auth';

/**
 * Test 1 — Full donation lifecycle (API-backed checks; payment mocked via /public/donations).
 */
test.describe('E2E — donation lifecycle', () => {
  test('public donation creates CRM donor, finance tx, and 80G PDF endpoint', async ({ page }) => {
    const token = await apiToken('finance@indiango.org');
    const donorEmail = `e2e-donor-${Date.now()}@test.goodjobs.local`;
    const amount = 2500;

    const donateRes = await fetch(`${API}/public/donations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaign_slug: null,
        cause: 'General Fund',
        donor_name: 'E2E Donor',
        donor_email: donorEmail,
        pan: 'ABCDE1234F',
        amount,
        method: 'UPI',
        phone: '+919999999999',
        consent_impact_updates: true,
      }),
    });
    expect(donateRes.ok).toBeTruthy();
    const donateJson = await donateRes.json();
    const txId = donateJson?.transaction?.id;
    const donorId = donateJson?.transaction?.donorId;
    expect(txId).toBeTruthy();
    expect(donorId).toBeTruthy();

    const donorsRes = await fetch(`${API}/crm/donors`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(donorsRes.ok).toBeTruthy();
    const donors = (await donorsRes.json()).donors as { email?: string }[];
    expect(donors.some(d => (d.email || '').toLowerCase() === donorEmail.toLowerCase())).toBeTruthy();

    const pdfRes = await fetch(`${API}/crm/donors/${donorId}/80g/${txId}.pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get('content-type') || '').toMatch(/pdf/i);

    await login(page, 'admin@indiango.org');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (Morning|Afternoon|Evening)/i);
  });
});
