import { expect, type Page } from '@playwright/test';

const API = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8000';

export async function login(page: Page, email: string, password = 'demo1234') {
  await page.goto('/login');
  await page.getByLabel('Work Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In →' }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

/** Closes the first-run welcome modal so it does not intercept e2e clicks. */
export async function dismissWelcomeIfPresent(page: Page) {
  await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('sevasuite_auth');
      if (!raw) return;
      const user = JSON.parse(raw) as { id?: string };
      if (!user?.id) return;
      const welcomed = JSON.parse(localStorage.getItem('gj_welcomed_v1') || '{}') as Record<string, number>;
      welcomed[user.id] = Date.now();
      localStorage.setItem('gj_welcomed_v1', JSON.stringify(welcomed));
    } catch {
      /* ignore */
    }
  });
  const skip = page.getByRole('button', { name: /Skip welcome/i });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }
}

export async function apiToken(email: string, password = 'demo1234'): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const data = await res.json();
  return data.access_token as string;
}

export { API };
