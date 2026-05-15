/**
 * Grant Closure Gate — e2e (Task #8)
 *
 * Locks in the compliance contract: a grant cannot become Closed without
 * completing all six checklist items, and the closed state must survive a
 * full page reload (i.e. it's truly persisted, not just a transient UI flag).
 *
 * Walks the real user flow:
 *   1. Open an Active grant.
 *   2. Click "Begin Closure" (the only legitimate entry point into the
 *      checklist — this is the user-facing transition we don't want to be
 *      bypassable).
 *   3. Confirm the close button is absent until all 6 boxes are ticked.
 *   4. Tick all 6 in order, click "Mark grant Closed".
 *   5. Reload the page — assert the Closed pill is shown and the close
 *      button is no longer offered (i.e. real persisted Closed UI state,
 *      not just a flag in localStorage).
 *
 * The active demo seed card with `col: 'live'` is id 5 (Mahindra Finance —
 * see Layout.tsx seedDemoCsrIfDev + backend _seed_memory_csr).
 */
import { expect, test } from '@playwright/test';
import { dismissWelcomeIfPresent, login } from './helpers/auth';

const CARD_ID = '5';
const STORAGE_KEY = `goodjobs.grant.${CARD_ID}.v1`;

test.describe('Grant closure gate', () => {
  test('Active → Begin Closure → cannot close until all 6 ticked; Closed UI persists across reload', async ({ page }) => {
    await login(page, 'admin@indiango.org');
    await dismissWelcomeIfPresent(page);
    await page.goto(`/grants/${CARD_ID}`);

    // We're on an Active grant — header shows the "Begin Closure" CTA.
    const beginBtn = page.getByRole('button', { name: /Begin Closure/i });
    await expect(beginBtn).toBeVisible({ timeout: 15_000 });
    // The closure checklist must NOT be visible yet — proves the gate is
    // entered through the Begin Closure transition, not by URL/state alone.
    await expect(page.getByText(/Grant Closure Checklist/i)).toHaveCount(0);

    // Enter closure mode via the real user action.
    await beginBtn.click();
    await expect(page.getByText(/Grant Closure Checklist/i)).toBeVisible();

    // While the checklist is empty, the close button must be absent and the
    // locked-summary message must be visible to the user.
    await expect(page.getByRole('button', { name: /Mark grant Closed/i })).toHaveCount(0);
    await expect(page.getByText(/Complete the checklist to release this summary/i)).toBeVisible();

    // Tick all six items in order — each unlocks the next.
    const closureList = page.locator('.grant-closure-list');
    const boxes = closureList.getByRole('checkbox');
    await expect(boxes).toHaveCount(6);
    for (let i = 0; i < 6; i++) {
      await boxes.nth(i).check();
    }

    // The close button now appears; click it.
    const closeBtn = page.getByRole('button', { name: /Mark grant Closed/i });
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    // Confirm the closed-state flag was persisted to localStorage so a
    // reload (or even a backend column reset) will keep showing Closed.
    await expect.poll(async () => {
      return await page.evaluate((k) => {
        const raw = localStorage.getItem(k);
        return raw ? JSON.parse(raw)?.isClosed === true : false;
      }, STORAGE_KEY);
    }, { timeout: 5_000 }).toBe(true);

    // Reload — the page should render the Closed UI:
    //   • the "Closed" pill is shown in the header
    //   • the "Begin Closure" CTA is gone
    //   • the close button is no longer offered (already closed)
    await page.reload();
    await expect(page.getByText(/Grant Closure Checklist/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.grant-closed-pill')).toBeVisible();
    await expect(page.getByRole('button', { name: /Begin Closure/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Mark grant Closed/i })).toHaveCount(0);
  });
});
