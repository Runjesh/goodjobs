/** Minimal RFC-style CSV parser (quoted fields, commas in quotes). */
export function parseCsvToRecords(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || (c === '\r' && next === '\n')) {
      row.push(field);
      field = '';
      if (row.some(cell => cell.trim().length)) rows.push(row);
      row = [];
      if (c === '\r') i++;
    } else if (c !== '\r') {
      field += c;
    }
  }
  row.push(field);
  if (row.some(cell => cell.trim().length)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const vals = rows[r];
    const obj: Record<string, string> = {};
    headers.forEach((h, j) => {
      obj[h] = (vals[j] ?? '').trim();
    });
    out.push(obj);
  }
  return out;
}
