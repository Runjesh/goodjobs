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
- Alert age badges that pulse when ≥5 days old (urgency escalation)
- Snooze button on non-urgent items (24h, stored in localStorage)
- Trend delta chips on Going Well items (↑ / ↓ / flat)
- Role-based quick actions grid (4 tiles per role)

## Insights (M&E)

- KPI cards with sector-average benchmark lines
- "What the data means" AI interpretation panel (3 plain-language sentences)
- Campaign bar charts with sector-average marker lines
- Staff-wise data quality breakdown (score + last entry date)
- One-click funder-formatted CSV export

## Development Notes

- Frontend runs on `0.0.0.0:5000` with `allowedHosts: true` for Replit proxy compatibility
- Backend uses `localhost:8000` (separate workflow if needed)
- Backend falls back to in-memory demo stores when no `DATABASE_URL` is set
- Demo login available via quick-access role buttons on the login screen
