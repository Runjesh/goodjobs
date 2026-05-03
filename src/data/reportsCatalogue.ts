/**
 * Shared reports catalogue. Lives outside the Reports page so it can be
 * consumed by the command palette's entity index without forcing a circular
 * import. When a real backend list lands, swap this for a store selector and
 * both surfaces stay in sync automatically.
 */

export type ReportType = 'funder' | 'impact' | 'donor' | 'board';

export interface ReportRecord {
  id: string;
  title: string;
  type: ReportType;
  status: 'draft' | 'review' | 'submitted' | 'overdue';
  date: string;
  funder?: string;
}

export const REPORTS_CATALOGUE: ReportRecord[] = [
  { id: '1', title: 'Q2 Progress Report — Tata Trusts',     type: 'funder', status: 'review',    date: '2026-05-15', funder: 'Tata Trusts'  },
  { id: '2', title: 'Annual Impact Report 2025–26',          type: 'impact', status: 'draft',     date: '2026-04-30'  },
  { id: '3', title: 'Donor Impact Update — April 2026',      type: 'donor',  status: 'submitted', date: '2026-04-10'  },
  { id: '4', title: 'Board Brief — Q1 FY 2026–27',           type: 'board',  status: 'submitted', date: '2026-04-01'  },
  { id: '5', title: 'UC Report — CSR Fund Education',         type: 'funder', status: 'overdue',   date: '2026-03-31', funder: 'HDFC Bank CSR' },
];
