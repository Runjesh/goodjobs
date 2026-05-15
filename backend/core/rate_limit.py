"""Simple in-process rate limiting (login brute-force protection)."""
from __future__ import annotations

import time
from collections import defaultdict
from typing import DefaultDict, List

from fastapi import HTTPException, Request

# Per-IP sliding window for POST /auth/login
_LOGIN_ATTEMPTS: DefaultDict[str, List[float]] = defaultdict(list)
MAX_LOGIN_ATTEMPTS = 30
LOGIN_WINDOW_SECONDS = 10


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host or "unknown"
    return "unknown"


def check_login_rate_limit(request: Request) -> None:
    ip = client_ip(request)
    now = time.time()
    window_start = now - LOGIN_WINDOW_SECONDS
    attempts = [t for t in _LOGIN_ATTEMPTS[ip] if t >= window_start]
    if len(attempts) >= MAX_LOGIN_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Please wait and try again.",
        )
    attempts.append(now)
    _LOGIN_ATTEMPTS[ip] = attempts


def reset_login_rate_limit_for_tests() -> None:
    """Test helper — clear counters between pytest cases."""
    _LOGIN_ATTEMPTS.clear()
