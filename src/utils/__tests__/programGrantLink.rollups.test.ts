import { describe, it, expect } from 'vitest';
import {
  selectGrantProgramRollups,
  summariseGrantFunding,
  type ProgramGrantLink,
} from '../programGrantLink';
import { programIdFromName } from '../programFinance';
import type { Beneficiary } from '../../store/useStore';
import type { BeneficiaryOutcome } from '../outcomes';

const ben = (id: string, program: string): Beneficiary => ({
  id, name: id, program,
  location: '—',
  aadhaar: false,
  familySize: 1,
});

const out = (id: string, beneficiaryId: string, programId: string, daysAgo: number): BeneficiaryOutcome => ({
  id, beneficiaryId, programId,
  metric: 'attendance',
  metricLabel: 'Attendance',
  baseline: 0,
  current: 1,
  higherIsBetter: true,
  measuredAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
});

describe('selectGrantProgramRollups', () => {
  const links: ProgramGrantLink[] = [
    { id: 'l1', grantId: '3', programId: programIdFromName('Digital Literacy'), role: 'primary' },
    { id: 'l2', grantId: '3', programId: programIdFromName('Health Outreach'),  role: 'co-funder' },
    { id: 'l3', grantId: '2', programId: programIdFromName('Digital Literacy') },
  ];

  it('returns one row per link for the requested grant only', () => {
    const rows = selectGrantProgramRollups('3', { links, beneficiaries: [] });
    expect(rows.map(r => r.linkId).sort()).toEqual(['l1', 'l2']);
  });

  it('counts only beneficiaries enrolled in the linked programme', () => {
    const beneficiaries: Beneficiary[] = [
      ben('b1', 'Digital Literacy'),
      ben('b2', 'Digital Literacy'),
      ben('b3', 'Health Outreach'),
      ben('b4', 'Other Programme'),
    ];
    const rows = selectGrantProgramRollups('3', { links, beneficiaries });
    const dl = rows.find(r => r.programId === programIdFromName('Digital Literacy'))!;
    const ho = rows.find(r => r.programId === programIdFromName('Health Outreach'))!;
    expect(dl.beneficiaryCount).toBe(2);
    expect(ho.beneficiaryCount).toBe(1);
    expect(dl.role).toBe('primary');
    expect(ho.role).toBe('co-funder');
  });

  it('falls back to programId for the label when the programme is unknown', () => {
    const links2: ProgramGrantLink[] = [
      { id: 'lx', grantId: '9', programId: 'mystery-prog' },
    ];
    const rows = selectGrantProgramRollups('9', { links: links2, beneficiaries: [] });
    expect(rows[0].programLabel).toBe('mystery-prog');
    expect(rows[0].beneficiaryCount).toBe(0);
    expect(rows[0].reportReadinessPct).toBe(0);
  });

  it('counts service logs in window and computes report-readiness', () => {
    const dlId = programIdFromName('Digital Literacy');
    const beneficiaries: Beneficiary[] = [ben('b1', 'Digital Literacy'), ben('b2', 'Digital Literacy')];
    const outcomes: BeneficiaryOutcome[] = [
      out('o1', 'b1', dlId, 10),   // in window
      out('o2', 'b1', dlId, 200),  // out of window
      out('o3', 'b2', dlId, 5),    // in window — second beneficiary
    ];
    const rows = selectGrantProgramRollups('3', {
      links, beneficiaries, outcomes, periodDays: 90,
    });
    const dl = rows.find(r => r.programId === dlId)!;
    expect(dl.serviceLogCount).toBe(2);
    expect(dl.reportReadinessPct).toBe(100);
  });
});

describe('summariseGrantFunding', () => {
  it('sums program count and beneficiaries across rollups', () => {
    const s = summariseGrantFunding([
      { programId: 'a', programLabel: 'A', beneficiaryCount: 12, serviceLogCount: 0, reportReadinessPct: 0, linkId: 'l1' },
      { programId: 'b', programLabel: 'B', beneficiaryCount: 30, serviceLogCount: 0, reportReadinessPct: 0, linkId: 'l2' },
    ]);
    expect(s).toEqual({ programCount: 2, beneficiaryTotal: 42 });
  });

  it('returns zeros for an empty list', () => {
    expect(summariseGrantFunding([])).toEqual({ programCount: 0, beneficiaryTotal: 0 });
  });
});
