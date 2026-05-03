/**
 * WhatsApp field portal — config storage + ingestion helpers.
 *
 * Ops teams paste a WhatsApp Business token and configure keyword → field
 * mappings. Incoming WhatsApp messages (real or simulated via the "Test
 * message" button) are parsed against those mappings and dropped into the
 * existing supervisor MisReviewQueue as `MisReviewIntent` records.
 */

import type { MisReviewIntent } from '../store/useStore';

export type WhatsAppMappingTarget = 'beneficiary' | 'location' | 'metric' | 'value' | 'program';

export interface WhatsAppMapping {
  id: string;
  /** Keyword/prefix that triggers extraction (case-insensitive). */
  keyword: string;
  /** Which extracted field this keyword's value populates. */
  target: WhatsAppMappingTarget;
}

export interface WhatsAppPortalConfig {
  token: string;
  phoneNumberId: string;
  mappings: WhatsAppMapping[];
  enabled: boolean;
}

const LS_KEY = 'goodjobs.whatsappPortal.v1';

const DEFAULT_MAPPINGS: WhatsAppMapping[] = [
  { id: 'm-ben',  keyword: 'beneficiary', target: 'beneficiary' },
  { id: 'm-loc',  keyword: 'location',    target: 'location'    },
  { id: 'm-met',  keyword: 'metric',      target: 'metric'      },
  { id: 'm-val',  keyword: 'value',       target: 'value'       },
  { id: 'm-prog', keyword: 'program',     target: 'program'     },
];

export function loadWhatsAppConfig(): WhatsAppPortalConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { token: '', phoneNumberId: '', mappings: DEFAULT_MAPPINGS, enabled: false };
    const parsed = JSON.parse(raw);
    return {
      token:         String(parsed?.token ?? ''),
      phoneNumberId: String(parsed?.phoneNumberId ?? ''),
      mappings:      Array.isArray(parsed?.mappings) && parsed.mappings.length > 0
        ? parsed.mappings as WhatsAppMapping[]
        : DEFAULT_MAPPINGS,
      enabled:       !!parsed?.enabled,
    };
  } catch {
    return { token: '', phoneNumberId: '', mappings: DEFAULT_MAPPINGS, enabled: false };
  }
}

export function saveWhatsAppConfig(cfg: WhatsAppPortalConfig): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

/**
 * Parse an inbound WhatsApp message body into the MisReviewIntent.extracted shape
 * using the configured keyword→target mappings.
 *
 * Accepted line formats (case-insensitive keywords):
 *   beneficiary: Lakshmi Devi
 *   location = Nashik
 *   metric weight_kg
 *   value 52
 *   program women-livelihood-center
 *
 * Lines that don't match any mapping are ignored (but counted in coverage).
 */
export function parseInboundMessage(
  body: string,
  mappings: WhatsAppMapping[],
): MisReviewIntent['extracted'] {
  const out: MisReviewIntent['extracted'] = {};
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // Drop empty / whitespace-only keywords so a half-typed mapping row in the UI
  // can't greedily match every line. Sort longer keywords first so e.g.
  // "metric_kg" wins over "metric" when both are configured.
  const safeMappings = mappings
    .map(m => ({ ...m, keyword: m.keyword.trim() }))
    .filter(m => m.keyword.length > 0)
    .sort((a, b) => b.keyword.length - a.keyword.length);

  for (const line of lines) {
    for (const m of safeMappings) {
      const re = new RegExp(`^${escapeRegex(m.keyword)}\\s*[:=\\-]?\\s*(.+)$`, 'i');
      const match = line.match(re);
      if (match && match[1]) {
        out[m.target] = match[1].trim();
        break;
      }
    }
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build a MisReviewIntent from a raw inbound WhatsApp body, ready to be stored. */
export function buildMisIntentFromWhatsApp(
  body: string,
  reporterId: string,
  mappings: WhatsAppMapping[],
): MisReviewIntent {
  const extracted = parseInboundMessage(body, mappings);
  const now = new Date().toISOString();
  return {
    id: `wa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    narrative: body,
    extracted,
    reporterId,
    reportDate: now.slice(0, 10),
    createdAt: now,
    status: 'pending',
  };
}
