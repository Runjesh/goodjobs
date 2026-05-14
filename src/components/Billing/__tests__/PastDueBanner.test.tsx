import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PastDueBanner from '../PastDueBanner';
import type { UseTierResult } from '../../../hooks/useTier';
import type { BillingState } from '../../../utils/trial';

// ── Mock useAuth and useTier so the banner can be rendered in isolation ──────
// react-hot-toast is rendered via toast() — stub it so we don't need a Toaster
// mounted in the test tree.
vi.mock('react-hot-toast', () => {
  const fn = vi.fn();
  return {
    default: Object.assign(fn, {
      success: vi.fn(),
      error: vi.fn(),
      loading: vi.fn(),
      dismiss: vi.fn(),
    }),
  };
});

const updateUserMock = vi.fn();
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', ngoId: 'ngo_x', name: 'Anjali', email: 'a@x.com' },
    updateUser: updateUserMock,
  }),
}));

const tierState: { value: Partial<UseTierResult> } = {
  value: {
    pastDue: false,
    billing: undefined,
    daysUntilHardDowngrade: 7,
    chosenTier: 'growth',
    openUpgrade: vi.fn(),
  },
};
vi.mock('../../../hooks/useTier', () => ({
  useTier: () => tierState.value,
}));

function setTier(patch: Partial<UseTierResult>) {
  tierState.value = { ...tierState.value, ...patch } as Partial<UseTierResult>;
}

const billingPastDue: BillingState = {
  status: 'past_due',
  currentPeriodEnd: '2026-07-01T00:00:00.000Z',
  billingCycle: 'monthly',
  pastDueSince: '2026-06-25T00:00:00.000Z',
};

describe('PastDueBanner', () => {
  it('renders nothing when billing is healthy', () => {
    setTier({ pastDue: false, billing: undefined });
    const { container } = render(<PastDueBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the failed-payment banner with retry CTA when past_due', () => {
    setTier({
      pastDue: true,
      billing: billingPastDue,
      daysUntilHardDowngrade: 4,
      chosenTier: 'growth',
    });
    render(<PastDueBanner />);
    expect(screen.getByText(/Payment failed for your Growth plan/i)).toBeInTheDocument();
    expect(screen.getByText(/Auto-downgrades in 4 days/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry payment/i })).toBeInTheDocument();
  });

  it('switches copy once the grace period has expired', () => {
    setTier({
      pastDue: true,
      billing: billingPastDue,
      daysUntilHardDowngrade: 0,
      chosenTier: 'growth',
    });
    render(<PastDueBanner />);
    expect(screen.getByText(/Grace period ended/i)).toBeInTheDocument();
  });

  it('uses singular "day" copy when exactly 1 day remains', () => {
    setTier({
      pastDue: true,
      billing: billingPastDue,
      daysUntilHardDowngrade: 1,
      chosenTier: 'growth',
    });
    render(<PastDueBanner />);
    expect(screen.getByText(/Auto-downgrades in 1 day\b/i)).toBeInTheDocument();
  });

  it('fires openUpgrade with the chosen tier + cycle when Retry is clicked', () => {
    const openUpgrade = vi.fn();
    setTier({
      pastDue: true,
      billing: billingPastDue,
      daysUntilHardDowngrade: 5,
      chosenTier: 'growth',
      openUpgrade,
    });
    render(<PastDueBanner />);
    fireEvent.click(screen.getByRole('button', { name: /Retry payment/i }));
    expect(openUpgrade).toHaveBeenCalledTimes(1);
    expect(openUpgrade).toHaveBeenCalledWith({
      targetTier: 'growth',
      cycle: 'monthly',
      source: 'past_due_banner',
    });
  });

  it('routes Scale users back to the Scale checkout', () => {
    const openUpgrade = vi.fn();
    setTier({
      pastDue: true,
      billing: { ...billingPastDue, billingCycle: 'annual' },
      daysUntilHardDowngrade: 5,
      chosenTier: 'scale',
      openUpgrade,
    });
    render(<PastDueBanner />);
    fireEvent.click(screen.getByRole('button', { name: /Retry payment/i }));
    expect(openUpgrade).toHaveBeenCalledWith({
      targetTier: 'scale',
      cycle: 'annual',
      source: 'past_due_banner',
    });
  });

  it('hides itself for the rest of the session once dismissed', () => {
    setTier({
      pastDue: true,
      billing: billingPastDue,
      daysUntilHardDowngrade: 5,
      chosenTier: 'growth',
    });
    const { rerender, container } = render(<PastDueBanner />);
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
    expect(window.sessionStorage.getItem('gj_pastdue_muted')).toBe('1');
    rerender(<PastDueBanner />);
    expect(container.firstChild).toBeNull();
  });
});
