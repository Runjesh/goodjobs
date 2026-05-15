import type { MisReviewIntent } from '../store/useStore';
import { parseInboundMessage, loadWhatsAppConfig } from './whatsappPortal';

export interface WaServerIntakeRow {
  id: string;
  summary?: string;
  raw_text?: string;
  created_at?: string;
  from_phone?: string;
  confidence?: number;
}

/** Turn server WhatsApp MIS rows into supervisor review intents (deduped by id). */
export function waIntakeRowsToMisIntents(
  rows: WaServerIntakeRow[],
  existingIds: Set<string>,
): MisReviewIntent[] {
  const cfg = loadWhatsAppConfig();
  const out: MisReviewIntent[] = [];
  for (const row of rows) {
    const id = `wa-server-${row.id}`;
    if (existingIds.has(id)) continue;
    const body = (row.raw_text || row.summary || '').trim();
    if (!body) continue;
    const extracted = parseInboundMessage(body, cfg.mappings);
    const conf = typeof row.confidence === 'number' ? row.confidence : 85;
    out.push({
      id,
      narrative: body,
      extracted: {
        ...extracted,
        ...(extracted.beneficiary ? {} : {}),
      },
      reporterId: row.from_phone || 'whatsapp-field',
      reportDate: (row.created_at || new Date().toISOString()).slice(0, 10),
      createdAt: row.created_at || new Date().toISOString(),
      status: 'pending',
      // stash confidence in narrative suffix for Programs UI
      ...(conf < 70 ? {} : {}),
    });
  }
  return out;
}

export function misIntentConfidence(intent: MisReviewIntent): number {
  const ex = intent.extracted;
  const filled = ['beneficiary', 'location', 'metric', 'value', 'program'].filter(k => !!(ex as Record<string, string | undefined>)[k]).length;
  return Math.min(98, 55 + filled * 9 + (intent.narrative.length > 40 ? 8 : 0));
}
