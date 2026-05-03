import { describe, it, expect } from 'vitest';
import { parseShiftInterval, intervalsOverlap, findShiftConflict } from '../shiftConflict';

describe('parseShiftInterval', () => {
  it('extracts ISO day + 24h interval', () => {
    const p = parseShiftInterval('2026-05-14 09:00 to 11:30');
    expect(p.dayKey).toBe('2026-05-14');
    expect(p.startMin).toBe(9 * 60);
    expect(p.endMin).toBe(11 * 60 + 30);
  });

  it('handles "Sat 14 Dec • 9–11am"', () => {
    const p = parseShiftInterval('Sat 14 Dec 2025 • 9–11am');
    expect(p.dayKey).toBe('2025-12-14');
    expect(p.startMin).toBe(9 * 60);
    expect(p.endMin).toBe(11 * 60);
  });

  it('propagates pm meridiem from right token', () => {
    const p = parseShiftInterval('Dec 14, 2025 • 1-3pm');
    expect(p.dayKey).toBe('2025-12-14');
    expect(p.startMin).toBe(13 * 60);
    expect(p.endMin).toBe(15 * 60);
  });

  it('returns null times when no range present', () => {
    const p = parseShiftInterval('Sat 14 Dec 2025');
    expect(p.dayKey).toBe('2025-12-14');
    expect(p.startMin).toBeNull();
    expect(p.endMin).toBeNull();
  });
});

describe('intervalsOverlap', () => {
  it('overlapping windows return true', () => {
    expect(intervalsOverlap(540, 660, 600, 720)).toBe(true);
  });
  it('touching boundaries do NOT overlap (exclusive end)', () => {
    expect(intervalsOverlap(540, 660, 660, 720)).toBe(false);
  });
});

describe('findShiftConflict', () => {
  const morning = { id: 1, date: 'Sat 14 Dec 2025 • 9–11am', title: 'AM clinic' };
  const evening = { id: 2, date: 'Sat 14 Dec 2025 • 6–8pm',  title: 'PM clinic' };
  const overlap = { id: 3, date: 'Sat 14 Dec 2025 • 10am–12pm', title: 'Outreach' };
  const nextDay = { id: 4, date: 'Sun 15 Dec 2025 • 9–11am', title: 'Sunday' };

  it('returns null when shifts are same day but disjoint times (no false positive)', () => {
    expect(findShiftConflict(morning, [evening])).toBeNull();
  });

  it('detects real interval overlap on same day', () => {
    const c = findShiftConflict(morning, [overlap]);
    expect(c?.id).toBe(3);
  });

  it('returns null when target is on a different day', () => {
    expect(findShiftConflict(morning, [nextDay])).toBeNull();
  });

  it('treats duplicate signup for the same shift id as a conflict', () => {
    expect(findShiftConflict(morning, [morning])?.id).toBe(1);
  });

  it('falls back to same-day match when one side has no parseable times', () => {
    const noTime = { id: 5, date: 'Sat 14 Dec 2025', title: 'All-day' };
    expect(findShiftConflict(morning, [noTime])?.id).toBe(5);
  });
});
