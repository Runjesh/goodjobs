// Compliance proactive reminders.
// Scans upcoming filings + board-member tenures and persists a normalised
// reminder list to localStorage. The Dashboard "Today" surface reads this
// list to render Urgent / Attention items so operators see the same warnings
// the Compliance tab knows about — without requiring backend push.

export interface ComplianceReminder {
  id: string;
  text: string;
  level: 'urgent' | 'attention';
  path: string;
  daysUntil: number; // negative = overdue
  source: 'filing' | 'board';
  refId: string;
}

const STORAGE_KEY = 'goodjobs.compliance_reminders.v1';
const TOAST_DEDUP_KEY = 'goodjobs.compliance_reminders.toasted.v1';

const MS_PER_DAY = 86_400_000;

export interface FilingLite { id: number | string; name: string; due: string; assignee?: string }
export interface BoardLite  { id: string; name: string; role: string; din?: string; tenure?: string }

// Best-effort date extraction. Accepts ISO ("2026-12-31"), short forms
// ("Dec 31, 2026"), and date-only fragments. Returns null when nothing parseable.
function parseDueDate(input: string | undefined | null): Date | null {
  if (!input) return null;
  const s = String(input).trim();
  // Already-iso fast path
  const iso = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    const d = new Date(iso[1]);
    if (!isNaN(d.getTime())) return d;
  }
  const direct = new Date(s);
  if (!isNaN(direct.getTime())) return direct;
  return null;
}

// "Until 2026-12-31" / "Term ends 2026-12-31" / "Since 2024" → due date for tenure end.
// "Since 2024" alone has no end date so we return null (we don't fabricate one).
function parseTenureEnd(tenure: string | undefined | null): Date | null {
  if (!tenure) return null;
  const s = String(tenure).trim();
  if (/^since\b/i.test(s)) return null;
  // Look for "until|ends|expir(es|y)" markers, otherwise pick the last ISO-ish date.
  const marker = s.match(/(?:until|ends?|expir(?:es|y)?|through|to)\s*[:\-]?\s*(.+)$/i);
  const candidate = marker ? marker[1] : s;
  return parseDueDate(candidate);
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

export function buildComplianceReminders(
  filings: FilingLite[],
  board: BoardLite[],
  now: Date = new Date(),
): ComplianceReminder[] {
  const out: ComplianceReminder[] = [];

  for (const f of filings || []) {
    const d = parseDueDate(f.due);
    if (!d) continue;
    const days = daysBetween(now, d);
    if (days > 30) continue;
    const level: ComplianceReminder['level'] = days <= 7 ? 'urgent' : 'attention';
    const text = days < 0
      ? `Filing "${f.name}" is ${Math.abs(days)}d overdue${f.assignee ? ` — ${f.assignee}` : ''}`
      : days === 0
        ? `Filing "${f.name}" is due today${f.assignee ? ` — ${f.assignee}` : ''}`
        : `Filing "${f.name}" due in ${days}d${f.assignee ? ` — ${f.assignee}` : ''}`;
    out.push({
      id: `compl-filing-${String(f.id)}`,
      text,
      level,
      path: '/compliance',
      daysUntil: days,
      source: 'filing',
      refId: String(f.id),
    });
  }

  for (const m of board || []) {
    const end = parseTenureEnd(m.tenure);
    if (!end) continue;
    const days = daysBetween(now, end);
    if (days > 30) continue;
    const level: ComplianceReminder['level'] = days <= 7 ? 'urgent' : 'attention';
    const text = days < 0
      ? `Board tenure ended for ${m.name} (${m.role}) ${Math.abs(days)}d ago — refresh appointment`
      : `Board tenure for ${m.name} (${m.role}) ends in ${days}d — schedule renewal`;
    out.push({
      id: `compl-board-${m.id}`,
      text,
      level,
      path: '/compliance',
      daysUntil: days,
      source: 'board',
      refId: m.id,
    });
  }

  // Sort: most urgent first.
  out.sort((a, b) => a.daysUntil - b.daysUntil);
  return out;
}

export function persistComplianceReminders(rs: ComplianceReminder[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rs));
  } catch {
    /* ignore — best-effort cache */
  }
}

export function readComplianceReminders(): ComplianceReminder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ComplianceReminder[];
  } catch {
    return [];
  }
}

// Returns the subset of reminder ids the operator hasn't been toasted about
// during the current browser session (so we nudge once per visit, not per render).
export function pickUntoastedReminders(rs: ComplianceReminder[]): ComplianceReminder[] {
  let seen: Set<string>;
  try {
    const raw = sessionStorage.getItem(TOAST_DEDUP_KEY);
    seen = new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    seen = new Set();
  }
  const fresh = rs.filter(r => !seen.has(r.id));
  if (fresh.length === 0) return [];
  for (const r of fresh) seen.add(r.id);
  try {
    sessionStorage.setItem(TOAST_DEDUP_KEY, JSON.stringify([...seen]));
  } catch {
    /* ignore */
  }
  return fresh;
}
