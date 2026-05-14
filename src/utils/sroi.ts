/**
 * Social Return on Investment (SROI) — proper input-cost / monetised-outcome model.
 *
 * Inputs (per programme, persisted to localStorage):
 *   - inputCost        : total ₹ spent on the programme during the period
 *   - perOutcomeValue  : ₹ society pays *per unit of positive change* (HM Treasury-style proxy)
 *   - confidence       : low | medium | high — discounts the monetised value to reflect attribution risk
 *
 * Output (computed from real BeneficiaryOutcome records in the store):
 *   - monetisedValue   : Σ max(0, improvementPct) × perOutcomeValue × confidenceFactor over records
 *   - ratio            : monetisedValue / max(1, inputCost)         → "₹X social value per ₹1 invested"
 *   - confidenceBand   : { low, central, high } numeric bracket for funder reporting
 *
 * The model is deliberately simple but funder-defensible: it replaces the old
 * `avgImprovementPct × beneficiaryCount` heuristic with a monetised proxy
 * tied to actual programme spend.
 */

import { improvementPct, type BeneficiaryOutcome } from './outcomes';

export type SroiConfidence = 'low' | 'medium' | 'high';

export interface SroiProgramInputs {
  programId: string;
  /** Total ₹ spent on this programme during the SROI period. */
  inputCost: number;
  /** ₹ social value per 1% positive improvement, per beneficiary record. */
  perOutcomeValue: number;
  /** Attribution confidence — discounts monetised value. */
  confidence: SroiConfidence;
}

export interface SroiResult {
  programId: string;
  beneficiaryCount: number;
  recordCount: number;
  inputCost: number;
  perOutcomeValue: number;
  confidence: SroiConfidence;
  /** Σ positive improvement (%) across records — the raw outcome quantum. */
  totalImprovementPct: number;
  /** Monetised social value (₹), already discounted by the confidence factor. */
  monetisedValue: number;
  /** Headline ratio: monetisedValue / inputCost. */
  ratio: number;
  /** Funder-grade confidence band around the ratio. */
  confidenceBand: { low: number; central: number; high: number };
}

export const CONFIDENCE_FACTOR: Record<SroiConfidence, number> = {
  low:    0.5,
  medium: 0.75,
  high:   1.0,
};

const CONFIDENCE_BAND_WIDTH: Record<SroiConfidence, number> = {
  low:    0.5,   // ±50% — wide band, low confidence
  medium: 0.25,  // ±25%
  high:   0.1,   // ±10%
};

const LS_KEY = 'goodjobs.sroiInputs.v1';

const DEFAULT_INPUTS: Omit<SroiProgramInputs, 'programId'> = {
  inputCost:       500_000,
  perOutcomeValue: 1_000,
  confidence:      'medium',
};

export function loadSroiInputs(): Record<string, SroiProgramInputs> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveSroiInputs(map: Record<string, SroiProgramInputs>): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

export function getProgramInputs(
  programId: string,
  overrides?: Partial<Record<string, SroiProgramInputs>>,
): SroiProgramInputs {
  const map = overrides ?? loadSroiInputs();
  return map[programId] ?? { programId, ...DEFAULT_INPUTS };
}

export function setProgramInputs(inputs: SroiProgramInputs): Record<string, SroiProgramInputs> {
  const map = loadSroiInputs();
  map[inputs.programId] = inputs;
  saveSroiInputs(map);
  return map;
}

/** Compute SROI for a single programme from raw beneficiary outcome records. */
export function computeSroi(
  programId: string,
  records: BeneficiaryOutcome[],
  inputs?: SroiProgramInputs,
): SroiResult {
  const cfg = inputs ?? getProgramInputs(programId);
  const programRecs = records.filter(r => r.programId === programId);
  const beneficiaryCount = new Set(programRecs.map(r => r.beneficiaryId)).size;

  const positiveImprovements = programRecs
    .map(improvementPct)
    .filter(p => p > 0);
  const totalImprovementPct = positiveImprovements.reduce((s, n) => s + n, 0);

  const factor = CONFIDENCE_FACTOR[cfg.confidence];
  const monetisedValue = totalImprovementPct * cfg.perOutcomeValue * factor;
  const ratio = cfg.inputCost > 0 ? monetisedValue / cfg.inputCost : 0;

  const w = CONFIDENCE_BAND_WIDTH[cfg.confidence];
  const confidenceBand = {
    low:     ratio * (1 - w),
    central: ratio,
    high:    ratio * (1 + w),
  };

  return {
    programId,
    beneficiaryCount,
    recordCount: programRecs.length,
    inputCost: cfg.inputCost,
    perOutcomeValue: cfg.perOutcomeValue,
    confidence: cfg.confidence,
    totalImprovementPct,
    monetisedValue,
    ratio,
    confidenceBand,
  };
}

/** Compute SROI across every programme that has either inputs configured or recorded outcomes. */
export function computeAllSroi(records: BeneficiaryOutcome[]): SroiResult[] {
  const map = loadSroiInputs();
  const programs = new Set<string>([
    ...Object.keys(map),
    ...records.map(r => r.programId),
  ]);
  return Array.from(programs)
    .map(p => computeSroi(p, records, map[p]))
    .sort((a, b) => b.ratio - a.ratio);
}

/** Aggregate ratio across programmes — total monetised value over total input cost. */
export function portfolioSroi(results: SroiResult[]): {
  totalCost: number;
  totalValue: number;
  ratio: number;
} {
  const totalCost  = results.reduce((s, r) => s + r.inputCost, 0);
  const totalValue = results.reduce((s, r) => s + r.monetisedValue, 0);
  return {
    totalCost,
    totalValue,
    ratio: totalCost > 0 ? totalValue / totalCost : 0,
  };
}

/** Build a funder-formatted SROI CSV (string). */
export function buildSroiCsv(results: SroiResult[]): string {
  const portfolio = portfolioSroi(results);
  const fmt = (n: number) => Math.round(n).toString();
  const ratio = (n: number) => n.toFixed(2);

  const header = [
    'Programme',
    'Beneficiaries measured',
    'Outcome records',
    'Total positive improvement (%)',
    'Per-outcome social value (INR)',
    'Confidence',
    'Programme cost (INR)',
    'Monetised social value (INR)',
    'SROI ratio',
    'Confidence band low',
    'Confidence band high',
  ];
  const rows = results.map(r => [
    r.programId,
    r.beneficiaryCount,
    r.recordCount,
    r.totalImprovementPct.toFixed(1),
    fmt(r.perOutcomeValue),
    r.confidence,
    fmt(r.inputCost),
    fmt(r.monetisedValue),
    ratio(r.ratio),
    ratio(r.confidenceBand.low),
    ratio(r.confidenceBand.high),
  ]);
  const totals = [
    'PORTFOLIO TOTAL',
    '', '', '', '', '',
    fmt(portfolio.totalCost),
    fmt(portfolio.totalValue),
    ratio(portfolio.ratio),
    '', '',
  ];

  return [header, ...rows, totals]
    .map(r => r.map(cell => {
      const s = String(cell);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\n');
}
