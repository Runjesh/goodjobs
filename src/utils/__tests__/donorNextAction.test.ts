import { describe, it, expect } from 'vitest';
import { deriveNextAction } from '../donorNextAction';
import type { Donor } from '../../store/useStore';

const base: Donor = {
  id: '1', name: 'X', type: 'Recurring', totalGiven: 20000, lastGift: '2026-04-01',
  initial: 'X', pan: '', location: '', tags: [],
};

describe('deriveNextAction', () => {
  it('returns high band for explicit score >= 80', () => {
    const a = deriveNextAction(base, 90);
    expect(a.band).toBe('high');
    expect(a.suggestedAmount).toBeGreaterThan(0);
    expect(a.label).toContain('renewal');
  });

  it('returns mid band for explicit score 50-79', () => {
    expect(deriveNextAction(base, 65).band).toBe('mid');
  });

  it('returns low band for explicit score < 50', () => {
    expect(deriveNextAction(base, 20).band).toBe('low');
  });

  it('infers high for Major Donor without score', () => {
    expect(deriveNextAction({ ...base, type: 'Major Donor' }).band).toBe('high');
  });

  it('infers low when last gift is very stale', () => {
    expect(deriveNextAction({ ...base, type: 'Lapsing', lastGift: '2023-01-01' }).band).toBe('low');
  });

  it('handles missing lastGift gracefully', () => {
    const a = deriveNextAction({ ...base, type: 'Event Attendee', lastGift: 'N/A' });
    expect(['low', 'mid', 'high']).toContain(a.band);
  });

  it('rounds suggested amount to nearest 500', () => {
    const a = deriveNextAction({ ...base, totalGiven: 12345, type: 'Major Donor' });
    expect(a.suggestedAmount! % 500).toBe(0);
  });
});
