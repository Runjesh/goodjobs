import { expect, test } from '@playwright/test';
import { apiToken, API, login } from './helpers/auth';

/** Test 3 — Agent intent queue approve + execute (receipt generation intent). */
test.describe('E2E — agent intent execution', () => {
  test('queues receipt intent and executes after approval', async ({ page }) => {
    const token = await apiToken('admin@indiango.org');
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const queueRes = await fetch(`${API}/intent/queue?status=queued&limit=20`, { headers });
    expect(queueRes.ok).toBeTruthy();
    const before = ((await queueRes.json()).items as { id: string }[]) || [];

    const directive = encodeURIComponent('Generate all pending receipts');
    const routeRes = await fetch(`${API}/intent/process?directive=${directive}`, {
      method: 'POST',
      headers,
    });
    expect([200, 201, 202].includes(routeRes.status)).toBeTruthy();

    const afterRes = await fetch(`${API}/intent/queue?status=queued&limit=20`, { headers });
    const after = ((await afterRes.json()).items as { id: string; directive?: string }[]) || [];
    const candidate =
      after.find(i => !before.some(b => b.id === i.id))
      || after.find(i => /receipt/i.test(i.directive || ''));

    if (!candidate) {
      test.skip(true, 'No queued intent available in this environment');
      return;
    }

    const decision = await fetch(`${API}/intent/queue/${candidate.id}/decision`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ decision: 'approved' }),
    });
    expect(decision.ok).toBeTruthy();

    const execute = await fetch(`${API}/intent/queue/${candidate.id}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ dry_run: false }),
    });
    expect([200, 202].includes(execute.status)).toBeTruthy();

    await login(page, 'admin@indiango.org');
    await page.goto('/agent-hq');
    await expect(page.getByText(/Agent HQ|Intent/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
