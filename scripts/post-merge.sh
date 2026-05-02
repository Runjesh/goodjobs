#!/bin/bash
set -e

echo "[post-merge] Installing npm dependencies..."
npm install --no-audit --no-fund --prefer-offline

if [ -f backend/requirements.txt ]; then
  echo "[post-merge] Installing Python backend dependencies..."
  python -m pip install --quiet --disable-pip-version-check -r backend/requirements.txt || \
    echo "[post-merge] WARN: backend pip install failed (non-fatal — backend workflow not active)."
fi

echo "[post-merge] Done."
