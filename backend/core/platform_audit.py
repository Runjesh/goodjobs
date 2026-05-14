"""
Append-only platform audit trail (who changed what). Survives in-memory demo via no-op when DB absent.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from core.db import db_conn


def log_audit(
    *,
    ngo_id: str,
    user_id: str,
    action: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    old_values: Optional[Dict[str, Any]] = None,
    new_values: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None,
) -> None:
    row_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    with db_conn() as conn:
        if conn is None:
            return
        cur = conn.cursor()
        try:
            cur.execute(
                """
                INSERT INTO platform_audit_log (
                    id, ngo_id, user_id, action, entity_type, entity_id,
                    old_values, new_values, ip_address, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::inet, %s)
                """,
                (
                    row_id,
                    ngo_id,
                    user_id,
                    action[:100],
                    (entity_type or "")[:50] or None,
                    (entity_id or "")[:120] or None,
                    json.dumps(old_values) if old_values is not None else None,
                    json.dumps(new_values) if new_values is not None else None,
                    ip_address,
                    now,
                ),
            )
        except Exception:
            # Table may not exist on older DBs — never break primary flows
            pass
