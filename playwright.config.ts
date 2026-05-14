import { defineConfig, devices } from '@playwright/test';

/** Use `localhost` (not 127.0.0.1): Vite often binds to IPv6-only `localhost`, so IPv4 checks never go ready. */
const FRONTEND = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

/**
 * E2E starts Vite + FastAPI so login hits real /auth/login and RBAC matches production shapes.
 * Set CI=1 in automation to forbid skipping servers; reuseExistingServer speeds up local runs.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: FRONTEND,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: FRONTEND,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        'cd backend && PYTHONPATH=. .venv/bin/python -m uvicorn api.main:app --host 127.0.0.1 --port 8000',
      url: 'http://127.0.0.1:8000/openapi.json',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
