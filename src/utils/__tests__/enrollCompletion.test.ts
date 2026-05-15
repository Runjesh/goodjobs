import { describe, it, expect } from 'vitest';
import {
  buildPostEnrollTasks,
  deriveEnrollCompletion,
  mergeTimelineIntoDetails,
} from '../enrollCompletion';
import type { EnrollFormData } from '../../pages/Programs/EnrollBeneficiaryModal';

const baseForm = (): EnrollFormData => ({
  name: 'Meena Devi',
  dob: '1990-01-01',
  gender: 'female',
  phone: '+919876543210',
  email: '',
  village: 'Piparia',
  location: 'Nashik, MH',
  pinCode: '422001',
  program: 'Healthcare Camp',
  enrollmentDate: '2026-05-15',
  referralSource: 'awc',
  referralDetail: 'AWC-12',
  vulnerabilityTags: [],
  idDocType: 'aadhaar_masked',
  idDocRef: '1234',
  aadhaar: false,
  householdId: '',
  householdHead: '',
  familySize: 3,
  monthlyIncome: '',
  consentLanguage: 'en',
  consentGiven: true,
  consentTimestamp: new Date().toISOString(),
  docAadhaar: '',
  docPhoto: '',
  docOther: '',
  docsSkipped: true,
  notes: '',
});

describe('enrollCompletion', () => {
  it('creates doc collection task when consent given but docs skipped', () => {
    const snap = deriveEnrollCompletion(baseForm(), 'BEN-1');
    const tasks = buildPostEnrollTasks(snap, baseForm());
    expect(tasks.some(t => t.id === 'enroll-docs:BEN-1')).toBe(true);
    expect(tasks.some(t => t.id === 'enroll-aadhaar:BEN-1')).toBe(true);
  });

  it('merges timeline events newest-first cap', () => {
    const merged = mergeTimelineIntoDetails(
      { notes: 'existing' },
      [{ at: '2026-05-15', type: 'enrollment', text: 'Enrolled' }],
    );
    expect(Array.isArray(merged.timeline)).toBe(true);
    expect((merged.timeline as unknown[]).length).toBe(1);
    expect(merged.notes).toBe('existing');
  });
});
