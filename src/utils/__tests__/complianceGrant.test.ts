import { describe, it, expect } from 'vitest';
import { selectAtRiskGrants, type ComplianceGrantLink } from '../complianceGrant';
import type { CSRCard, ComplianceDocument } from '../../store/useStore';

const NOW = new Date('2026-05-01').getTime();

const grants: CSRCard[] = [
  { id: 'g1', company: 'Acme', amount: 1, project: 'P1', tags: [], agent: 'A', col: 'live', date: '' },
  { id: 'g2', company: 'Beta', amount: 1, project: 'P2', tags: [], agent: 'A', col: 'live', date: '' },
  { id: 'g3', company: 'Gamma', amount: 1, project: 'P3', tags: [], agent: 'A', col: 'live', date: '' },
];

const docs: ComplianceDocument[] = [
  { id: 'd-valid',    name: 'OK',         type: 'X', status: 'Valid',          expiry: '2027-01-01', uploadedAt: '2024-01-01' },
  { id: 'd-soon',     name: 'Soon',       type: 'X', status: 'Expiring Soon',  expiry: '2026-05-20', uploadedAt: '2024-01-01' },
  { id: 'd-expired',  name: 'Dead',       type: 'X', status: 'Expired',        expiry: '2026-04-01', uploadedAt: '2024-01-01' },
];

const links: ComplianceGrantLink[] = [
  { id: 'l1', grantId: 'g1', complianceDocId: 'd-valid' },
  { id: 'l2', grantId: 'g2', complianceDocId: 'd-soon' },
  { id: 'l3', grantId: 'g3', complianceDocId: 'd-expired' },
];

describe('selectAtRiskGrants', () => {
  it('skips valid docs and includes expiring + expired', () => {
    const out = selectAtRiskGrants(links, grants, docs, NOW);
    const ids = out.map(o => o.grant.id);
    expect(ids).not.toContain('g1');
    expect(ids).toEqual(expect.arrayContaining(['g2', 'g3']));
  });

  it('flags expired as red and expiring-soon as yellow', () => {
    const out = selectAtRiskGrants(links, grants, docs, NOW);
    expect(out.find(o => o.grant.id === 'g3')!.tone).toBe('red');
    expect(out.find(o => o.grant.id === 'g2')!.tone).toBe('yellow');
  });

  it('sorts most-urgent first', () => {
    const out = selectAtRiskGrants(links, grants, docs, NOW);
    expect(out[0].grant.id).toBe('g3'); // expired = negative days
  });

  it('drops links whose doc or grant is missing', () => {
    const orphan: ComplianceGrantLink[] = [
      ...links,
      { id: 'lx', grantId: 'missing', complianceDocId: 'd-soon' },
      { id: 'ly', grantId: 'g1', complianceDocId: 'missing' },
    ];
    const out = selectAtRiskGrants(orphan, grants, docs, NOW);
    expect(out).toHaveLength(2);
  });
});
