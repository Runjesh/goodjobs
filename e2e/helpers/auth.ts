import { expect, type Page } from '@playwright/test';

const API = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8000';

export async function login(page: Page, email: string, password = 'demo1234') {
  await page.goto('/login');
  await page.getByLabel('Work Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /Sign In/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
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
