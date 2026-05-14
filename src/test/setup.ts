// Vitest global setup. Runs before every test file.
// - Reset the localStorage / sessionStorage between tests so per-org billing
//   keys (gj_org_billing_v1, gj_reports_usage_v1, gj_pastdue_muted) never leak
//   between specs.
// - Stub matchMedia so framer-motion / responsive UI helpers don't crash in
//   jsdom which doesn't implement it.
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* ignore */ }
  try { window.sessionStorage.clear(); } catch { /* ignore */ }
});

afterEach(() => {
  cleanup();
});
