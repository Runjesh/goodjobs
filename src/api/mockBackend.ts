/**
 * In-browser mock backend.
 *
 * GoodJobs ships as a frontend-only deployment for the demo / pilot tier.
 * Many features POST to a FastAPI service that simply isn't there. Without a
 * fallback, every action button surfaces a "backend not reachable" toast and
 * the product feels broken.
 *
 * This module synthesises plausible HTTP responses so the UI stays usable
 * end-to-end. It is intentionally permissive — any unknown POST returns
 * `{ ok: true, id: <nanoid> }`, any unknown GET returns `{}` — so newly added
 * endpoints don't regress to a hard failure.
 *
 * Persistence: side effects from POSTs are written to localStorage under the
 * `goodjobs.mock.*` namespace so the user sees their data on refresh.
 *
 * To force the real backend (e.g. when wiring FastAPI), set
 *   localStorage.setItem('goodjobs_mock_backend', 'off');
 */

const MOCK_TOGGLE_KEY = 'goodjobs_mock_backend'; // 'on' | 'off'
const MOCK_FLAG_LS = 'goodjobs.mock.lastUsed';

/**
 * Whether the mock fallback is allowed to synthesise responses.
 *
 * Default policy:
 *   - Dev builds (`import.meta.env.DEV`): ON. The local FastAPI is often
 *     not running and we want every button to keep working.
 *   - Production builds: OFF unless explicitly enabled via build-time
 *     `VITE_ENABLE_MOCK_BACKEND=true` (for static-only demo deploys), the
 *     runtime localStorage toggle `goodjobs_mock_backend=on`, OR the API
 *     base URL resolves to the same origin as the page (i.e. no separate
 *     backend host has been configured — a static-only deploy).
 *
 * This prevents two failure modes flagged in code review:
 *   1. Auth bypass: if a real backend is misconfigured in prod, /auth/login
 *      would otherwise return a synthetic token and let anyone in.
 *   2. Silent data loss: if a real backend returns 404/502 from a gateway,
 *      POSTs would otherwise "succeed" against the mock and lose writes.
 */
export function isMockEnabled(): boolean {
  try {
    const ls = localStorage.getItem(MOCK_TOGGLE_KEY);
    if (ls === 'on')  return true;
    if (ls === 'off') return false;
  } catch { /* ignore */ }

  let isDev = false;
  let buildFlag = false;
  let configuredBase = '';
  try {
    isDev = !!import.meta.env.DEV;
    buildFlag = String(import.meta.env.VITE_ENABLE_MOCK_BACKEND ?? '').toLowerCase() === 'true';
    configuredBase = String(import.meta.env.VITE_API_BASE_URL ?? '').trim();
  } catch { /* ignore */ }

  if (isDev) return true;
  if (buildFlag) return true;

  // Static-only deploy detection: if the operator did NOT configure a
  // separate API base URL, then the static origin is the only "backend"
  // the app could reach, which means there is effectively no backend.
  // In that case, fall through to the mock so the demo stays usable.
  if (!configuredBase && typeof window !== 'undefined') {
    return true;
  }

  return false;
}

/** Auth endpoints are never mocked in production-ish modes (see isMockEnabled).
 * Even when the mock is enabled, we keep auth endpoints honest unless the
 * operator explicitly opts in via VITE_ENABLE_MOCK_AUTH=true or the runtime
 * localStorage toggle goodjobs_mock_auth=on. */
function isAuthMockAllowed(): boolean {
  try {
    const ls = localStorage.getItem('goodjobs_mock_auth');
    if (ls === 'on')  return true;
    if (ls === 'off') return false;
  } catch { /* ignore */ }
  try {
    if (import.meta.env.DEV) return true;
    if (String(import.meta.env.VITE_ENABLE_MOCK_AUTH ?? '').toLowerCase() === 'true') return true;
  } catch { /* ignore */ }
  return false;
}

/** Set on first mock fallback so the UI can show a "Demo mode" pill. */
export function markMockUsed(): void {
  try { localStorage.setItem(MOCK_FLAG_LS, String(Date.now())); } catch { /* ignore */ }
}

export function wasMockEverUsed(): boolean {
  try { return !!localStorage.getItem(MOCK_FLAG_LS); } catch { return false; }
}

function rid(prefix = 'm'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function readBody(init?: RequestInit): any {
  if (!init?.body || typeof init.body !== 'string') return {};
  try { return JSON.parse(init.body); } catch { return {}; }
}

const method = (init?: RequestInit) => (init?.method ?? 'GET').toUpperCase();

// ── Per-path handlers ────────────────────────────────────────────────────────

interface Handler {
  test: (path: string, m: string) => boolean;
  handle: (path: string, init?: RequestInit) => Response;
}

const HANDLERS: Handler[] = [
  // ── MIS field reports — the original complaint ─────────────────────────────
  {
    test: (p, m) => m === 'POST' && p.startsWith('/webhook/field-report'),
    handle: (_p, init) => {
      const body = readBody(init);
      const text: string = body.report_text ?? '';
      // Lightweight extraction so the user sees their input reflected back.
      const nameMatch = text.match(/(?:visited|met|spoke with|enrolled)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
      const villageMatch = text.match(/(?:village|block|district)\s+([A-Z][a-zA-Z]+)/i);
      const weightMatch = text.match(/(\d{1,3})\s*kg/i);
      const numMatch = text.match(/(\d+)\s+(women|men|children|students|beneficiaries|families)/i);
      return jsonResponse({
        ok: true,
        job_id: rid('mis'),
        status: 'queued',
        parsed: {
          beneficiary_name: nameMatch?.[1] ?? null,
          location: villageMatch?.[1] ?? null,
          metric: weightMatch ? `weight: ${weightMatch[1]} kg` : numMatch ? `${numMatch[1]} ${numMatch[2]}` : null,
          program: body.program ?? null,
          report_date: body.report_date ?? new Date().toISOString().slice(0, 10),
        },
        message: 'MIS Agent will process this in the background.',
      });
    },
  },

  // ── Auth (mocked only when isAuthMockAllowed — see top of file) ────────────
  {
    test: (p, m) => isAuthMockAllowed() && m === 'POST' && p === '/auth/login',
    handle: () => jsonResponse({ access_token: rid('tok'), token_type: 'bearer' }),
  },
  {
    test: (p, m) => isAuthMockAllowed() && m === 'GET' && p === '/auth/me',
    handle: () => jsonResponse({}),
  },
  {
    test: (p, m) => isAuthMockAllowed() && m === 'POST' && (p === '/auth/change-password' || p === '/auth/sessions/revoke-other'),
    handle: () => jsonResponse({ ok: true }),
  },
  // Hard-fail any other /auth/* path so production can't accidentally bypass.
  {
    test: (p) => p.startsWith('/auth/'),
    handle: () => jsonResponse({ error: 'auth_endpoint_not_mocked' }, 503),
  },

  // ── Morning brief / agent HQ summaries ─────────────────────────────────────
  {
    test: (_p, m) => m === 'GET' && _p.startsWith('/morning-brief'),
    handle: () => jsonResponse({ priorities: [] }),
  },
  {
    test: (p, m) => m === 'GET' && p === '/agent-hq/summary',
    handle: () => jsonResponse({
      agents: ['Grant Report Agent', 'Donor Nurture Agent', 'Compliance Guardian'],
      pending_approvals: 0,
      agent_streaks: [],
      alerts: [],
      auto_approve_max_inr: null,
    }),
  },
  {
    test: (p, m) => m === 'GET' && p === '/agent-hq/audit',
    handle: () => jsonResponse({ logs: [] }),
  },
  {
    test: (p, m) => m === 'POST' && p === '/agent-hq/prefs',
    handle: () => jsonResponse({ ok: true }),
  },

  // ── Intent queue ───────────────────────────────────────────────────────────
  {
    test: (p, m) => m === 'GET' && p.startsWith('/intent/queue'),
    handle: () => jsonResponse({ items: [] }),
  },
  {
    test: (p, m) => m === 'POST' && p.startsWith('/intent/queue/') && p.endsWith('/decision'),
    handle: (_p, init) => {
      const body = readBody(init);
      return jsonResponse({ ok: true, decision: body.decision ?? 'approved' });
    },
  },
  {
    test: (p, m) => m === 'POST' && p.startsWith('/intent/queue/') && p.endsWith('/execute'),
    handle: () => jsonResponse({ ok: true, status: 'executed', execution_id: rid('exec'), summary: 'Action completed (demo).' }),
  },
  {
    test: (p, m) => m === 'POST' && p.startsWith('/intent/process'),
    handle: () => jsonResponse({ ok: true, intent_id: rid('intent'), parsed: { confidence: 0.92 } }),
  },
  {
    test: (p, m) => m === 'POST' && p.startsWith('/intent/parse'),
    handle: (_p, init) => {
      const body = readBody(init);
      return jsonResponse({ ok: true, parsed: { directive: body.text ?? body.directive ?? '', confidence: 0.9 } });
    },
  },

  // ── Triggers ───────────────────────────────────────────────────────────────
  {
    test: (p, m) => m === 'POST' && p.startsWith('/trigger/'),
    handle: (p) => jsonResponse({
      ok: true,
      trigger: p.replace('/trigger/', ''),
      job_id: rid('job'),
      message: 'Agent run queued (demo).',
    }),
  },

  // ── Analytics / propensity ────────────────────────────────────────────────
  {
    test: (p, m) => m === 'POST' && p === '/analytics/donor-propensity-batch',
    handle: (_p, init) => {
      const body = readBody(init);
      const ids: string[] = Array.isArray(body.donor_ids) ? body.donor_ids : [];
      return jsonResponse({
        scores: ids.map(id => ({
          donor_id: id,
          score: Math.round(40 + Math.random() * 55),
          band: Math.random() > 0.66 ? 'high' : Math.random() > 0.33 ? 'mid' : 'low',
          next_action: 'Send a quarterly impact update',
        })),
      });
    },
  },
  {
    test: (p, m) => m === 'GET' && p.startsWith('/analytics/donor-propensity/'),
    handle: () => jsonResponse({ score: 72, band: 'mid', drivers: ['Recency: 45 days', 'Channel: WhatsApp'], next_action: 'Send personalised impact note' }),
  },

  // ── Gen-AI ─────────────────────────────────────────────────────────────────
  {
    test: (p, m) => m === 'POST' && p === '/gen-ai/draft-report',
    handle: (_p, init) => {
      const body = readBody(init);
      return jsonResponse({
        ok: true,
        report_id: rid('rpt'),
        title: body.title ?? 'Draft Report',
        markdown: `# ${body.title ?? 'Draft Report'}\n\n_(Generated locally in demo mode.)_\n\n## Summary\nThis is a placeholder draft. Connect a backend to enable live AI drafting.`,
      });
    },
  },
  {
    test: (p, m) => m === 'POST' && p.startsWith('/gen-ai/sentiment'),
    handle: () => jsonResponse({ sentiment: 'positive', score: 0.78 }),
  },
  {
    test: (p, m) => m === 'POST' && p === '/gen-ai/summarize',
    handle: () => jsonResponse({ summary: 'Summary unavailable in demo mode.' }),
  },

  // ── Workflows ──────────────────────────────────────────────────────────────
  {
    test: (p, m) => m === 'POST' && p.startsWith('/workflows/classify-transaction'),
    handle: () => jsonResponse({ category: 'Programs · Beneficiary support', confidence: 0.84 }),
  },
  {
    test: (p, m) => m === 'POST' && p.startsWith('/workflows/suggest-goal'),
    handle: () => jsonResponse({ suggested_goal_inr: 500000, rationale: 'Based on similar campaigns in this cause area.' }),
  },

  // ── Webhooks ───────────────────────────────────────────────────────────────
  {
    test: (p, m) => m === 'POST' && p.startsWith('/webhook/donation'),
    handle: () => jsonResponse({ ok: true, transaction_id: rid('trx') }),
  },

  // ── Per-card grant lifecycle state (Task #6) ───────────────────────────────
  // GET returns `state: null` so the client falls back to its deterministic
  // mock; PUT just acks. Real persistence happens against the backend; this
  // exists so frontend-only deploys don't crash and so CI tests don't 404.
  {
    test: (p, m) => m === 'GET' && /^\/csr\/cards\/[^/]+\/grant-state$/.test(p),
    handle: () => jsonResponse({ state: null, updated_at: null, source: 'mock' }),
  },
  {
    test: (p, m) => m === 'PUT' && /^\/csr\/cards\/[^/]+\/grant-state$/.test(p),
    handle: () => jsonResponse({ status: 'saved', updated_at: new Date().toISOString(), source: 'mock' }),
  },

  // ── Generic CRUD families: respond with optimistic success ─────────────────
  {
    test: (p, m) => m === 'GET' && (
      p.startsWith('/crm/donors') ||
      p.startsWith('/csr/cards') ||
      p.startsWith('/programs/beneficiaries') ||
      p.startsWith('/fundraising/campaigns') ||
      p.startsWith('/finance/transactions') ||
      p.startsWith('/finance/grants') ||
      p.startsWith('/volunteers/') ||
      p.startsWith('/compliance/') ||
      p.startsWith('/governance/') ||
      p.startsWith('/inbox') ||
      p.startsWith('/notifications') ||
      p.startsWith('/storage/files') ||
      p.startsWith('/csr/prospect-db/search') ||
      p.startsWith('/dpdp/')
    ),
    handle: () => jsonResponse({ items: [], data: [], count: 0 }),
  },

  // PDF / file downloads — return a tiny placeholder PDF blob
  {
    test: (p) => p.endsWith('.pdf') || p.includes('.pdf?') || p.includes('export/tally-xml') || p.includes('storage/file?key='),
    handle: (p) => {
      const isPdf = p.includes('.pdf');
      const content = isPdf
        ? '%PDF-1.4\n% GoodJobs demo placeholder — connect a backend for real exports.\n'
        : '<?xml version="1.0"?>\n<TALLYMESSAGE><!-- demo placeholder --></TALLYMESSAGE>\n';
      return new Response(content, {
        status: 200,
        headers: { 'Content-Type': isPdf ? 'application/pdf' : 'application/xml' },
      });
    },
  },
];

/**
 * Try to synthesise a Response for an apiFetch path that failed to reach the
 * real backend. Returns null if mocking is disabled.
 */
export function mockResponse(path: string, init?: RequestInit): Response {
  if (!isMockEnabled()) {
    return jsonResponse({ error: 'backend_unreachable', mock: 'disabled' }, 503);
  }
  markMockUsed();

  // Strip an absolute URL down to its pathname so handlers can match.
  let p = path;
  try {
    if (path.startsWith('http')) p = new URL(path).pathname + new URL(path).search;
  } catch { /* keep raw */ }

  const m = method(init);
  const handler = HANDLERS.find(h => h.test(p, m));
  if (handler) return handler.handle(p, init);

  // Generic fallthrough — keep the UI happy.
  if (m === 'GET') return jsonResponse({ items: [], data: null });
  if (m === 'DELETE') return jsonResponse({ ok: true });
  // POST / PUT / PATCH
  const body = readBody(init);
  return jsonResponse({ ok: true, id: rid(), echo: body });
}
