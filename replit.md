# GoodJobs — Infrastructure for Social Good

India-first nonprofit operating system with an agentic FastAPI backend and React (Vite) frontend.

## Architecture

- **Frontend**: React 19 + TypeScript + Vite, served on port 5000
- **Backend**: FastAPI + Uvicorn (Python), intended for port 8000
- **Package manager**: npm (frontend), pip (backend)
- **State management**: Zustand
- **UI**: framer-motion, lucide-react, react-hot-toast
- **Auth**: JWT-based (python-jose), role-based access control

## Project Structure

```
/
├── src/                    # React frontend source
│   ├── main.tsx            # App bootstrap
│   ├── App.tsx             # Top-level routing
│   ├── pages/              # Route pages (Dashboard, CRM, CSR, Finance, etc.)
│   ├── components/         # Reusable UI components
│   ├── store/useStore.ts   # Zustand global store
│   ├── context/AuthContext.tsx
│   └── api/client.ts       # API client
├── public/                 # Static assets
├── backend/                # FastAPI backend
│   ├── api/main.py         # FastAPI app + all routes
│   ├── core/               # Auth, DB, AI, analytics, observability
│   ├── agents/             # LangGraph agents (donor, finance, CSR, etc.)
│   ├── jobs/               # Background jobs
│   └── requirements.txt    # Python dependencies
├── vite.config.ts          # Vite config (port 5000, allowedHosts: true)
└── package.json            # Frontend scripts and dependencies
```

## Workflows

- **Start application**: `npm run dev` → port 5000 (webview)

## Deployment

- Target: static
- Build: `npm run build`
- Public dir: `dist`

## Navigation Structure

Seven primary routes inside the main Layout:
`/` (Today) · `/programs` · `/funding` · `/insights` · `/reports` · `/agent-hq` · `/settings`

Legacy module pages still accessible: `/crm` `/fundraising` `/finance` `/compliance` `/csr` `/volunteers`

## Design Language

Design tokens live in `src/index.css` (`:root`) and are the single source of truth — every page consumes them via CSS variables, so palette/contrast/shadow tweaks ripple everywhere automatically.

- **Primary**: `#0F766E` (teal-700). Hover `#0B5F5A`, active `#064E48`. Light surface `#D1FAE9`, soft tint `#ECFDF5`.
- **Active accent**: `#2DD4BF` (teal-400) — used for the sidebar active rail and brand mark.
- **Secondary accent**: `#7C3AED` (violet-600) — intentional pair with teal, used for the AI/Copilot identity. Replaces the old `#6366f1` indigo leaks that clashed with the teal brand.
- **Sidebar/auth gradient**: `#0d3d39 → #134e4a → #0F766E`.
- **Text contrast** (light bg `#F6F8FB`):
  - `--color-text-primary` `#0F172A` (17.4:1)
  - `--color-text-secondary` `#334155` (9.8:1, was slate-600)
  - `--color-text-tertiary` `#64748B` (5.7:1 — now AA, was slate-400 which failed)
  - `--color-text-muted` `#94A3B8` is non-text only.
- **Shadows**: neutral-tinted layered drops (`--shadow-sm/md/lg/xl`) plus brand-tinted `--shadow-primary` for primary CTAs. No more indigo-tint on cards.
- **Radii**: `xs 4 · sm 6 · md 10 · lg 14 · xl 18 · 2xl 24` — modern soft-but-purposeful curve.
- **Semantic colors** carry their own `*-text` token (`--color-success-text`, `--color-danger-text`, etc.) so badges/deltas stay consistent without hard-coding hex values.

## Key Features

- FCRA-compliant fund accounting
- WhatsApp-first field data entry
- AI agents for every workflow (LangChain/LangGraph)
- 80G receipts auto-generated
- DPDP Act 2023 compliant
- Donor CRM, CSR prospecting, fundraising, compliance, volunteer management

## Onboarding (NGO-friendly)

- **Public signup** (`src/pages/Auth/Signup.tsx`, route `/signup`) — branded form (NGO name, full name, work email, password, primary cause, team size) with mock Google OAuth and a simulated email-verification step. On success, the user is logged in with `needsWizard: true` and a fresh 30-day trial, then routed to `/onboarding`. Login page links to `/signup` instead of opening the legacy register modal.
- **5-step Signup Wizard** (`src/pages/Onboarding/SignupWizard.tsx`, route `/onboarding`, no main Layout chrome) — Org Profile → First Program → Invite Team → Import Beneficiaries → Connect WhatsApp. Each step supports "Skip for now" and the wizard supports "Skip setup". State persists per user in `localStorage.gj_wizard_state_v1`. WhatsApp mock OTP = `424242`. FirstProgramStep auto-creates a draft campaign; ImportBeneficiariesStep commits manual rows via the store.
- **Wizard gate** — `Layout.tsx` redirects any in-app navigation to `/onboarding` while `user.needsWizard` is true. Returning users (after `finishWizard`) bypass the wizard entirely.
- **30-day trial** (`src/utils/trial.ts`) — `TrialState` carries `startedAt` + `nudges{day7,day21,day28}`. `TrialPill` (header) shows "Trial: N days left", hides for paid tiers. Nudge cadence in Layout fires once each (re-evaluated on route changes + 5-min interval, deduped via persistent flags): day-21 toast, day-28 modal, day-30 expired banner + auto modal. Day-7 nurture card surfaces on Today via `TrialDay7Card`.
- **Trial persistence + Day-30 enforcement** — Trial + `subscriptionTier` belong to the *org*, not the individual user. Persisted in `localStorage.gj_org_billing_v1` keyed by `ngoId` via `loadOrgBilling` / `saveOrgBilling`. `AuthContext.login()` rehydrates from that store first (so users cannot reset their trial by logging out/in); only mints a fresh trial when the org has no record. `updateUser` mirrors trial+tier writes back to the per-org store. A Layout effect durably writes `subscriptionTier='starter'` once `isTrialExpired()` (not just computed at render). Concrete Starter limits live in `tierLimits()` / `canAddBeneficiary()` (cap = `STARTER_BENEFICIARY_CAP` = 50); `Programs.tsx` gates single + bulk beneficiary adds against the cap with an upgrade toast.
- **Welcome modal** (`src/components/Onboarding/WelcomeModal.tsx`) — auto-shown once per user on first login, suppressed while the signup wizard is in flight. Persisted in `localStorage.gj_welcomed_v1`.
- **Get Started checklist** (`src/components/Onboarding/GetStartedChecklist.tsx`) — Today screen. 5 base steps + auto-surfaced rows for any wizard step the user skipped (deduped against overlapping base ids). Auto-hides when all done or dismissed.
- **Per-user isolation** — unique IDs from email (`user_<sanitized_email>`) so each role/account keeps its own onboarding + trial state.

## Today Screen (Dashboard)

- Yesterday's wins strip (computed from store data)
- Three priority sections: Urgent / Needs Attention / Going Well
- Age badges pulse (CSS animation) when item is ≥3 days overdue; escalated at ≥7 days
- Inline action execution: "Bulk generate" receipts calls API in-place (loading→done state); "Follow up via WhatsApp" opens compose URL inline — no page navigation needed
- Snooze button on non-urgent items (24h/3d/1w, localStorage)
- Trend delta chips on Going Well items (↑ / ↓ / flat)
- Role-based quick actions grid (4 tiles per role)
- `actionType` field on PriorityItem: `'receipts' | 'whatsapp'` triggers inline execution

## Agent HQ (AI Copilot)

- Full HITL intent card system with: risk badge (CRITICAL/HIGH/MEDIUM/LOW + color), evidence pack ("What will happen"), impact preview key/value grid, reversibility badge (irreversible / partial / reversible), live countdown timer to expiry
- Three action buttons per intent: Approve / Modify / Reject
- When API queue is empty: shows "All clear" state + 3 demo intent cards showing the full UX (Grant Report, Donor Nurture, Compliance Guardian agents)
- CountdownTimer component auto-refreshes every 30s; pulses red when <4h remain
- normalizeApproval() converts real queue items to RichIntent for the shared IntentCard component

## Finance & FCRA

- FCRA Admin Overhead Monitor: real-time 4-level gauge (safe <12% / caution 12–16% / warning 16–20% / critical ≥20%)
- Animated progress bar (width + colour transition) with threshold markers at 12% and 16%
- Large percentage readout, remaining headroom display, detail breakdown rows
- Status pill (SAFE/CAUTION/WARNING/CRITICAL) drives card background tint

## Insights (M&E)

- KPI cards with sector-average benchmark lines
- "What the data means" AI interpretation panel (3 plain-language sentences)
- Campaign bar charts with sector-average marker lines
- Staff-wise data quality breakdown (score + last entry date)
- One-click funder-formatted CSV export

## Programs

- CSV import preview with real-time duplicate detection: compares by name and phone (last 7 digits) against existing beneficiaries
- Rows flagged as "⚠ Duplicate?" highlighted in amber; "✓ New" green for clean rows
- Count badge in header shows total flagged rows; warning block explains action before import

## Development Notes

- Frontend runs on `0.0.0.0:5000` with `allowedHosts: true` for Replit proxy compatibility
- Backend uses `localhost:8000` (separate workflow if needed)
- Backend falls back to in-memory demo stores when no `DATABASE_URL` is set
- Demo login available via quick-access role buttons on the login screen
