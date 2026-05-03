import { describe, it, expect } from 'vitest';
import { searchEntities } from '../entitySearch';
import type { Donor, Beneficiary, CSRCard, Campaign, Volunteer } from '../../store/useStore';

const donors: Donor[] = [
  { id: '1', name: 'Anjali Desai', type: 'Major Donor', totalGiven: 100000, lastGift: '2026-03-01', initial: 'A', pan: 'ABCD1234E', location: 'Mumbai', tags: [], email: 'a@x.com' },
  { id: '2', name: 'Rohan Gupta', type: 'Recurring', totalGiven: 5000, lastGift: '2026-04-01', initial: 'R', pan: 'ZZZZ9999Z', location: 'Delhi', tags: [] },
];
const beneficiaries: Beneficiary[] = [
  { id: 'B1', name: 'Lakshmi Devi', program: 'Digital Literacy', location: 'Patna', aadhaar: true, familySize: 4 },
];
const csrCards: CSRCard[] = [
  { id: 1, company: 'Tata Consultancy', amount: 500000, project: 'STEM for Girls', tags: [], agent: 'AD', col: 'pitch', date: '' },
  { id: 2, company: 'Infosys Foundation', amount: 800000, project: 'Tata Health Outreach', tags: [], agent: 'RG', col: 'live', date: '' },
];
const campaigns: Campaign[] = [
  { id: 'c1', title: 'Digital Literacy for Rural Girls', raised: 1000, goal: 100000, donorsCount: 5, status: 'active', image: '' },
];
const volunteers: Volunteer[] = [
  { id: 'V1', name: 'Karan Singh', skills: ['Logistics'], hours: 8, verified: false },
];

const idx = { donors, beneficiaries, csrCards, campaigns, volunteers };

describe('searchEntities', () => {
  it('returns nothing for queries shorter than 2 chars', () => {
    expect(searchEntities('a', idx)).toEqual([]);
  });

  it('matches donors by name', () => {
    const r = searchEntities('anj', idx);
    expect(r.some(x => x.kind === 'donor' && x.label === 'Anjali Desai')).toBe(true);
  });

  it('matches beneficiaries by program', () => {
    const r = searchEntities('digital literacy', idx);
    expect(r.some(x => x.kind === 'beneficiary')).toBe(true);
    expect(r.some(x => x.kind === 'campaign')).toBe(true);
    expect(r.some(x => x.kind === 'program')).toBe(true);
  });

  it('matches CSR cards by company snippet', () => {
    const r = searchEntities('tata', idx);
    expect(r.find(x => x.kind === 'csr')?.path).toContain('/csr?card=1');
  });

  it('matches volunteers by skill', () => {
    const r = searchEntities('logistics', idx);
    expect(r.find(x => x.kind === 'team')?.label).toBe('Karan Singh');
  });

  it('encodes donor focus path', () => {
    const r = searchEntities('rohan', idx);
    expect(r[0].path).toBe('/crm?focus=2');
  });

  it('separates active grants (col=live/mou) from CSR pipeline', () => {
    const r = searchEntities('tata', idx);
    const grant = r.find(x => x.kind === 'grant');
    const csr = r.find(x => x.kind === 'csr');
    expect(grant?.path).toBe('/grants/2');
    expect(csr?.path).toBe('/csr?card=1');
  });

  it('matches reports by funder', () => {
    const r = searchEntities('hdfc', idx);
    expect(r.some(x => x.kind === 'report' && x.label.includes('UC Report'))).toBe(true);
  });

  it('matches reports by title keyword', () => {
    const r = searchEntities('board brief', idx);
    expect(r.find(x => x.kind === 'report')?.path).toMatch(/^\/reports\?report=/);
  });
});
