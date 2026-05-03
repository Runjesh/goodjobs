// Volunteer shift conflict detection.
// We treat two shifts as conflicting when (a) they fall on the same calendar
// day AND (b) their time intervals actually intersect. When a shift's date
// string contains no parseable time window, we fall back to same-day match
// (better to over-warn than silently double-book).

export interface ParsedShiftInterval {
  dayKey: string | null;     // YYYY-MM-DD when known, otherwise a normalised day token
  startMin: number | null;   // minutes since midnight
  endMin: number | null;     // minutes since midnight (>= startMin; +24h if range crosses midnight)
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number): string { return n < 10 ? `0${n}` : `${n}`; }

// Build YYYY-MM-DD when we can confidently spot a date in the string.
// Returns the key plus the matched substring so callers can strip it before
// scanning for time intervals (avoids ISO hyphens being read as time ranges).
function extractDayKey(raw: string): { key: string | null; matched: string | null } {
  const s = raw.toLowerCase();
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { key: `${iso[1]}-${iso[2]}-${iso[3]}`, matched: iso[0] };
  const dm = s.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(?:\w*)?\s*(\d{4})?/);
  if (dm) {
    const day = parseInt(dm[1], 10);
    const month = MONTHS[dm[2]];
    const year = dm[3] ? parseInt(dm[3], 10) : new Date().getFullYear();
    if (day && month) return { key: `${year}-${pad(month)}-${pad(day)}`, matched: dm[0] };
  }
  const md = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(?:\w*)?\s+(\d{1,2})(?:,\s*(\d{4}))?/);
  if (md) {
    const month = MONTHS[md[1]];
    const day = parseInt(md[2], 10);
    const year = md[3] ? parseInt(md[3], 10) : new Date().getFullYear();
    if (day && month) return { key: `${year}-${pad(month)}-${pad(day)}`, matched: md[0] };
  }
  const token = s.split(/[•|@]/)[0].trim();
  return { key: token || null, matched: null };
}

// Return minutes-since-midnight from a token like "9", "9am", "11:30", "13:45", "11pm".
function tokenToMinutes(tok: string): number | null {
  const m = tok.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const mer = m[3];
  if (mer === 'am') { if (h === 12) h = 0; }
  else if (mer === 'pm') { if (h !== 12) h += 12; }
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

// Extract a [start,end) minute interval. Supports "9–11am", "9am-11am",
// "09:00 to 11:30", "9-11pm" (meridiem propagates rightward).
function extractInterval(raw: string): { start: number | null; end: number | null } {
  const s = raw.toLowerCase();
  const range = s.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:[–\-—~]|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/);
  if (!range) return { start: null, end: null };
  let leftTok = range[1].trim();
  const rightTok = range[2].trim();
  // If left has no meridiem but right does, propagate.
  if (!/am|pm/.test(leftTok) && /am|pm/.test(rightTok)) {
    const mer = rightTok.match(/am|pm/)![0];
    leftTok = `${leftTok}${mer}`;
  }
  const start = tokenToMinutes(leftTok);
  let end = tokenToMinutes(rightTok);
  if (start != null && end != null && end < start) end += 24 * 60; // crosses midnight
  return { start, end };
}

export function parseShiftInterval(raw: string | undefined | null): ParsedShiftInterval {
  if (!raw) return { dayKey: null, startMin: null, endMin: null };
  const lower = String(raw).toLowerCase();
  const { key, matched } = extractDayKey(lower);
  // Strip the date substring before scanning for time intervals so ISO hyphens
  // (e.g. "2026-05-14") aren't mistaken for "5 to 14" as a time range.
  const remainder = matched ? lower.replace(matched, ' ') : lower;
  const { start, end } = extractInterval(remainder);
  return { dayKey: key, startMin: start, endMin: end };
}

// Inclusive-exclusive interval overlap: [a1,a2) ∩ [b1,b2) ≠ ∅
export function intervalsOverlap(a1: number, a2: number, b1: number, b2: number): boolean {
  return a1 < b2 && b1 < a2;
}

export interface ConflictableShift { id: number | string; date: string; title?: string }

export function findShiftConflict<T extends ConflictableShift>(
  target: T,
  others: T[],
): T | null {
  const t = parseShiftInterval(target.date);
  // Duplicate signup for the *same* shift is itself a conflict — block client-side
  // so the operator gets the same inline UX and we don't rely on a backend 409.
  for (const o of others) {
    if (String(o.id) === String(target.id)) return o;
  }
  if (!t.dayKey) return null;
  for (const o of others) {
    const p = parseShiftInterval(o.date);
    if (!p.dayKey || p.dayKey !== t.dayKey) continue;
    // Both have intervals → require real overlap.
    if (t.startMin != null && t.endMin != null && p.startMin != null && p.endMin != null) {
      if (intervalsOverlap(t.startMin, t.endMin, p.startMin, p.endMin)) return o;
      continue;
    }
    // Missing time info on either side → fall back to same-day warn (safer).
    return o;
  }
  return null;
}
