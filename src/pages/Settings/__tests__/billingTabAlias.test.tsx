/**
 * Task #13: the trial expired banner + day-28 modal both deep-link to
 * `/settings?tab=billing`. The Settings page tab id is `plans`, so without
 * an alias the user lands on the Profile tab and the upgrade CTA is a
 * dead end. This test pins the alias behaviour: ?tab=billing must mount
 * the Plans & Billing surface.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Settings.tsx pulls in a lot of unrelated surfaces (WhatsApp portal,
// PlansSection → Razorpay, etc). We only care about which tab mounts,
// so stub the heavy children to a sentinel.
vi.mock('../../../components/Billing/PlansSection', () => ({
  default: () => <div data-testid="plans-section">PLANS</div>,
}));
vi.mock('../../../components/Settings/WhatsAppPortal', () => ({
  default: () => <div data-testid="whatsapp-portal">WA</div>,
}));
vi.mock('../../../components/Billing/ContextualUpgradePrompt', () => ({
  default: () => null,
}));

// AuthContext: minimal stub so Settings can render without a real provider.
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { name: 'A', email: 'a@x.org', ngoName: 'X', role: 'ed', token: 't' },
    login: vi.fn(),
    updateUser: vi.fn(),
  }),
  ROLE_META: { ed: { label: 'ED', icon: '🧭', color: '#0F766E', bg: '#ccfbf1' } },
}));

vi.mock('../../../hooks/useTier', () => ({
  useTier: () => ({
    tier: 'starter',
    usage: { team: 1, beneficiaries: 0, reportsThisMonth: 0 },
    openUpgrade: vi.fn(),
  }),
  useUpgradeListener: () => {},
}));

vi.mock('../../../api/client', () => ({
  apiFetch: () => Promise.resolve({ ok: false, json: () => ({}) }),
}));

import Settings from '../Settings';

beforeEach(() => {
  cleanup();
  // Reset URL between cases so they don't leak.
  window.history.replaceState({}, '', '/settings');
});

function mountWithSearch(search: string) {
  window.history.replaceState({}, '', `/settings?${search}`);
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );
}

describe('Settings → Billing tab deep-link alias', () => {
  it('mounts the Plans & Billing surface when ?tab=billing (alias for plans)', () => {
    mountWithSearch('tab=billing');
    expect(screen.getByTestId('plans-section')).toBeTruthy();
  });

  it('mounts the Plans & Billing surface when ?tab=plans (canonical id)', () => {
    mountWithSearch('tab=plans');
    expect(screen.getByTestId('plans-section')).toBeTruthy();
  });

  it('falls back to the Profile tab for unknown tab names', () => {
    mountWithSearch('tab=does-not-exist');
    expect(screen.queryByTestId('plans-section')).toBeNull();
  });
});
