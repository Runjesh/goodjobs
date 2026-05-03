/**
 * Grant lifecycle state — shape, merge, and JSON-safe coercion.
 *
 * This module is the single source of truth for the per-grant state object
 * that GrantDetail.tsx round-trips through localStorage AND the backend (via
 * GET/PUT /csr/cards/{id}/grant-state, see Task #6). The merge helper keeps
 * the LS cache and server payload reconcilable on first load — server fields
 * win when present, and missing fields fall through to whatever the client
 * already had so a partial server response can never blank out local edits.
 */

export type ParserDecision = 'pending' | 'approved' | 'rejected' | 'edited';
export type ReportStatus = 'draft' | 'in_review' | 'submitted';

export interface GrantStateDeliverable {
  id: string; title: string; progress: number; due: string;
}
export interface GrantStateReport {
  id: string; title: string; status: ReportStatus; due: string;
}
export interface GrantStateBudget {
  id: string; head: string; allocated: number; spent: number;
}
export interface GrantStateClosureSummary {
  beneficiariesServed: number;
  outcomes: string[];
}

export interface GrantState {
  notes: string;
  decisionDate: string;
  followUpDate: string;
  parserDecisions: Record<string, ParserDecision>;
  parserEdits: Record<string, string>;
  deliverables: GrantStateDeliverable[];
  reports: GrantStateReport[];
  budget: GrantStateBudget[];
  nextReportDue: string;
  closureChecklist: Record<string, boolean>;
  closureSummary: GrantStateClosureSummary;
  closingMode: boolean;
  isClosed: boolean;
}

/**
 * Merge a base state with an override. Override fields win when present
 * (non-null/undefined); arrays are replaced wholesale (not concatenated)
 * because the source-of-truth for deliverables/reports/budget rows is the
 * latest write, not a union. Records (parserDecisions / parserEdits /
 * closureChecklist) are deep-merged so two users writing different keys
 * don't clobber each other on first reconciliation.
 */
export function mergeGrantState(base: GrantState, override: Partial<GrantState> | null | undefined): GrantState {
  if (!override) return base;
  const out: GrantState = { ...base };

  for (const key of Object.keys(override) as (keyof GrantState)[]) {
    const v = override[key];
    if (v === undefined || v === null) continue;
    switch (key) {
      case 'parserDecisions':
      case 'parserEdits':
      case 'closureChecklist':
        // Shallow record merge — override wins on conflicts.
        (out as Record<string, unknown>)[key] = {
          ...(base[key] as Record<string, unknown>),
          ...(v as Record<string, unknown>),
        };
        break;
      case 'closureSummary': {
        const ov = v as Partial<GrantStateClosureSummary>;
        out.closureSummary = {
          beneficiariesServed: ov.beneficiariesServed ?? base.closureSummary.beneficiariesServed,
          outcomes: Array.isArray(ov.outcomes) ? ov.outcomes : base.closureSummary.outcomes,
        };
        break;
      }
      default:
        (out as Record<string, unknown>)[key] = v as unknown;
    }
  }
  return out;
}

/**
 * Strip values that aren't JSON-safe before sending to the backend. Numbers
 * are clamped to finite, strings/arrays/objects pass through as-is.
 */
export function sanitiseGrantStateForServer(s: GrantState): GrantState {
  const safeNum = (n: unknown, fallback = 0): number => {
    const v = Number(n);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    ...s,
    deliverables: (s.deliverables || []).map(d => ({
      ...d,
      progress: Math.max(0, Math.min(100, safeNum(d.progress))),
    })),
    budget: (s.budget || []).map(b => ({
      ...b,
      allocated: safeNum(b.allocated),
      spent: safeNum(b.spent),
    })),
    closureSummary: {
      beneficiariesServed: safeNum(s.closureSummary?.beneficiariesServed),
      outcomes: Array.isArray(s.closureSummary?.outcomes) ? s.closureSummary.outcomes : [],
    },
  };
}
