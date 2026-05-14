"""
Very small psycopg2 helper for SevaSuite.

- Uses DATABASE_URL if present.
- Returns None when DB is not configured (demo mode).
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator, Optional

import psycopg2


def get_database_url() -> Optional[str]:
    url = os.getenv("DATABASE_URL")
    return url.strip() if url else None


@contextmanager
def db_conn() -> Iterator[Optional["psycopg2.extensions.connection"]]:
    url = get_database_url()
    if not url:
        yield None
        return

    conn = psycopg2.connect(url)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

