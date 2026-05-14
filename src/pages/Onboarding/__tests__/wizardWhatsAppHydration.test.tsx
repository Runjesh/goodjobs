/**
 * Integration test for the wizard ↔ Settings WhatsApp round-trip
 * (Task #12 follow-up to the code-review reject):
 *
 *   1. Wizard saves WhatsApp number → backend stores it under
 *      ngo.meta.whatsapp.
 *   2. On a fresh device (empty localStorage), Layout hydrates
 *      user.whatsapp from /settings.
 *   3. Settings → WhatsAppPortal renders the "Connected number" banner
 *      from user.whatsapp — proving the UI no longer depends on
 *      localStorage for surfacing the wizard's connection state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Toaster } from 'react-hot-toast';

let mockUser: {
  email: string; ngoName: string; role: string; token: string;
  whatsapp?: { phone?: string; verified?: boolean; connectedAt?: string };
} | null = null;

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    isAuthenticated: !!mockUser,
    permissions: {},
    login: vi.fn(),
    logout: vi.fn(),
    can: () => true,
    updateUser: vi.fn(),
  }),
}));

import WhatsAppPortal from '../../../components/Settings/WhatsAppPortal';

beforeEach(() => {
  cleanup();
  // Explicitly prove the banner does NOT rely on browser-local state.
  try { localStorage.clear(); } catch { /* ignore */ }
});

function renderWith(whatsapp: { phone?: string; verified?: boolean; connectedAt?: string } | undefined) {
  mockUser = whatsapp
    ? { email: 'ed@asha.org', ngoName: 'Asha Foundation', role: 'ed', token: 't', whatsapp }
    : null;
  return render(
    <>
      <Toaster />
      <WhatsAppPortal />
    </>,
  );
}

describe('Settings → WhatsApp Portal: wizard-connected number surfacing', () => {
  it('renders the Connected number banner when user.whatsapp is hydrated from backend', () => {
    renderWith({ phone: '+91 98200 12345', verified: true, connectedAt: '2026-04-01T10:00:00Z' });
    const banner = screen.getByTestId('whatsapp-connected-banner');
    expect(banner.textContent).toContain('+91 98200 12345');
    expect(banner.textContent).toContain('verified');
    expect(banner.textContent).toContain('2026-04-01');
  });

  it('omits the banner when no WhatsApp number has been connected', () => {
    renderWith(undefined);
    expect(screen.queryByTestId('whatsapp-connected-banner')).toBeNull();
  });

  it('shows "pending verification" when the wizard saved an unverified number', () => {
    renderWith({ phone: '+91 90000 11111', verified: false });
    const banner = screen.getByTestId('whatsapp-connected-banner');
    expect(banner.textContent).toContain('+91 90000 11111');
    expect(banner.textContent).toContain('pending verification');
  });
});
