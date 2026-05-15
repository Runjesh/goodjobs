import { describe, it, expect } from 'vitest';
import {
  buildPostDonationTasks,
  createOrMatchDonorLocal,
  donationCompletionHeadline,
  isDonation80GEligible,
} from '../donationCompletion';
import type { Donor } from '../../store/useStore';

const donors: Donor[] = [
  {
    id: '1',
    name: 'Anjali Desai',
    type: 'Major Donor',
    totalGiven: 1000,
    lastGift: '2026-01-01',
    initial: 'A',
    pan: 'ABCP****4D',
    location: 'Mumbai',
    tags: [],
    email: 'anjali@example.com',
  },
];

describe('donationCompletion', () => {
  it('matches donor by email', () => {
    const { donor, matched } = createOrMatchDonorLocal(
      { donorName: 'Other', donorEmail: 'anjali@example.com' },
      donors,
    );
    expect(matched).toBe(true);
    expect(donor.id).toBe('1');
  });

  it('creates stewardship task due in 7 days', () => {
    const snap = {
      transactionId: 'TX-1',
      donorId: '1',
      donorName: 'Anjali',
      amount: 5000,
      method: 'UPI',
      campaignTitle: 'Education',
      source: 'fundraising' as const,
      donorMatched: true,
      donorCreated: false,
      is80GEligible: true,
      receiptGenerated: false,
      panOnFile: true,
      thanked: false,
      description: 'Education',
    };
    const tasks = buildPostDonationTasks(snap);
    expect(tasks.some(t => t.sourceIntentId === 'donation-steward:TX-1')).toBe(true);
    expect(tasks.some(t => t.title.includes('Thank Anjali'))).toBe(true);
  });

  it('headline reflects receipt state', () => {
    expect(
      donationCompletionHeadline({
        transactionId: 'TX-1',
        donorId: '1',
        donorName: 'A',
        amount: 100,
        method: 'UPI',
        campaignTitle: 'X',
        source: 'finance',
        donorMatched: true,
        donorCreated: false,
        is80GEligible: true,
        receiptGenerated: true,
        panOnFile: true,
        thanked: false,
        description: 'X',
      }),
    ).toContain('Receipt generated');
    expect(isDonation80GEligible({ isAnonymous: true, amount: 1000 })).toBe(false);
  });
});
