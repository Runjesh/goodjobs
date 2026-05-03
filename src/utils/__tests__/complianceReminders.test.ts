import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildComplianceReminders,
  persistComplianceReminders,
  readComplianceReminders,
  pickUntoastedReminders,
} from '../complianceReminders';

const NOW = new Date('2026-05-03T00:00:00.000Z');

describe('buildComplianceReminders', () => {
  it('flags filings due within 30d, splits urgent (≤7d) vs attention', () => {
    const filings = [
      { id: 1, name: 'GST 3B', due: '2026-05-09', assignee: 'Finance' }, // +6 → urgent
      { id: 2, name: 'CSR-1',  due: '2026-05-25', assignee: 'ED' },      // +22 → attention
      { id: 3, name: 'TDS Q1', due: '2026-09-01' },                       // out of window
    ];
    const rs = buildComplianceReminders(filings, [], NOW);
    expect(rs.map(r => r.id)).toEqual(['compl-filing-1', 'compl-filing-2']);
    expect(rs[0].level).toBe('urgent');
    expect(rs[1].level).toBe('attention');
  });

  it('marks overdue filings with negative daysUntil', () => {
    const rs = buildComplianceReminders(
      [{ id: 9, name: '12A renewal', due: '2026-04-20' }],
      [],
      NOW,
    );
    expect(rs).toHaveLength(1);
    expect(rs[0].daysUntil).toBeLessThan(0);
    expect(rs[0].text).toMatch(/overdue/);
  });

  it('parses board "Until <date>" tenure and skips bare "Since <year>"', () => {
    const board = [
      { id: 'b1', name: 'A. Rao',   role: 'Trustee',     tenure: 'Until 2026-05-20' }, // +17 → attention
      { id: 'b2', name: 'P. Singh', role: 'Chairperson', tenure: 'Since 2024' },       // skipped (no end)
    ];
    const rs = buildComplianceReminders([], board, NOW);
    expect(rs.map(r => r.id)).toEqual(['compl-board-b1']);
    expect(rs[0].level).toBe('attention');
  });

  it('sorts most urgent first', () => {
    const rs = buildComplianceReminders(
      [
        { id: 1, name: 'Far',   due: '2026-05-30' },  // +27
        { id: 2, name: 'Today', due: '2026-05-03' },  // 0
        { id: 3, name: 'Late',  due: '2026-05-01' },  // -2
      ],
      [],
      NOW,
    );
    expect(rs.map(r => r.refId)).toEqual(['3', '2', '1']);
  });
});

describe('persist + pickUntoastedReminders', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('round-trips reminders through localStorage', () => {
    const rs = buildComplianceReminders(
      [{ id: 1, name: 'GST', due: '2026-05-09' }],
      [],
      NOW,
    );
    persistComplianceReminders(rs);
    expect(readComplianceReminders()).toEqual(rs);
  });

  it('only returns each reminder once per session', () => {
    const rs = buildComplianceReminders(
      [{ id: 1, name: 'GST', due: '2026-05-09' }],
      [],
      NOW,
    );
    expect(pickUntoastedReminders(rs)).toHaveLength(1);
    expect(pickUntoastedReminders(rs)).toHaveLength(0);
  });
});
