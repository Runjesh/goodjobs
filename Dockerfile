# Single container: Vite build → dist/ + FastAPI serves API + static SPA (one Railway service).
# Build: docker build -t goodjobs .
# Run:  docker run -p 8000:8000 -e PORT=8000 -e JWT_SECRET=dev -e FRONTEND_ORIGINS=http://localhost:8000 goodjobs

FROM node:20-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
# Same browser origin as the API — no second public URL for fetch()
ENV VITE_USE_SAME_ORIGIN_API=true
RUN npm run build

FROM python:3.12-slim AS runtime
WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt
COPY backend /app/backend
COPY --from=frontend /app/dist /app/dist
ENV PYTHONPATH=/app/backend
WORKDIR /app/backend
EXPOSE 8000
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
