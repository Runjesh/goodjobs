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

- Primary color: `#0F766E` (deep teal)
- Active accent: `#2dd4bf`
- Sidebar/auth gradient: `#0d3d39 → #134e4a → #0F766E`

## Key Features

- FCRA-compliant fund accounting
- WhatsApp-first field data entry
- AI agents for every workflow (LangChain/LangGraph)
- 80G receipts auto-generated
- DPDP Act 2023 compliant
- Donor CRM, CSR prospecting, fundraising, compliance, volunteer management

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
