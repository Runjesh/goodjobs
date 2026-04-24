# SevaSuite (GoodJobs)

India-first Nonprofit OS with an agentic FastAPI backend and a React (Vite) frontend.

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

