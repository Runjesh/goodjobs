/**
 * Grant Parser → Active grant projection.
 *
 * The "Grant Parser preview" panel surfaces extracted rows (deadlines,
 * deliverables, budget heads, compliance conditions) for the team to
 * Approve / Edit / Reject. When a row is approved or edited, the
 * corresponding entry should appear in the Active-stage tabs:
 *
 *   - 'deliverable' → state.deliverables
 *   - 'budget'      → state.budget
 *   - 'deadline'    → state.reports
 *   - 'condition'   → no projection (used for the closure checklist /
 *                     visibility, not the active tabs)
 *
 * Projection is idempotent: existing entries (matched by row id prefix)
 * keep their progress / spent / status fields and only have their label /
 * due / allocated refreshed. Rejected rows are removed from the projected
 * tabs so a user fixing a mistake doesn't leave orphan entries behind.
 */
import type {
  GrantState,
  GrantStateDeliverable,
  GrantStateReport,
  GrantStateBudget,
} from './grantState';

export type ParserRowType = 'deadline' | 'deliverable' | 'budget' | 'condition';

export interface ParserRow {
  id: string;
  type: ParserRowType;
  label: string;
  detail: string;
  confidence: number;
}

export interface ParserExtraction {
  rows: ParserRow[];
  source: 'llm' | 'heuristic' | 'mock';
  doc_id?: string | null;
  doc_name?: string | null;
  extracted_at?: string;
  doc_count?: number;
}

type Decision = 'pending' | 'approved' | 'rejected' | 'edited';

const PROJECTED_PREFIX = 'parser:'; // marks rows that came from a parser row

function offsetDateIso(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);
}

/** Best-effort parse of a "₹12.3L · 60%" detail string into rupees. Returns
 *  0 when the format isn't recognised so the caller can fall back to a
 *  default allocation. */
export function parseRupeesFromDetail(detail: string): number {
  if (!detail) return 0;
  const m = detail.match(/₹\s*([0-9.]+)\s*([LCcrl]?)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return 0;
  const unit = (m[2] || '').toUpperCase();
  if (unit === 'C' || /Cr/i.test(detail)) return Math.round(n * 1e7);
  if (unit === 'L') return Math.round(n * 1e5);
  return Math.round(n);
}

/** Best-effort parse of "month 6 of project" / "Within 30 days" / "Q1 Jan"
 *  into a due date string. Falls back to today + 60 days. */
export function parseDueFromDetail(detail: string, fallbackDays = 60): string {
  if (!detail) return offsetDateIso(fallbackDays);
  const days = detail.match(/within\s+(\d+)\s+days/i);
  if (days) return offsetDateIso(parseInt(days[1], 10));
  const months = detail.match(/at\s+month\s+(\d+)/i);
  if (months) return offsetDateIso(parseInt(months[1], 10) * 30);
  return offsetDateIso(fallbackDays);
}

function projectedId(rowId: string): string {
  return `${PROJECTED_PREFIX}${rowId}`;
}

/**
 * Apply approved/edited rows from the parser to the active-tab state arrays.
 * Returns a new state object.
 */
export function projectParserRowsIntoState(
  rows: ParserRow[],
  decisions: Record<string, Decision>,
  edits: Record<string, string>,
  state: GrantState,
): GrantState {
  // Index existing parser-derived entries so we can preserve user-edited
  // progress/spent/status across re-runs.
  const existingDeliverables = new Map<string, GrantStateDeliverable>();
  const existingBudget = new Map<string, GrantStateBudget>();
  const existingReports = new Map<string, GrantStateReport>();
  for (const d of state.deliverables) existingDeliverables.set(d.id, d);
  for (const b of state.budget) existingBudget.set(b.id, b);
  for (const r of state.reports) existingReports.set(r.id, r);

  // Keep non-parser rows untouched — users may still add manual entries.
  const keptDeliverables = state.deliverables.filter(d => !d.id.startsWith(PROJECTED_PREFIX));
  const keptBudget = state.budget.filter(b => !b.id.startsWith(PROJECTED_PREFIX));
  const keptReports = state.reports.filter(r => !r.id.startsWith(PROJECTED_PREFIX));

  const newDeliverables: GrantStateDeliverable[] = [];
  const newBudget: GrantStateBudget[] = [];
  const newReports: GrantStateReport[] = [];

  for (const row of rows) {
    const decision = decisions[row.id] || 'pending';
    if (decision !== 'approved' && decision !== 'edited') continue;
    const label = (decision === 'edited' && edits[row.id]) ? edits[row.id] : row.label;
    const detail = (decision === 'edited' && edits[row.id]) ? edits[row.id] : row.detail;
    const id = projectedId(row.id);

    if (row.type === 'deliverable') {
      const prev = existingDeliverables.get(id);
      newDeliverables.push({
        id,
        title: label,
        progress: prev?.progress ?? 0,
        due: prev?.due ?? parseDueFromDetail(detail, 60),
      });
    } else if (row.type === 'budget') {
      const prev = existingBudget.get(id);
      const allocated = parseRupeesFromDetail(detail) || prev?.allocated || 0;
      newBudget.push({
        id,
        head: label,
        allocated,
        spent: prev?.spent ?? 0,
      });
    } else if (row.type === 'deadline') {
      const prev = existingReports.get(id);
      newReports.push({
        id,
        title: label,
        status: prev?.status ?? 'draft',
        due: prev?.due ?? parseDueFromDetail(detail, 90),
      });
    }
    // 'condition' rows aren't projected into the active tabs.
  }

  return {
    ...state,
    deliverables: [...keptDeliverables, ...newDeliverables],
    budget: [...keptBudget, ...newBudget],
    reports: [...keptReports, ...newReports],
  };
}
