"""
PostgreSQL session variable for Row-Level Security (RLS).

Call `apply_ngo_session(cursor, ngo_id)` once per transaction before tenant-scoped queries.
Policies on UUID-backed tables use `current_ngo_id()`; TEXT-backed tables use `current_ngo_id_text()`.
"""
from __future__ import annotations

from typing import Any


def apply_ngo_session(cur: Any, ngo_id: str) -> None:
    """Set app.current_ngo_id for RLS policies (LOCAL = transaction-scoped)."""
    if not ngo_id:
        return
    cur.execute("SET LOCAL app.current_ngo_id = %s", (ngo_id,))
