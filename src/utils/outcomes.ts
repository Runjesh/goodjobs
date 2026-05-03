export interface BeneficiaryOutcome {
  id: string;
  beneficiaryId: string;
  programId: string;
  /** Logical metric (e.g. "weight_kg", "literacy_score", "monthly_income"). */
  metric: string;
  /** Display label users see in the form. */
  metricLabel: string;
  /** Pre-intervention baseline. */
  baseline: number;
  /** Most recent measurement. */
  current: number;
  /** Higher-is-better (true) or lower-is-better (false). */
  higherIsBetter: boolean;
  /** Optional unit ("kg", "%", "₹"). */
  unit?: string;
  /** ISO date of the latest measurement. */
  measuredAt: string;
  /** Optional supervisor note. */
  note?: string;
}

export interface OutcomeAggregate {
  programId: string;
  beneficiaryCount: number;
  recordCount: number;
  /** Avg % improvement weighted equally across records. */
  avgImprovementPct: number;
  /** Output→outcome ratio: % of recorded beneficiaries who showed positive change. */
  outcomeRatio: number;
  /** Simple SROI estimate: improvementPct × beneficiaryCount, no monetary scaling. */
  sroiScore: number;
}

export function improvementPct(o: BeneficiaryOutcome): number {
  if (!Number.isFinite(o.baseline) || o.baseline === 0) return 0;
  const delta = (o.current - o.baseline) / Math.abs(o.baseline);
  return o.higherIsBetter ? delta * 100 : -delta * 100;
}

export function aggregateByProgram(records: BeneficiaryOutcome[]): OutcomeAggregate[] {
  const byProg = new Map<string, BeneficiaryOutcome[]>();
  for (const r of records) {
    const arr = byProg.get(r.programId) ?? [];
    arr.push(r);
    byProg.set(r.programId, arr);
  }

  const out: OutcomeAggregate[] = [];
  byProg.forEach((items, programId) => {
    const beneficiaryCount = new Set(items.map(i => i.beneficiaryId)).size;
    const improvements = items.map(improvementPct);
    const avgImprovementPct = improvements.reduce((s, n) => s + n, 0) / Math.max(1, improvements.length);
    const positive = improvements.filter(p => p > 0).length;
    const outcomeRatio = positive / Math.max(1, improvements.length);
    out.push({
      programId,
      beneficiaryCount,
      recordCount: items.length,
      avgImprovementPct,
      outcomeRatio,
      sroiScore: Math.max(0, avgImprovementPct) * beneficiaryCount / 100,
    });
  });
  return out.sort((a, b) => b.sroiScore - a.sroiScore);
}
