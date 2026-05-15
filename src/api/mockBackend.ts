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

import { expectsRealBackend, hasExplicitApiBaseUrl } from './env';

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
  try {
    isDev = !!import.meta.env.DEV;
    buildFlag = String(import.meta.env.VITE_ENABLE_MOCK_BACKEND ?? '').toLowerCase() === 'true';
  } catch { /* ignore */ }

  // Railway monolith / split deploy: never silently mock writes in production.
  if (expectsRealBackend()) return false;

  if (isDev) return true;
  if (buildFlag) return true;

  // Static-only host (no API URL, not same-origin monolith): demo fallback.
  if (!hasExplicitApiBaseUrl() && typeof window !== 'undefined') {
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

  {
    test: (p, m) => m === 'GET' && p.startsWith('/integrations/whatsapp/code'),
    handle: () =>
      jsonResponse({
        org_code: 'GJDEMO',
        instructions:
          'Field staff send WhatsApp to your Meta number starting with GJDEMO then a space and the visit text.',
      }),
  },
  {
    test: (p, m) => m === 'GET' && p.startsWith('/programs/mis-whatsapp-intake'),
    handle: () => jsonResponse({ items: [], source: 'mock' }),
  },
  {
    test: (p, m) => m === 'GET' && p.startsWith('/reports/funder-export.pdf'),
    handle: () =>
      new Response('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      }),
  },

  // ── Auth (mocked only when isAuthMockAllowed — see top of file) ────────────
  {
    test: (p, m) => isAuthMockAllowed() && m === 'POST' && p === '/auth/login',
    handle: () => jsonResponse({ access_token: rid('tok'), token_type: 'bearer' }),
  },
  {
    test: (p, m) => isAuthMockAllowed() && m === 'POST' && p === '/auth/register',
    handle: (_p, init) => {
      const body = readBody(init);
      const userId = rid('user');
      const ngoId = rid('ngo');
      return jsonResponse({
        access_token: rid('tok'),
        token_type: 'bearer',
        user_id: userId,
        ngo_id: ngoId,
        email: body.email ?? '',
        name: body.full_name ?? '',
        role: body.role ?? 'ed',
        ngo_name: body.ngo_name ?? '',
        expires_in_hours: 24,
        source: 'mock',
      });
    },
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

  // ── Settings ───────────────────────────────────────────────────────────────
  {
    test: (p, m) => m === 'GET' && p === '/settings',
    handle: () => {
      try {
        const raw = localStorage.getItem('sevasuite_auth');
        const user = raw ? JSON.parse(raw) : {};
        return jsonResponse({
          profile: { full_name: user.name ?? '' },
          ngo: {
            name: user.ngoName ?? '',
            reg_no: user.reg_no ?? '',
            fcra_reg: user.fcra_reg ?? '',
            pan: user.pan ?? '',
            state: user.state ?? '',
          },
          notification_prefs: {},
        });
      } catch {
        return jsonResponse({ profile: { full_name: '' }, ngo: {}, notification_prefs: {} });
      }
    },
  },
  {
    test: (p, m) => m === 'POST' && p === '/settings/profile',
    handle: (_p, init) => {
      const body = readBody(init);
      try {
        const raw = localStorage.getItem('sevasuite_auth');
        if (raw) {
          const user = JSON.parse(raw);
          user.name = body.full_name ?? user.name;
          localStorage.setItem('sevasuite_auth', JSON.stringify(user));
        }
      } catch { /* ignore */ }
      return jsonResponse({ ok: true, profile: { full_name: body.full_name ?? '' } });
    },
  },
  {
    test: (p, m) => m === 'POST' && p === '/settings/ngo',
    handle: (_p, init) => {
      const body = readBody(init);
      try {
        const raw = localStorage.getItem('sevasuite_auth');
        if (raw) {
          const user = JSON.parse(raw);
          if (body.name) user.ngoName = body.name;
          if (body.reg_no !== undefined) user.reg_no = body.reg_no;
          if (body.fcra_reg !== undefined) user.fcra_reg = body.fcra_reg;
          if (body.pan !== undefined) user.pan = body.pan;
          const meta = (user.ngo_meta && typeof user.ngo_meta === 'object') ? user.ngo_meta : {};
          for (const k of ['section_80g', 'cause_area', 'logo_data_url', 'fcra_status', 'whatsapp_phone', 'whatsapp_verified', 'whatsapp_connected_at'] as const) {
            if (body[k] !== undefined) meta[k] = body[k];
          }
          if (body.program_name && String(body.program_name).trim()) {
            const progs: string[] = Array.isArray(meta.programs) ? [...meta.programs] : [];
            const pname = String(body.program_name).trim();
            if (!progs.some((p: string) => String(p).toLowerCase() === pname.toLowerCase())) progs.push(pname);
            meta.programs = progs;
          }
          if (body.whatsapp_phone) {
            meta.whatsapp = {
              ...(meta.whatsapp && typeof meta.whatsapp === 'object' ? meta.whatsapp : {}),
              phone: body.whatsapp_phone,
              verified: !!body.whatsapp_verified,
              connected_at: body.whatsapp_connected_at ?? new Date().toISOString(),
            };
          }
          user.ngo_meta = meta;
          localStorage.setItem('sevasuite_auth', JSON.stringify(user));
          localStorage.setItem(`goodjobs.mock.ngo_meta.${user.ngoId ?? 'default'}`, JSON.stringify(meta));
        }
      } catch { /* ignore */ }
      return jsonResponse({ ok: true, ngo: { name: body.name ?? '', reg_no: body.reg_no, fcra_reg: body.fcra_reg, pan: body.pan, meta: body }, source: 'mock' });
    },
  },
  {
    test: (p, m) => m === 'POST' && p === '/fundraising/campaigns',
    handle: (_p, init) => {
      const body = readBody(init);
      const camp = {
        id: rid('c'),
        title: body.title ?? 'Campaign',
        raised: 0,
        goal: Number(body.goal) || 0,
        donorsCount: 0,
        status: body.status ?? 'draft',
        image: body.image ?? '',
        cause: body.cause ?? '',
        details: body.details ?? {},
      };
      try {
        const key = 'goodjobs.mock.campaigns';
        const arr = JSON.parse(localStorage.getItem(key) || '[]');
        arr.unshift(camp);
        localStorage.setItem(key, JSON.stringify(arr));
      } catch { /* ignore */ }
      return jsonResponse({ status: 'created', campaign: camp, source: 'mock' });
    },
  },
  {
    test: (p, m) => m === 'POST' && p === '/programs/beneficiaries',
    handle: (_p, init) => {
      const body = readBody(init);
      const ben = {
        id: rid('ben'),
        name: body.name ?? 'Beneficiary',
        program: body.program ?? 'General',
        location: body.location ?? '—',
        aadhaar: !!body.aadhaar,
        familySize: Number(body.familySize) || 1,
        details: body.details ?? {},
      };
      try {
        const key = 'goodjobs.mock.beneficiaries';
        const arr = JSON.parse(localStorage.getItem(key) || '[]');
        arr.unshift(ben);
        localStorage.setItem(key, JSON.stringify(arr));
      } catch { /* ignore */ }
      return jsonResponse({ status: 'created', beneficiary: ben, source: 'mock' });
    },
  },
  {
    test: (p, m) => m === 'POST' && p === '/programs/beneficiaries/bulk',
    handle: (_p, init) => {
      const body = readBody(init);
      const rows = Array.isArray(body.beneficiaries) ? body.beneficiaries : [];
      let n = 0;
      try {
        const key = 'goodjobs.mock.beneficiaries';
        const arr = JSON.parse(localStorage.getItem(key) || '[]');
        for (const b of rows.slice(0, 500)) {
          if (!(b?.name || '').trim()) continue;
          arr.unshift({
            id: rid('ben'),
            name: b.name,
            program: b.program ?? 'General',
            location: b.location ?? '—',
            aadhaar: !!b.aadhaar,
            familySize: Number(b.familySize) || 1,
            details: b.details ?? {},
          });
          n += 1;
        }
        localStorage.setItem(key, JSON.stringify(arr));
      } catch { /* ignore */ }
      return jsonResponse({ imported: n, source: 'mock' });
    },
  },
  {
    test: (p, m) => m === 'POST' && p === '/onboarding/invites',
    handle: (_p, init) => {
      const body = readBody(init);
      const invites = Array.isArray(body.invites) ? body.invites : [];
      try {
        const key = 'goodjobs.mock.invites';
        const arr = JSON.parse(localStorage.getItem(key) || '[]');
        for (const i of invites) {
          if (!i?.email) continue;
          arr.push({ email: i.email, role: i.role, status: 'pending', invitedAt: new Date().toISOString() });
        }
        localStorage.setItem(key, JSON.stringify(arr));
      } catch { /* ignore */ }
      return jsonResponse({ ok: true, queued: invites.length, source: 'mock' });
    },
  },
  {
    test: (p, m) => m === 'POST' && p === '/settings/notifications',
    handle: () => jsonResponse({ ok: true }),
  },
  {
    test: (p, m) => m === 'GET' && p === '/settings/llm',
    handle: () => {
      try {
        const raw = (localStorage.getItem('gj_mock_openai_key') || '').trim();
        const configured = raw.length >= 20 && raw.startsWith('sk-') && !raw.toLowerCase().startsWith('sk-mock');
        return jsonResponse({
          configured,
          masked: configured ? `${raw.slice(0, 7)}…${raw.slice(-4)}` : null,
          source: configured ? 'organisation' : 'none',
          env_fallback_available: false,
        });
      } catch {
        return jsonResponse({
          configured: false,
          masked: null,
          source: 'none',
          env_fallback_available: false,
        });
      }
    },
  },
  {
    test: (p, m) => m === 'POST' && p === '/settings/llm',
    handle: (_p, init) => {
      const body = readBody(init) as { openai_api_key?: string };
      const k = (body.openai_api_key || '').trim();
      if (!k.startsWith('sk-') || k.length < 20) {
        return jsonResponse({ detail: 'Invalid OpenAI API key format (expected sk-… secret).' }, 400);
      }
      try {
        localStorage.setItem('gj_mock_openai_key', k);
      } catch { /* ignore */ }
      return jsonResponse({
        configured: true,
        masked: `${k.slice(0, 7)}…${k.slice(-4)}`,
        source: 'organisation',
        env_fallback_available: false,
      });
    },
  },
  {
    test: (p, m) => m === 'DELETE' && p === '/settings/llm',
    handle: () => {
      try {
        localStorage.removeItem('gj_mock_openai_key');
      } catch { /* ignore */ }
      return jsonResponse({
        configured: false,
        masked: null,
        source: 'none',
        env_fallback_available: false,
      });
    },
  },
  {
    test: (p, m) => m === 'POST' && p === '/settings/export',
    handle: () => jsonResponse({ ok: true, download_url: null }),
  },

  // ── Morning brief / agent HQ summaries ─────────────────────────────────────
  {
    test: (_p, m) => m === 'GET' && _p.startsWith('/morning-brief'),
    handle: () => jsonResponse({
      priorities: [
        {
          id: 'wf-finance-classify',
          title: '2 unclassified transactions from the last 2 days',
          summary: 'Tag programme & FCRA category — then issue 80G receipts for income rows.',
          priority: 'High',
          category: 'Finance',
          label: 'Classify now',
          deep_link: '/finance?view=exceptions',
        },
        {
          id: 'wf-programs-verify',
          title: '1 new enrollment needs Aadhaar verification',
          summary: 'Verify ID before the beneficiary counts in MIS.',
          priority: 'High',
          category: 'Programs',
          label: 'Review docs',
          deep_link: '/programs?tab=mis&filter=verify',
        },
      ],
      handled_by_agents: [],
      brief_narrative: 'Good morning! 2 enrollments need Aadhaar verification. Review Programs → Verify ID.',
    }),
  },
  {
    test: (p, m) => m === 'POST' && p === '/trigger/morning-brief',
    handle: () => jsonResponse({ status: 'accepted', message: 'Morning brief agent triggered' }),
  },
  {
    test: (p, m) => m === 'POST' && p === '/notifications/item',
    handle: () => jsonResponse({ status: 'ok', source: 'memory' }),
  },
  {
    test: (p, m) => m === 'POST' && p === '/team/invite',
    handle: (_p, init) => {
      const body = readBody(init);
      const invites = Array.isArray(body.invites) ? body.invites : [];
      return jsonResponse({ queued: invites.length, invites, source: 'memory' });
    },
  },
  {
    test: (p, m) => m === 'GET' && p === '/programs/field-checkins',
    handle: () => jsonResponse({
      checkins: [{ id: 'chk1', beneficiary: 'Sunita Bai', location: 'Pune, MH', program: 'Healthcare Camp', report_date: '2026-05-14' }],
      map_configured: false,
    }),
  },
  {
    test: (p, m) => m === 'POST' && p === '/finance/tally/sync',
    handle: () => jsonResponse({ status: 'ok', exported_vouchers: 12, synced_at: new Date().toISOString(), integration: 'tally_xml_stub' }),
  },
  {
    test: (p, m) => m === 'POST' && p === '/finance/journal-entry',
    handle: (_p, init) => {
      const body = readBody(init);
      const isIncome = String(body.entry_type || '').toLowerCase() === 'income';
      return jsonResponse({
        status: 'recorded',
        event: { id: rid('fj'), ...body },
        receipt_number: isIncome ? '80G/2025-26/DEMO/00042' : undefined,
        fiscal_year: isIncome ? '2025-2026' : undefined,
      });
    },
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
      const scores: Record<string, number> = {};
      ids.forEach((id, i) => {
        scores[String(id)] = 35 + ((i * 17) % 55);
      });
      return jsonResponse({ scores });
    },
  },
  {
    test: (p, m) => m === 'GET' && p.startsWith('/analytics/donor-propensity/'),
    handle: (p) => {
      const donorId = p.split('/').pop() || '0';
      const base = 40 + (parseInt(donorId, 10) || 0) * 7 % 50;
      return jsonResponse({
        donor_id: donorId,
        propensity_score: base,
        recommendation: base > 70 ? 'High probability — personal outreach.' : 'Send regular impact updates.',
        insights: { recency: '30 days ago', frequency: '5 gifts', monetary: '₹1,500 avg' },
      });
    },
  },

  // ── Gen-AI ─────────────────────────────────────────────────────────────────
  {
    test: (p, m) => m === 'POST' && p === '/gen-ai/draft-report',
    handle: (_p, init) => {
      const body = readBody(init);
      const programme = body.context?.programme_name ?? 'General Programme';
      const ngoName   = body.context?.ngo_name ?? 'Our NGO';
      const bCount    = body.context?.beneficiary_count ?? 0;
      const spend     = body.context?.total_spend ?? 0;
      const outcomes: string[]   = Array.isArray(body.context?.outcomes)   ? body.context.outcomes   : [];
      const tocNodes: string[]   = Array.isArray(body.context?.toc_nodes)  ? body.context.toc_nodes  : [];
      const spendFmt = spend >= 100000
        ? `₹${(spend / 100000).toFixed(1)}L`
        : spend > 0 ? `₹${spend.toLocaleString('en-IN')}` : 'Not yet recorded';
      const reportType = body.type ?? 'funder';
      const titleMap: Record<string, string> = {
        funder: `${programme} — Funder Progress Report`,
        impact: `${programme} — Impact Report`,
        donor:  `${programme} — Donor Impact Update`,
        board:  `${programme} — Board Brief`,
      };
      const title = titleMap[reportType] ?? `${programme} — Report`;
      const tocSection = tocNodes.length
        ? tocNodes.map(n => `- ${n}`).join('\n')
        : '_No Theory of Change built yet. Add ToC nodes under Programs → Theory of Change for more specific impact language._';
      const outcomesSection = outcomes.length
        ? outcomes.map(o => `- ${o}`).join('\n')
        : '_No outcome records found for this programme._';
      const markdown = [
        `# ${title}`,
        `\n**Organisation:** ${ngoName}`,
        `**Programme:** ${programme}`,
        `**Report generated:** ${new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}`,
        `\n---\n`,
        `## 1. Executive Summary`,
        `This report presents the progress and impact of **${programme}** implemented by **${ngoName}**.`,
        `During the reporting period, the programme reached **${bCount} beneficiaries** with a total programme spend of **${spendFmt}**.`,
        `\n## 2. Theory of Change`,
        tocSection,
        `\n## 3. Beneficiary Reach`,
        `- **Total beneficiaries served:** ${bCount}`,
        `- Data completeness is tracked in the GoodJobs platform dashboard.`,
        `\n## 4. Outcomes & Achievements`,
        outcomesSection,
        `\n## 5. Financial Summary`,
        `| Item | Amount |`,
        `|------|--------|`,
        `| Total programme spend | ${spendFmt} |`,
        `| Sources | Grants & donor contributions |`,
        `\n## 6. Challenges & Learnings`,
        `_[To be completed by the programme team before submission.]_`,
        `\n## 7. Next Steps`,
        `_[To be completed by the programme team before submission.]_`,
        `\n---`,
        `_This draft was generated by GoodJobs AI using live programme data. Review all sections before submitting to funders._`,
      ].join('\n');
      return jsonResponse({
        ok: true,
        report_id: rid('rpt'),
        title,
        markdown,
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
    handle: () => jsonResponse({
      category: 'Donation',
      confidence: 0.84,
      suggested_donor_id: 'd1',
      suggested_donor_name: 'Demo Donor',
      donor_match_confidence: 0.72,
    }),
  },
  {
    test: (p, m) => m === 'POST' && p === '/finance/issue-receipt',
    handle: () => jsonResponse({ status: 'issued', receipt_number: '80G/2025-26/DEMO/00001', fiscal_year: '2025-2026' }),
  },
  {
    test: (p, m) => m === 'POST' && p === '/finance/transactions',
    handle: (_p, init) => {
      const body = readBody(init);
      const id = rid('trx');
      return jsonResponse({
        transaction: {
          id,
          donorId: body.donorId || 'd-new',
          donorName: body.donorName || 'Donor',
          amount: Number(body.amount) || 0,
          method: body.method || 'UPI',
          campaignId: body.campaignId || '',
          campaignTitle: body.campaignTitle || 'General',
          programmeId: body.programmeId || body.campaignId,
          date: new Date().toISOString().slice(0, 10),
          timestamp: Date.now(),
        },
      });
    },
  },
  {
    test: (p, m) => m === 'POST' && p === '/public/donations',
    handle: (_p, init) => {
      const body = readBody(init);
      const id = rid('trx');
      const donorId = body.donor_email || rid('donor');
      return jsonResponse({
        ok: true,
        ngo_name: 'GoodJobs NGO',
        transaction: {
          id,
          donorId,
          donorName: body.donor_name || 'Donor',
          amount: Number(body.amount) || 0,
          method: body.method || 'UPI',
          campaignId: body.campaign_slug || '',
          campaignTitle: body.cause || 'General Fund',
          date: new Date().toISOString().slice(0, 10),
          timestamp: Date.now(),
        },
      });
    },
  },
  {
    test: (p, m) => m === 'POST' && p === '/crm/donors',
    handle: (_p, init) => {
      const body = readBody(init);
      const id = rid('donor');
      return jsonResponse({
        donor: {
          id,
          name: body.name || 'Donor',
          type: body.type || 'Individual',
          pan: body.pan || '',
          email: body.email,
          phone: body.phone,
          tags: body.tags || [],
        },
      });
    },
  },
  {
    test: (p, m) => m === 'POST' && p === '/gen-ai/donor-outreach-draft',
    handle: async (_p, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const name = (body.donor_name || 'Friend').split(' ')[0];
      return jsonResponse({ message: `Namaste ${name}! Thank you for your continued support.`, channel: 'whatsapp' });
    },
  },
  {
    test: (p, m) => m === 'POST' && p.startsWith('/programs/mis-reviews/') && p.endsWith('/decide'),
    handle: () => jsonResponse({ status: 'approved', budget_applied: 450 }),
  },
  {
    test: (p, m) => m === 'GET' && p.startsWith('/programs/mis-reviews'),
    handle: () => jsonResponse({ reviews: [] }),
  },
  {
    test: (p, m) => m === 'POST' && p === '/programs/mis-reviews',
    handle: () => jsonResponse({ status: 'created' }),
  },
  {
    test: (p, m) => m === 'POST' && p === '/crm/outreach/email',
    handle: () => jsonResponse({ status: 'queued', outreach_id: 'out_demo_email', results: [] }),
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

  // ── Grant Parser extraction (Task #7) ──────────────────────────────────────
  // GET returns null until POST has been called once, then echoes the same
  // deterministic-mock payload. Frontend-only deploys exercise the same
  // shape the real backend returns.
  {
    test: (p, m) => m === 'GET' && /^\/csr\/cards\/[^/]+\/parser-rows$/.test(p),
    handle: () => jsonResponse({ extraction: null, source: 'mock' }),
  },
  {
    test: (p, m) => m === 'POST' && /^\/csr\/cards\/[^/]+\/parser-rows$/.test(p),
    handle: (p) => {
      const cardId = p.split('/')[3] || '0';
      const seed = String(cardId).split('').reduce((s, c) => s + c.charCodeAt(0), 0);
      const cohort = 100 + (seed * 9301) % 400;
      const rows = [
        { id: 'pl1', type: 'deadline',    label: 'Final UC submission',        detail: 'Within 30 days of project completion', confidence: 0.94 },
        { id: 'pl2', type: 'deadline',    label: 'Quarterly progress reports', detail: 'Q1 Jan, Q2 Apr, Q3 Jul, Q4 Oct (15th)', confidence: 0.90 },
        { id: 'pl3', type: 'deadline',    label: 'Mid-line evaluation',        detail: 'At month 6 of project', confidence: 0.74 },
        { id: 'dv1', type: 'deliverable', label: `Train ${cohort} direct beneficiaries`, detail: 'Programme cohort, geo-tagged attendance', confidence: 0.92 },
        { id: 'dv2', type: 'deliverable', label: 'Field documentation',        detail: '5 case studies + photo essay per quarter', confidence: 0.85 },
        { id: 'dv3', type: 'deliverable', label: 'Independent assessment',     detail: 'Third-party endline survey', confidence: 0.71 },
        { id: 'bg1', type: 'budget',      label: 'Programme delivery',         detail: '₹12.0L · 60%', confidence: 0.96 },
        { id: 'bg2', type: 'budget',      label: 'Capacity building',          detail: '₹3.0L · 15%', confidence: 0.92 },
        { id: 'bg3', type: 'budget',      label: 'M&E + reporting',            detail: '₹2.0L · 10%', confidence: 0.88 },
        { id: 'bg4', type: 'budget',      label: 'Admin overhead',             detail: '₹3.0L · 15% (cap 15%)', confidence: 0.80 },
        { id: 'cd1', type: 'condition',   label: 'No-diversion clause',        detail: 'Funds usable only for Schedule VII purpose', confidence: 0.95 },
        { id: 'cd2', type: 'condition',   label: 'Auditor sign-off',           detail: 'Independent CA sign-off required on UC', confidence: 0.93 },
        { id: 'cd3', type: 'condition',   label: 'Branding & visibility',      detail: 'Funder logo on all collaterals', confidence: 0.86 },
        { id: 'cd4', type: 'condition',   label: 'Repayment of unspent funds', detail: 'Within 60 days of project closure', confidence: 0.78 },
      ];
      return jsonResponse({
        extraction: {
          rows, source: 'mock', doc_id: null, doc_name: null,
          extracted_at: new Date().toISOString(), doc_count: 0,
        },
        status: 'extracted',
      });
    },
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

  // ── Layout / module list endpoints — response keys MUST match FastAPI + what
  //     Layout.tsx and feature pages parse (donors, cards, transactions, …).
  //     A generic `{ items: [] }` caused 200 OK with wrong shape so the store
  //     never hydrated and DEV demo seeds never ran.
  {
    test: (p, m) => m === 'GET' && p.startsWith('/crm/donors/lifecycle'),
    handle: () => jsonResponse({ states: {}, source: 'mock' }),
  },
  {
    test: (p, m) => m === 'GET' && /^\/crm\/donors(\?|$)/.test(p),
    handle: () => jsonResponse({ donors: [], source: 'mock' }),
  },
  {
    test: (p, m) => m === 'GET' && /^\/finance\/transactions(\?|$)/.test(p),
    handle: () => jsonResponse({ transactions: [], source: 'mock' }),
  },
  {
    test: (p, m) => m === 'GET' && /^\/finance\/grants(\?|$)/.test(p),
    handle: () => jsonResponse({ grants: [], source: 'mock' }),
  },
  {
    test: (p, m) => m === 'GET' && /^\/fundraising\/campaigns(\?|$)/.test(p),
    handle: () => {
      try {
        const arr = JSON.parse(localStorage.getItem('goodjobs.mock.campaigns') || '[]');
        if (Array.isArray(arr) && arr.length) return jsonResponse({ campaigns: arr, source: 'mock' });
      } catch { /* ignore */ }
      return jsonResponse({ campaigns: [], source: 'mock' });
    },
  },
  {
    test: (p, m) => m === 'GET' && /^\/csr\/cards(\?|$)/.test(p),
    handle: () => jsonResponse({ cards: [], source: 'mock' }),
  },
  {
    test: (p, m) => m === 'GET' && /^\/volunteers\/roster(\?|$)/.test(p),
    handle: () => jsonResponse({ volunteers: [], source: 'mock' }),
  },
  {
    test: (p, m) => m === 'GET' && /^\/programs\/beneficiaries(\?|$)/.test(p),
    handle: () => {
      try {
        const arr = JSON.parse(localStorage.getItem('goodjobs.mock.beneficiaries') || '[]');
        if (Array.isArray(arr) && arr.length) return jsonResponse({ beneficiaries: arr, source: 'mock' });
      } catch { /* ignore */ }
      return jsonResponse({ beneficiaries: [], source: 'mock' });
    },
  },
  {
    test: (p, m) => m === 'GET' && /^\/compliance\/documents(\?|$)/.test(p),
    handle: () => jsonResponse({ documents: [], source: 'mock' }),
  },
  {
    test: (p, m) => m === 'GET' && /^\/compliance\/filings(\?|$)/.test(p),
    handle: () => jsonResponse({ filings: [], source: 'mock' }),
  },
  {
    test: (p, m) => m === 'GET' && /^\/compliance\/consents(\?|$)/.test(p),
    handle: () => jsonResponse({ consents: [], source: 'mock' }),
  },
  {
    test: (p, m) => m === 'GET' && /^\/compliance\/erasures(\?|$)/.test(p),
    handle: () => jsonResponse({ requests: [], source: 'mock' }),
  },
  {
    test: (p, m) => m === 'GET' && /^\/compliance\/breaches(\?|$)/.test(p),
    handle: () => jsonResponse({ breaches: [], source: 'mock' }),
  },
  {
    test: (p, m) => m === 'GET' && /^\/governance\/board-members(\?|$)/.test(p),
    handle: () => jsonResponse({ members: [], source: 'mock' }),
  },

  // ── Generic CRUD families: respond with optimistic success ─────────────────
  {
    test: (p, m) => m === 'GET' && (
      (p.startsWith('/volunteers/') && !/^\/volunteers\/roster(\?|$)/.test(p)) ||
      (p.startsWith('/compliance/') && !p.includes('.pdf')) ||
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
