import { expect, test } from '@playwright/test';
import { apiToken, API } from './helpers/auth';

/** Test 2 — FCRA 20% administrative overhead cap (backend enforcement). */
test.describe('E2E — FCRA budget guardrail', () => {
  test('rejects FCRA admin expense that breaches 20% cap', async () => {
    const token = await apiToken('finance@indiango.org');
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    await fetch(`${API}/finance/journal-entry`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        description: 'FCRA foreign income seed',
        amount: 1_000_000,
        entry_type: 'Income',
        fund: 'FCRA',
      }),
    });

    await fetch(`${API}/finance/journal-entry`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        description: 'FCRA admin spend seed',
        amount: 180_000,
        entry_type: 'Expense',
        fund: 'FCRA',
        is_admin_overhead: true,
        category: 'Administrative',
      }),
    });

    const breach = await fetch(`${API}/finance/journal-entry`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        description: 'FCRA admin breach attempt',
        amount: 100_000,
        entry_type: 'Expense',
        fund: 'FCRA',
        is_admin_overhead: true,
        category: 'Administrative',
      }),
    });

    expect(breach.status).toBe(400);
    const body = await breach.json();
    const detail = body.detail;
    if (typeof detail === 'object' && detail) {
      expect(detail.code).toBe('fcra_admin_cap_exceeded');
    }
  });
});
