# GoodJobs

India-first nonprofit OS (production site: [goodjobs.co.in](https://goodjobs.co.in)) with an agentic FastAPI backend and a React (Vite) frontend.

## Hosted Postgres setup (persistence)

The backend will use Postgres automatically when `DATABASE_URL` is set. If not set, it falls back to in-memory demo storage for some modules.

### 1) Set env vars

- **Backend**
  - `DATABASE_URL`: hosted Postgres connection string
  - `JWT_SECRET`: (recommended) secret for signing JWTs

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

## Railway / production frontend + API

1. **Backend service** — set `FRONTEND_ORIGINS` to your **browser-facing** site URL(s), comma-separated, e.g.  
   `https://goodjobs.co.in,https://goodjobs-production-xxxx.up.railway.app,http://localhost:5173`  
   so the browser is allowed to call the API (CORS). If unset, the API defaults to allowing `localhost:5173` and `https://goodjobs.co.in`.

2. **Frontend build** — Vite bakes the API URL at build time:
   - If the API is on **another** Railway URL, set **`VITE_API_BASE_URL`** on the **frontend** build to that public API origin (no trailing slash), e.g. `https://your-api-service.up.railway.app`.
   - If the API is served from the **same** public origin as the static app, you can omit `VITE_API_BASE_URL`; the client will use `window.location.origin`.

3. After deploying a new service worker, do a hard refresh or unregister the old SW once so `sw.js` updates.

