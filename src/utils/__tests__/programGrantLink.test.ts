import { describe, it, expect } from 'vitest';
import {
  selectGrantsForProgram,
  selectProgramsForGrant,
  grantHealthForProgram,
  type ProgramGrantLink,
} from '../programGrantLink';
import type { ProgramBudget } from '../programFinance';
import type { GrantTranche } from '../grantLifecycle';
import type { ComplianceGrantLink } from '../complianceGrant';
import type { ComplianceDocument } from '../../store/useStore';

const NOW = new Date('2026-05-01').getTime();
const inDays = (n: number) =>
  new Date(NOW + n * 86_400_000).toISOString().slice(0, 10);

const links: ProgramGrantLink[] = [
  { id: 'l1', programId: 'wlc', grantId: '3', role: 'primary' },
  { id: 'l2', programId: 'wlc', grantId: '2', role: 'co-funder' },
  { id: 'l3', programId: 'dl',  grantId: '2', role: 'primary' },
];

describe('selectGrantsForProgram / selectProgramsForGrant', () => {
  it('returns grants linked to a programme', () => {
    expect(selectGrantsForProgram(links, 'wlc').map(l => l.grantId)).toEqual(['3', '2']);
    expect(selectGrantsForProgram(links, 'missing')).toEqual([]);
  });

  it('returns programmes linked to a grant', () => {
    expect(selectProgramsForGrant(links, '2').map(l => l.programId)).toEqual(['wlc', 'dl']);
    expect(selectProgramsForGrant(links, '999')).toEqual([]);
  });

  it('matches grantId regardless of string/number type', () => {
    const numericLinks: ProgramGrantLink[] = [{ id: 'l', programId: 'p', grantId: '7' }];
    expect(selectProgramsForGrant(numericLinks, 7 as unknown as string)).toHaveLength(1);
  });
});

describe('grantHealthForProgram', () => {
  const docs: ComplianceDocument[] = [
    { id: 'd-valid',   name: 'Valid',   type: 'X', status: 'Valid',         expiry: inDays(400),  uploadedAt: '2024-01-01' },
    { id: 'd-soon',    name: 'Soon',    type: 'X', status: 'Expiring Soon', expiry: inDays(20),   uploadedAt: '2024-01-01' },
    { id: 'd-expired', name: 'Expired', type: 'X', status: 'Expired',       expiry: inDays(-10),  uploadedAt: '2024-01-01' },
  ];

  it('reports HEALTHY when budget is on-track, tranche is far out, and compliance is valid', () => {
    const budgets: ProgramBudget[] = [
      { programId: 'wlc', label: 'WLC', planned: 1_000_000, spent: 400_000, grantId: '3' },
    ];
    const tranches: GrantTranche[] = [
      { id: 't1', grantId: '3', number: 1, amount: 100, expectedDate: inDays(60), status: 'awaiting_utilization' },
    ];
    const complianceLinks: ComplianceGrantLink[] = [
      { id: 'cl1', grantId: '3', complianceDocId: 'd-valid' },
    ];
    const h = grantHealthForProgram('wlc', '3', { budgets, tranches, complianceLinks, docs, now: NOW });
    expect(h.status).toBe('healthy');
    expect(h.utilisationPct).toBe(40);
    expect(h.nextReportDue).toBe(inDays(60));
  });

  it('reports AT_RISK when next tranche is within 14d or compliance doc is expiring soon', () => {
    const budgets: ProgramBudget[] = [
      { programId: 'wlc', label: 'WLC', planned: 1_000_000, spent: 400_000, grantId: '3' },
    ];
    const tranches: GrantTranche[] = [
      { id: 't1', grantId: '3', number: 1, amount: 100, expectedDate: inDays(7), status: 'awaiting_utilization' },
    ];
    const complianceLinks: ComplianceGrantLink[] = [
      { id: 'cl1', grantId: '3', complianceDocId: 'd-soon' },
    ];
    const h = grantHealthForProgram('wlc', '3', { budgets, tranches, complianceLinks, docs, now: NOW });
    expect(h.status).toBe('at_risk');
  });

  it('reports OVERDUE when tranche slipped or compliance doc expired', () => {
    const budgets: ProgramBudget[] = [
      { programId: 'wlc', label: 'WLC', planned: 1_000_000, spent: 600_000, grantId: '3' },
    ];
    const tranches: GrantTranche[] = [
      { id: 't1', grantId: '3', number: 1, amount: 100, expectedDate: inDays(-5), status: 'awaiting_utilization' },
    ];
    const complianceLinks: ComplianceGrantLink[] = [
      { id: 'cl1', grantId: '3', complianceDocId: 'd-expired' },
    ];
    const h = grantHealthForProgram('wlc', '3', { budgets, tranches, complianceLinks, docs, now: NOW });
    expect(h.status).toBe('overdue');
  });

  it('returns 0% utilisation and null due-date when nothing is wired up', () => {
    const h = grantHealthForProgram('orphan-prog', 'orphan-grant', {
      budgets: [], tranches: [], complianceLinks: [], docs: [], now: NOW,
    });
    expect(h.utilisationPct).toBe(0);
    expect(h.nextReportDue).toBeNull();
    expect(h.status).toBe('healthy');
  });

  it('flags overspend (>100% utilisation) as AT_RISK even with no other signals', () => {
    const budgets: ProgramBudget[] = [
      { programId: 'wlc', label: 'WLC', planned: 1_000_000, spent: 1_300_000, grantId: '3' },
    ];
    const h = grantHealthForProgram('wlc', '3', {
      budgets, tranches: [], complianceLinks: [], docs: [], now: NOW,
    });
    expect(h.status).toBe('at_risk');
  });
});
