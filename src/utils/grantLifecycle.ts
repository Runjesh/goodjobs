export type TrancheStatus = 'scheduled' | 'awaiting_utilization' | 'released' | 'blocked';

export interface GrantTranche {
  id: string;
  grantId: string;
  /** Sequential number (1, 2, 3...) */
  number: number;
  /** Amount of this tranche in INR. */
  amount: number;
  /** ISO date the tranche is expected. */
  expectedDate: string;
  /** When release is gated on a utilization-report submission. */
  status: TrancheStatus;
  /** ID of the utilization report that unlocks this tranche, if any. */
  utilizationReportId?: string;
  /** Set when status='released'. */
  releasedAt?: string;
}

/**
 * A tranche can only be released after all prior tranches are released AND
 * the funder has accepted its utilization report.
 */
export function canReleaseTranche(t: GrantTranche, all: GrantTranche[]): { ok: boolean; reason?: string } {
  if (t.status === 'released') return { ok: false, reason: 'Already released.' };
  const earlier = all.filter(x => x.grantId === t.grantId && x.number < t.number);
  const blocking = earlier.find(x => x.status !== 'released');
  if (blocking) {
    return { ok: false, reason: `Tranche ${blocking.number} not yet released.` };
  }
  if (t.status === 'awaiting_utilization' && !t.utilizationReportId) {
    return { ok: false, reason: 'Submit utilization report first.' };
  }
  if (t.status === 'blocked') {
    return { ok: false, reason: 'Funder has paused this tranche.' };
  }
  return { ok: true };
}

export function nextActionableTranche(all: GrantTranche[]): GrantTranche | null {
  const sorted = [...all].sort((a, b) => a.number - b.number);
  return sorted.find(t => t.status !== 'released') ?? null;
}
