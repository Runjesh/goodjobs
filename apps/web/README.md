# GoodJobs — Next.js (`apps/web`)

Shell for the same **FastAPI** backend as the Vite app. Runs on **port 3001** by default so `npm run dev` (Vite, 5173) can run in parallel.

## Setup

```bash
cd apps/web
cp .env.example .env.local   # optional — override API URL
npm install
npm run dev
```

- **`NEXT_PUBLIC_API_BASE_URL`**: FastAPI origin, no trailing slash (default `http://localhost:8000`).
- **Auth**: `POST /auth/login` stores `access_token` + `sevasuite_auth` in `localStorage` (same keys as Vite) so you can switch between UIs during migration.

## Routes

| Path | Purpose |
|------|---------|
| `/login` | Email / password → JWT |
| `/settings/ai` | `GET` / `POST` / `DELETE` `/settings/llm` (ED role to mutate) |

Prisma / Auth.js can be added later for first-party accounts; this package is intentionally minimal.
