import { describe, it, expect } from 'vitest';
import {
  mergeGrantState,
  sanitiseGrantStateForServer,
  type GrantState,
} from '../grantState';

const base: GrantState = {
  notes: 'local notes',
  decisionDate: '2026-01-01',
  followUpDate: '2026-01-15',
  parserDecisions: { pl1: 'approved', pl2: 'pending' },
  parserEdits: { pl1: 'local edit' },
  deliverables: [{ id: 'd1', title: 'Local', progress: 25, due: '2026-02-01' }],
  reports: [{ id: 'r1', title: 'Q1', status: 'draft', due: '2026-03-01' }],
  budget: [{ id: 'b1', head: 'Local', allocated: 100, spent: 10 }],
  nextReportDue: '2026-04-01',
  closureChecklist: { uc: true },
  closureSummary: { beneficiariesServed: 100, outcomes: ['local'] },
  closingMode: false,
  isClosed: false,
};

describe('mergeGrantState', () => {
  it('returns base unchanged when override is null/undefined', () => {
    expect(mergeGrantState(base, null)).toEqual(base);
    expect(mergeGrantState(base, undefined)).toEqual(base);
  });

  it('lets override scalar fields win', () => {
    const r = mergeGrantState(base, { notes: 'server notes', isClosed: true });
    expect(r.notes).toBe('server notes');
    expect(r.isClosed).toBe(true);
    expect(r.followUpDate).toBe('2026-01-15');
  });

  it('deep-merges parserDecisions so per-key writes from two users are preserved', () => {
    const r = mergeGrantState(base, {
      parserDecisions: { pl2: 'approved', pl3: 'edited' },
    });
    expect(r.parserDecisions).toEqual({
      pl1: 'approved', pl2: 'approved', pl3: 'edited',
    });
  });

  it('deep-merges closureChecklist and parserEdits', () => {
    const r = mergeGrantState(base, {
      closureChecklist: { unspent: true },
      parserEdits: { pl2: 'server edit' },
    });
    expect(r.closureChecklist).toEqual({ uc: true, unspent: true });
    expect(r.parserEdits).toEqual({ pl1: 'local edit', pl2: 'server edit' });
  });

  it('replaces arrays wholesale (latest write wins, not union)', () => {
    const r = mergeGrantState(base, {
      deliverables: [{ id: 'd9', title: 'Server', progress: 80, due: '2026-05-01' }],
    });
    expect(r.deliverables).toHaveLength(1);
    expect(r.deliverables[0].id).toBe('d9');
  });

  it('merges closureSummary field-by-field', () => {
    const r = mergeGrantState(base, {
      closureSummary: { beneficiariesServed: 999 } as GrantState['closureSummary'],
    });
    expect(r.closureSummary.beneficiariesServed).toBe(999);
    expect(r.closureSummary.outcomes).toEqual(['local']);
  });

  it('ignores undefined / null override values (no blanking on partial response)', () => {
    const r = mergeGrantState(base, {
      notes: undefined as unknown as string,
      decisionDate: null as unknown as string,
    });
    expect(r.notes).toBe('local notes');
    expect(r.decisionDate).toBe('2026-01-01');
  });
});

describe('sanitiseGrantStateForServer', () => {
  it('clamps deliverable progress into 0..100', () => {
    const r = sanitiseGrantStateForServer({
      ...base,
      deliverables: [
        { id: 'd1', title: 'A', progress: -10 as number, due: '' },
        { id: 'd2', title: 'B', progress: 250 as number, due: '' },
      ],
    });
    expect(r.deliverables[0].progress).toBe(0);
    expect(r.deliverables[1].progress).toBe(100);
  });

  it('coerces non-finite numbers in budget rows to 0', () => {
    const r = sanitiseGrantStateForServer({
      ...base,
      budget: [{ id: 'b1', head: 'X', allocated: NaN, spent: Infinity }],
    });
    expect(r.budget[0].allocated).toBe(0);
    expect(r.budget[0].spent).toBe(0);
  });

  it('falls back to [] when closureSummary.outcomes is not an array', () => {
    const r = sanitiseGrantStateForServer({
      ...base,
      closureSummary: { beneficiariesServed: 50, outcomes: 'oops' as unknown as string[] },
    });
    expect(r.closureSummary.outcomes).toEqual([]);
    expect(r.closureSummary.beneficiariesServed).toBe(50);
  });
});
