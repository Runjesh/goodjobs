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

## Railway — **one service** (simplest)

Use the repo **`Dockerfile`**: one container runs **FastAPI** and serves the built **`dist/`** from the same URL, so you do **not** need `VITE_API_BASE_URL` or a second service.

1. In Railway: **New project** → **Deploy from GitHub** → select this repo.
2. Railway should detect **`Dockerfile`**. If not: service **Settings** → set **Dockerfile path** to `Dockerfile`.
3. **Variables** on that service, at minimum:
   - `FRONTEND_ORIGINS` — your public site URL(s), e.g. `https://goodjobs-production-xxxx.up.railway.app,https://goodjobs.co.in`
   - `JWT_SECRET` — random string  
   - `DATABASE_URL` — if you use Postgres (optional for demo mode)

The image sets **`VITE_USE_SAME_ORIGIN_API=true`** during `npm run build`, so the browser calls the **same** host for API + pages.

4. **Networking** → generate a public domain → open it: `/docs` should show Swagger, `/login` should load the app.

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
   - **Required for split deploy:** `VITE_API_BASE_URL=https://<your-fastapi-service>.up.railway.app` (no trailing slash).
   - **Monolith only:** if FastAPI truly serves the SPA from the **same** host, set `VITE_USE_SAME_ORIGIN_API=true` and omit `VITE_API_BASE_URL`.
   - **Hotfix without rebuild:** in the browser console,  
     `localStorage.setItem('goodjobs_api_base','https://<your-fastapi-service>.up.railway.app'); location.reload()`  
     (then fix the build env and redeploy).

3. After deploying a new service worker, hard-refresh or unregister the old SW once so `sw.js` updates.

