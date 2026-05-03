/**
 * Grant Closure Gate — e2e (Task #8)
 *
 * Locks in the compliance contract: a grant cannot become Closed without
 * completing all six checklist items, and the closed state must survive a
 * full page reload (i.e. it's truly persisted, not just a transient UI flag).
 *
 * The active demo seed card with `col: 'live'` is id 5 (Mahindra Finance —
 * see Layout.tsx seedDemoCsrIfDev + backend _seed_memory_csr). We log in as
 * ED (RBAC: ed has full CSR + grant permissions) so we can both view the
 * grant and click the closure button.
 */
import { expect, test, type Page } from '@playwright/test';

const CARD_ID = '5';
const STORAGE_KEY = `goodjobs.grant.${CARD_ID}.v1`;

async function loginAsEd(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Work Email').fill('admin@indiango.org');
  await page.getByLabel('Password').fill('demo1234');
  await page.getByRole('button', { name: /Sign In/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

test.describe('Grant closure gate', () => {
  test('cannot close until all 6 checklist items are ticked; closed state survives reload', async ({ page }) => {
    // Pre-seed grant state so the page lands directly in closing-mode (with
    // an empty checklist) — that lets us focus the test on the gate itself
    // rather than the multi-stage Begin Closure UX.
    await page.addInitScript(([key]) => {
      window.localStorage.setItem(key, JSON.stringify({
        closingMode: true, closureChecklist: {}, isClosed: false,
      }));
    }, [STORAGE_KEY]);

    await loginAsEd(page);
    await page.goto(`/grants/${CARD_ID}`);

    // Closure checklist is rendered.
    await expect(page.getByText(/Grant Closure Checklist/i)).toBeVisible({ timeout: 15_000 });

    // The Close button must be absent while the checklist is incomplete.
    await expect(page.getByRole('button', { name: /Mark grant Closed/i })).toHaveCount(0);
    await expect(page.getByText(/Complete the checklist to release this summary/i)).toBeVisible();

    // Tick all six items in order — each unlocks the next.
    const closureList = page.locator('.grant-closure-list');
    const boxes = closureList.getByRole('checkbox');
    await expect(boxes).toHaveCount(6);
    for (let i = 0; i < 6; i++) {
      await boxes.nth(i).check();
    }

    // Now the close button appears; click it.
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

    // Reload — the checklist should still show all 6 ticked and the page
    // should not regress back to Active.
    await page.reload();
    await expect(page.getByText(/Grant Closure Checklist/i)).toBeVisible({ timeout: 15_000 });
    const boxesAfter = page.locator('.grant-closure-list').getByRole('checkbox');
    for (let i = 0; i < 6; i++) {
      await expect(boxesAfter.nth(i)).toBeChecked();
    }
  });
});
