import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlansComparison from '../PlansComparison';
import { TIER_PLANS } from '../../../utils/trial';

const baseProps = {
  open: true,
  onClose: () => {},
  onChoose: () => {},
};

describe('PlansComparison', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(<PlansComparison {...baseProps} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one card per tier with the right CTA copy per plan', () => {
    render(<PlansComparison {...baseProps} />);
    // Each plan name shows up as a card title (and again in the compare table head).
    for (const p of TIER_PLANS) {
      expect(screen.getAllByText(p.name).length).toBeGreaterThan(0);
    }
    // Starter CTA copy.
    expect(screen.getByRole('button', { name: /Stay on Starter/i })).toBeInTheDocument();
    // Paid CTAs.
    expect(screen.getByRole('button', { name: /Choose Growth/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Choose Scale/i })).toBeInTheDocument();
  });

  it('disables the current-plan CTA and labels it "Current plan"', () => {
    render(<PlansComparison {...baseProps} currentTier="growth" />);
    const currentBtn = screen.getByRole('button', { name: /Current plan/i });
    expect(currentBtn).toBeDisabled();
    // Sanity: the other paid plan is still active (Scale).
    expect(screen.getByRole('button', { name: /Choose Scale/i })).not.toBeDisabled();
  });

  it('starts on the requested billing cycle and toggles between monthly/annual', () => {
    render(<PlansComparison {...baseProps} initialCycle="annual" />);
    // Annual tab is selected, monthly is not.
    const annualTab = screen.getByRole('tab', { name: /Annual/i });
    const monthlyTab = screen.getByRole('tab', { name: /Monthly/i });
    expect(annualTab).toHaveAttribute('aria-selected', 'true');
    expect(monthlyTab).toHaveAttribute('aria-selected', 'false');
    // Annual price for Growth (24,990) should be visible; monthly (2,499) should not.
    expect(screen.getByText(/₹24,990/)).toBeInTheDocument();
    expect(screen.queryByText(/₹2,499/)).not.toBeInTheDocument();

    // Switch to monthly → prices flip.
    fireEvent.click(monthlyTab);
    expect(monthlyTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/₹2,499/)).toBeInTheDocument();
    expect(screen.queryByText(/₹24,990/)).not.toBeInTheDocument();
  });

  it('passes the chosen plan + active cycle back through onChoose', () => {
    const onChoose = vi.fn();
    render(<PlansComparison {...baseProps} onChoose={onChoose} initialCycle="monthly" />);
    fireEvent.click(screen.getByRole('button', { name: /Choose Growth/i }));
    expect(onChoose).toHaveBeenCalledTimes(1);
    const [plan, cycle] = onChoose.mock.calls[0];
    expect(plan.id).toBe('growth');
    expect(cycle).toBe('monthly');
  });
});
