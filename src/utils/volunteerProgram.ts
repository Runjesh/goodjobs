import { programIdFromName } from './programFinance';

/**
 * A volunteer assigned to a programme. Hours accumulate per assignment so
 * an NGO can answer "who actually delivered this programme?" — closing the
 * Volunteer ↔ Program loop the audit flagged.
 */
export interface VolunteerAssignment {
  id: string;
  volunteerId: string;
  /** Slugified program id (use programIdFromName when creating). */
  programId: string;
  /** Display label kept on the row so we don't have to re-derive it. */
  programLabel: string;
  /** Cumulative hours logged on this assignment. */
  hours: number;
  /** Last visit / activity date (ISO yyyy-mm-dd). */
  lastVisit?: string;
  /** Role on this programme (e.g. "Trainer", "Surveyor"). */
  role?: string;
  createdAt: string;
}

export interface ProgramEffortRollup {
  programId: string;
  programLabel: string;
  volunteerCount: number;
  totalHours: number;
  /** Most recent visit across all volunteers, ISO date or null. */
  lastVisit: string | null;
}

export function rollupEffortByProgram(assignments: VolunteerAssignment[]): ProgramEffortRollup[] {
  const map = new Map<string, ProgramEffortRollup>();
  for (const a of assignments) {
    const cur = map.get(a.programId) ?? {
      programId: a.programId,
      programLabel: a.programLabel,
      volunteerCount: 0,
      totalHours: 0,
      lastVisit: null as string | null,
    };
    cur.totalHours += a.hours;
    cur.volunteerCount += 1; // counts assignments; for unique volunteers see selectVolunteersForProgram
    if (a.lastVisit && (!cur.lastVisit || a.lastVisit > cur.lastVisit)) cur.lastVisit = a.lastVisit;
    map.set(a.programId, cur);
  }
  // De-dupe volunteer counts
  for (const r of map.values()) {
    r.volunteerCount = new Set(
      assignments.filter(a => a.programId === r.programId).map(a => a.volunteerId),
    ).size;
  }
  return Array.from(map.values()).sort((a, b) => b.totalHours - a.totalHours);
}

export function selectAssignmentsForVolunteer(all: VolunteerAssignment[], volunteerId: string): VolunteerAssignment[] {
  return all.filter(a => a.volunteerId === volunteerId);
}

export function selectVolunteersForProgram(all: VolunteerAssignment[], programName: string): string[] {
  const pid = programIdFromName(programName);
  return Array.from(new Set(all.filter(a => a.programId === pid).map(a => a.volunteerId)));
}
