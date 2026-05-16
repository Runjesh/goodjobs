# GoodJobs

India-first nonprofit OS (production site: [goodjobs.co.in](https://goodjobs.co.in)) with an agentic FastAPI backend and a React (Vite) frontend.

## Next.js re-platform (in progress)

A **Next.js 14 + Prisma + Auth.js** app lives in [`apps/web`](apps/web). It uses PostgreSQL tables with the `nx_*` prefix so it can share a database with the legacy FastAPI schema. From the repo root:

```bash
npm run dev:web    # Next dev server on http://localhost:3001 (see apps/web/README.md)
npm run build:web  # Production build for the new app
```

The Vite app remains the default `npm run dev` until feature parity is reached.

When the Next.js app under `apps/web` is present in your tree, add an **AI & Agents** settings screen there that calls the same FastAPI routes as the Vite app (`GET` / `POST` / `DELETE` `/settings/llm`) so org keys work regardless of which UI is deployed.

## Hosted Postgres setup (persistence)

The backend will use Postgres automatically when `DATABASE_URL` is set. If not set, it falls back to in-memory demo storage for some modules.

### 1) Set env vars

- **Backend**
  - `DATABASE_URL`: hosted Postgres connection string
  - `JWT_SECRET`: (recommended) secret for signing JWTs
  - `OPENAI_API_KEY`: (optional) server-wide OpenAI key when no per-org key is saved in **Settings → AI & Agents**
  - `DEMO_DEFAULT_NGO_ID`: (optional, default `ngo_001`) tenant used for unauthenticated agent triggers (e.g. board brief, Razorpay → donor agent)

### 2) Apply schema

Run:

```bash
export DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require"
python3 backend/scripts/init_db.py
```

### 3) (Optional) Seed Prospect DB

```bash
export DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require"
export SEVASUITE_NGO_ID="ngo_001"
python3 backend/scripts/seed_prospect_db.py
```

## Railway — **one service** (simplest)

Use the repo **`Dockerfile`**: one container runs **FastAPI** and serves the built **`dist/`** from the same URL, so you do **not** need `VITE_API_BASE_URL` or a second service.

1. In Railway: **New project** → **Deploy from GitHub** → select this repo.
2. Railway should detect **`Dockerfile`**. If not: service **Settings** → set **Dockerfile path** to `Dockerfile`.
3. **Variables** on that service, at minimum:
   - `FRONTEND_ORIGINS` — your public site URL(s), e.g. `https://goodjobs-production-xxxx.up.railway.app,https://goodjobs.co.in`
   - `JWT_SECRET` — random string  
   - `DATABASE_URL` — if you use Postgres (optional for demo mode)
   - **Agents / OpenAI (optional):** `OPENAI_API_KEY` — server-wide fallback when no per-org key is saved in **Settings → AI & Agents**. For cron-style or unauthenticated webhooks (`/trigger/board-brief`, Razorpay → donor agent, etc.), set **`DEMO_DEFAULT_NGO_ID`** (defaults to `ngo_001`) so the backend resolves the same tenant’s key as your demo org. Optional: **`OPENAI_KEY_ENCRYPTION_SECRET`** for Fernet encryption of stored org keys; if unset, **`JWT_SECRET`** is used.

The image sets **`VITE_USE_SAME_ORIGIN_API=true`** during `npm run build`, so the browser calls the **same** host for API + pages.

4. **Networking** → generate a public domain → open it: `/docs` should show Swagger, `/login` should load the app.

---

## AI and agents (OpenAI keys)

| Variable | Role |
|----------|------|
| `OPENAI_API_KEY` | Optional **server-wide** key. Used when an organisation has not saved its own key in the UI. |
| `DEMO_DEFAULT_NGO_ID` | Tenant id for **unauthenticated** agent triggers (board brief cron hook, Razorpay donor payload, grant/CSR/campaign triggers without `ngo_id` in the body). Default: `ngo_001`. |
| `OPENAI_KEY_ENCRYPTION_SECRET` | Optional. Encrypts per-org keys at rest; if unset, **`JWT_SECRET`** is used. |
| `DATABASE_URL` | Required for **persisted** per-org keys across API restarts (`ngo_llm_settings`). Without it, an org key saved via **`POST /settings/llm`** only lives in memory until the process exits. Also enables **optional** RAG vector upsert after real embedding (when `vector_documents` + pgvector exist). |

**UI:** Executive Director → **Settings → AI & Agents** (Vite) — save or remove the organisation OpenAI key (never shown in full after save).

**RAG (`POST /ingest/document`):** Requires an authenticated **ED or Programs** user. Chooses **real embeddings** vs **mock** using the same key resolver as agents (`use_mock=None`). Vector upsert uses **`DATABASE_URL`** via `psycopg2` (same as `core.db`), with legacy **`DB_HOST`** / **`DB_NAME`** fallback when no URL is set.

**Orchestrator (`POST /workflows/trigger-orchestration`, intent queue execute):** Routes `payment.failed` to a recovery placeholder and `donor.nurture.needed` / `donation_received` / `outreach` to the **Donor Nurture** LangGraph with `ngo_id` on the payload so LLM keys resolve per tenant.

**Frontend behaviour:** In **development**, the mock layer may handle `/settings/llm` for local demos. **Production** builds (`npm run build`) pass **`noMockFallback`** for those calls so a missing API cannot be mistaken for a successful key save.

---

## Railway / production frontend + API (two services)

Use **two Railway services** if you prefer separate static hosting and API:

| Service | Role | Typical public URL |
|--------|------|---------------------|
| **Backend** | `uvicorn api.main:app` (FastAPI) | `https://goodjobs-api-xxxx.up.railway.app` |
| **Frontend** | Static `dist/` (Nginx or `vite preview`) | `https://goodjobs-production-xxxx.up.railway.app` |

If the frontend URL only serves HTML/JS, **`POST …/auth/login` on that host will return 405** — the browser must call the **backend** URL. Set `VITE_API_BASE_URL` on the frontend build to the backend’s public origin.

1. **Backend service** — set `FRONTEND_ORIGINS` to every **browser** origin that loads the SPA, comma-separated, e.g.  
   `https://goodjobs.co.in,https://goodjobs-production-xxxx.up.railway.app,http://localhost:5173`  
   so CORS allows `fetch` from the UI. If unset, the API defaults to `localhost:5173` and `https://goodjobs.co.in`.

2. **Frontend build** (variables in Railway **before** `npm run build` / Docker build):
   - **Required for split deploy:** `VITE_API_BASE_URL=https://<your-fastapi-service>.up.railway.app` (no trailing slash). You can list **comma-separated fallbacks** (wrong static URL first, API second) and the SPA will probe until it gets JSON.
   - **Monolith only:** if FastAPI truly serves the SPA from the **same** host, set `VITE_USE_SAME_ORIGIN_API=true` and omit `VITE_API_BASE_URL`.
   - **Sign in with Google (optional):** same **Web client ID** in `VITE_GOOGLE_CLIENT_ID` (frontend build) and `GOOGLE_CLIENT_ID` (API runtime). In [Google Cloud Console](https://console.cloud.google.com/), create an OAuth 2.0 Client ID (Web application), add **Authorized JavaScript origins** (your SPA URL) and **Authorized redirect URIs** is not required for GIS button flow. Without these vars, email/password auth still works.
   - **Hotfix without rebuild:** in the browser console,  
     `localStorage.setItem('goodjobs_api_base','https://<your-fastapi-service>.up.railway.app'); location.reload()`  
     (then fix the build env and redeploy).

3. After deploying a new service worker, hard-refresh or unregister the old SW once so `sw.js` updates.

