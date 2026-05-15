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

    const directive = encodeURIComponent('Generate all pending receipts');
    const routeRes = await fetch(`${API}/intent/process?directive=${directive}`, {
      method: 'POST',
      headers,
    });
    expect(routeRes.ok).toBeTruthy();
    const routed = await routeRes.json();
    const queueId = routed.queue_id as string | undefined;
    expect(queueId).toBeTruthy();

    const decision = await fetch(`${API}/intent/queue/${queueId}/decision`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ decision: 'approved' }),
    });
    expect(decision.ok).toBeTruthy();

    const execute = await fetch(`${API}/intent/queue/${queueId}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ dry_run: false }),
    });
    expect([200, 202].includes(execute.status)).toBeTruthy();

    await login(page, 'admin@indiango.org');
    await page.goto('/agent-hq');
    await expect(page.getByText(/GoodJobs Copilot|Agent HQ/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
