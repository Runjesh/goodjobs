import { describe, it, expect } from 'vitest';
import {
  rollupEffortByProgram,
  selectAssignmentsForVolunteer,
  selectVolunteersForProgram,
  type VolunteerAssignment,
} from '../volunteerProgram';
import { programIdFromName } from '../programFinance';

const PROG = programIdFromName('Women Livelihood Center');
const PROG2 = programIdFromName('Healthcare Camp');

const sample: VolunteerAssignment[] = [
  { id: 'a1', volunteerId: 'V-1', programId: PROG,  programLabel: 'Women Livelihood Center', hours: 10, lastVisit: '2026-04-01', createdAt: '2026-03-01' },
  { id: 'a2', volunteerId: 'V-2', programId: PROG,  programLabel: 'Women Livelihood Center', hours:  6, lastVisit: '2026-04-15', createdAt: '2026-03-10' },
  { id: 'a3', volunteerId: 'V-1', programId: PROG2, programLabel: 'Healthcare Camp',         hours:  4, lastVisit: '2026-02-20', createdAt: '2026-02-01' },
];

describe('volunteerProgram helpers', () => {
  it('rollupEffortByProgram sums hours and counts unique volunteers', () => {
    const r = rollupEffortByProgram(sample);
    const wlc = r.find(x => x.programId === PROG)!;
    expect(wlc.totalHours).toBe(16);
    expect(wlc.volunteerCount).toBe(2);
    expect(wlc.lastVisit).toBe('2026-04-15');
  });

  it('selectAssignmentsForVolunteer filters by volunteer', () => {
    expect(selectAssignmentsForVolunteer(sample, 'V-1').map(a => a.id)).toEqual(['a1', 'a3']);
  });

  it('selectVolunteersForProgram returns unique ids by programme name', () => {
    expect(selectVolunteersForProgram(sample, 'Women Livelihood Center').sort()).toEqual(['V-1', 'V-2']);
    expect(selectVolunteersForProgram(sample, 'Nonexistent')).toEqual([]);
  });
});
