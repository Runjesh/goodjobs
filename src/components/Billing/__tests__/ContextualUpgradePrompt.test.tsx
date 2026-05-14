import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ContextualUpgradePrompt from '../ContextualUpgradePrompt';

const baseProps = {
  open: true,
  onClose: () => {},
  blockedAction: 'Add another beneficiary',
  reason: 'Starter caps you at 200 beneficiaries.',
  nextBenefits: ['Unlimited beneficiaries', 'AI Copilot', 'WhatsApp data entry'],
  targetTier: 'growth' as const,
  onUpgrade: () => {},
};

describe('ContextualUpgradePrompt', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(<ContextualUpgradePrompt {...baseProps} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders blocked action, reason, and Growth pricing for targetTier=growth', () => {
    render(<ContextualUpgradePrompt {...baseProps} />);
    // Eyebrow shows what was blocked.
    expect(screen.getByText(/Add another beneficiary is on a higher plan/i)).toBeInTheDocument();
    // Reason shows up as the dialog title.
    expect(screen.getByRole('dialog')).toHaveTextContent(/Starter caps you at 200 beneficiaries/i);
    // Each unlock benefit is rendered.
    for (const b of baseProps.nextBenefits) {
      expect(screen.getByText(b)).toBeInTheDocument();
    }
    // Growth monthly is ₹2,499 from TIER_PLANS — should be on screen.
    expect(screen.getByText(/₹2,499/)).toBeInTheDocument();
    // CTAs are both present.
    expect(screen.getByRole('button', { name: /Upgrade now/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Maybe later/i })).toBeInTheDocument();
  });

  it('renders Scale pricing when targetTier=scale', () => {
    render(
      <ContextualUpgradePrompt
        {...baseProps}
        targetTier="scale"
        nextBenefits={['Unlimited team members', 'SSO + audit log']}
      />,
    );
    // Scale monthly is ₹6,999.
    expect(screen.getByText(/₹6,999/)).toBeInTheDocument();
    expect(screen.getByText(/Upgrade to Scale/i)).toBeInTheDocument();
  });

  it('fires onUpgrade when the primary CTA is clicked', () => {
    const onUpgrade = vi.fn();
    const onClose = vi.fn();
    render(<ContextualUpgradePrompt {...baseProps} onUpgrade={onUpgrade} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Upgrade now/i }));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('fires onClose for both Maybe later and the close icon', () => {
    const onClose = vi.fn();
    render(<ContextualUpgradePrompt {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Maybe later/i }));
    fireEvent.click(screen.getByRole('button', { name: /Close/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
