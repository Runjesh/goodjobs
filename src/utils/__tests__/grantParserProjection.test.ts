import { describe, it, expect } from 'vitest';
import {
  projectParserRowsIntoState,
  parseRupeesFromDetail,
  parseDueFromDetail,
  type ParserRow,
} from '../grantParserProjection';
import type { GrantState } from '../grantState';

const baseState: GrantState = {
  notes: '',
  decisionDate: '2026-01-01',
  followUpDate: '2026-01-15',
  parserDecisions: {},
  parserEdits: {},
  deliverables: [
    // A pre-existing manual entry that must NOT be touched by projection.
    { id: 'manual-1', title: 'Manual deliverable', progress: 50, due: '2026-09-01' },
  ],
  reports: [
    { id: 'manual-r', title: 'Manual report', status: 'in_review', due: '2026-09-01' },
  ],
  budget: [
    { id: 'manual-b', head: 'Manual head', allocated: 500000, spent: 100000 },
  ],
  nextReportDue: '2026-04-01',
  closureChecklist: {},
  closureSummary: { beneficiariesServed: 0, outcomes: [] },
  closingMode: false,
  isClosed: false,
};

const rows: ParserRow[] = [
  { id: 'pl1', type: 'deadline',    label: 'Final UC', detail: 'Within 30 days', confidence: 0.9 },
  { id: 'dv1', type: 'deliverable', label: 'Train cohort', detail: 'Programme cohort', confidence: 0.9 },
  { id: 'bg1', type: 'budget',      label: 'Programme delivery', detail: '₹12.0L · 60%', confidence: 0.9 },
  { id: 'cd1', type: 'condition',   label: 'No-diversion', detail: 'Schedule VII only', confidence: 0.9 },
];

describe('projectParserRowsIntoState', () => {
  it('only projects approved/edited rows; leaves manual entries intact', () => {
    const r = projectParserRowsIntoState(
      rows,
      { pl1: 'approved', dv1: 'approved', bg1: 'approved' },
      {},
      baseState,
    );
    expect(r.deliverables.find(d => d.id === 'manual-1')).toBeTruthy();
    expect(r.deliverables.find(d => d.id === 'parser:dv1')).toBeTruthy();
    expect(r.budget.find(b => b.id === 'parser:bg1')?.allocated).toBe(1_200_000);
    expect(r.reports.find(rep => rep.id === 'parser:pl1')?.title).toBe('Final UC');
  });

  it('skips pending and rejected rows, drops previously-projected rejected ones', () => {
    const seeded = projectParserRowsIntoState(
      rows,
      { dv1: 'approved' },
      {},
      baseState,
    );
    expect(seeded.deliverables.find(d => d.id === 'parser:dv1')).toBeTruthy();
    const r = projectParserRowsIntoState(
      rows,
      { dv1: 'rejected' },
      {},
      seeded,
    );
    expect(r.deliverables.find(d => d.id === 'parser:dv1')).toBeUndefined();
    expect(r.deliverables.find(d => d.id === 'manual-1')).toBeTruthy();
  });

  it('preserves user-edited progress/spent/status across re-projection', () => {
    const seeded = projectParserRowsIntoState(rows,
      { dv1: 'approved', bg1: 'approved', pl1: 'approved' }, {}, baseState);
    // Simulate the user updating progress / spent / status on the projected rows.
    const edited: GrantState = {
      ...seeded,
      deliverables: seeded.deliverables.map(d => d.id === 'parser:dv1' ? { ...d, progress: 75 } : d),
      budget:       seeded.budget.map(b => b.id === 'parser:bg1' ? { ...b, spent: 400000 } : b),
      reports:      seeded.reports.map(r => r.id === 'parser:pl1' ? { ...r, status: 'submitted' } : r),
    };
    const re = projectParserRowsIntoState(rows,
      { dv1: 'approved', bg1: 'approved', pl1: 'approved' }, {}, edited);
    expect(re.deliverables.find(d => d.id === 'parser:dv1')?.progress).toBe(75);
    expect(re.budget.find(b => b.id === 'parser:bg1')?.spent).toBe(400_000);
    expect(re.reports.find(r => r.id === 'parser:pl1')?.status).toBe('submitted');
  });

  it('uses the edited text when a row is marked edited', () => {
    const r = projectParserRowsIntoState(
      rows,
      { dv1: 'edited' },
      { dv1: 'Train 750 women in Pune' },
      baseState,
    );
    expect(r.deliverables.find(d => d.id === 'parser:dv1')?.title).toBe('Train 750 women in Pune');
  });

  it('does not project condition rows into any active tab', () => {
    const r = projectParserRowsIntoState(
      rows,
      { cd1: 'approved' },
      {},
      baseState,
    );
    expect(r.reports.length).toBe(baseState.reports.length);
    expect(r.deliverables.length).toBe(baseState.deliverables.length);
    expect(r.budget.length).toBe(baseState.budget.length);
  });
});

describe('parseRupeesFromDetail', () => {
  it('parses lakhs', () => { expect(parseRupeesFromDetail('₹12.0L · 60%')).toBe(1_200_000); });
  it('parses crores', () => { expect(parseRupeesFromDetail('₹1.5Cr')).toBe(15_000_000); });
  it('returns 0 on unrecognised input', () => { expect(parseRupeesFromDetail('see annexure')).toBe(0); });
});

describe('parseDueFromDetail', () => {
  it('handles "Within N days"', () => {
    const d = new Date(parseDueFromDetail('Within 30 days of completion'));
    const expected = new Date(Date.now() + 30 * 86400000);
    expect(Math.abs(d.getTime() - expected.getTime())).toBeLessThan(86400000);
  });
  it('handles "At month N"', () => {
    const d = new Date(parseDueFromDetail('At month 6 of project'));
    const expected = new Date(Date.now() + 180 * 86400000);
    expect(Math.abs(d.getTime() - expected.getTime())).toBeLessThan(86400000);
  });
});
