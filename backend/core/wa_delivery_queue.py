"""
WhatsApp outbound delivery queue with retries (MVP: Postgres + in-memory fallback).
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from core.db import db_conn
from core.wa_client import send_whatsapp_text

WA_QUEUE_MEM: List[Dict[str, Any]] = []


def _ensure_table(cur: Any) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS wa_delivery_queue (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            ngo_id TEXT NOT NULL,
            outreach_id TEXT,
            donor_id TEXT,
            to_phone TEXT NOT NULL,
            message_body TEXT NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'pending',
            retry_count INT NOT NULL DEFAULT 0,
            retry_at TIMESTAMPTZ,
            last_error TEXT,
            wamid TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_wa_delivery_queue_pending ON wa_delivery_queue (status, retry_at)"
    )


def enqueue_wa_delivery(
    *,
    ngo_id: str,
    to_phone: str,
    message_body: str,
    outreach_id: Optional[str] = None,
    donor_id: Optional[str] = None,
) -> str:
    qid = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    row = {
        "id": qid,
        "ngo_id": ngo_id,
        "outreach_id": outreach_id,
        "donor_id": donor_id,
        "to_phone": to_phone,
        "message_body": message_body,
        "status": "pending",
        "retry_count": 0,
        "retry_at": None,
        "last_error": None,
        "wamid": None,
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    with db_conn() as conn:
        if conn is None:
            WA_QUEUE_MEM.append(row)
            return qid
        cur = conn.cursor()
        _ensure_table(cur)
        cur.execute(
            """
            INSERT INTO wa_delivery_queue (
                id, ngo_id, outreach_id, donor_id, to_phone, message_body, status, retry_count, created_at, updated_at
            ) VALUES (%s::uuid, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
            """,
            (qid, ngo_id, outreach_id, donor_id, to_phone, message_body, "pending", 0),
        )
    return qid


def process_wa_delivery_queue(*, limit: int = 20) -> Dict[str, Any]:
    """
    Attempt pending / due retries. Uses WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID.
    """
    wa_token = os.getenv("WHATSAPP_ACCESS_TOKEN", "").strip()
    wa_phone_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "").strip()
    if not wa_token or not wa_phone_id:
        return {"ok": False, "reason": "whatsapp_not_configured", "processed": 0}

    processed = 0
    now = datetime.now(timezone.utc)

    # In-memory queue
    if not os.getenv("DATABASE_URL", "").strip():
        for row in list(WA_QUEUE_MEM):
            if row.get("status") not in ("pending", "failed"):
                continue
            ra = row.get("retry_at")
            if ra and ra > now.isoformat():
                continue
            if int(row.get("retry_count") or 0) >= 3 and row.get("status") == "failed":
                row["status"] = "permanently_failed"
                continue
            try:
                wamid = send_whatsapp_text(wa_token, wa_phone_id, row["to_phone"], row["message_body"])
                row["wamid"] = wamid
                row["status"] = "sent"
                row["last_error"] = None
                row["updated_at"] = now.isoformat()
                processed += 1
            except Exception as exc:
                row["retry_count"] = int(row.get("retry_count") or 0) + 1
                row["last_error"] = str(exc)[:500]
                row["status"] = "failed" if row["retry_count"] < 3 else "permanently_failed"
                row["retry_at"] = (now + timedelta(minutes=5)).isoformat()
                row["updated_at"] = now.isoformat()
            if processed >= limit:
                break
        return {"ok": True, "processed": processed, "source": "memory"}

    with db_conn() as conn:
        if conn is None:
            return {"ok": True, "processed": 0, "source": "none"}
        cur = conn.cursor()
        _ensure_table(cur)
        cur.execute(
            """
            SELECT id, ngo_id, outreach_id, donor_id, to_phone, message_body, status, retry_count, retry_at
            FROM wa_delivery_queue
            WHERE status IN ('pending', 'failed')
              AND retry_count < 3
              AND (retry_at IS NULL OR retry_at <= NOW())
            ORDER BY created_at ASC
            LIMIT %s
            FOR UPDATE SKIP LOCKED
            """,
            (limit,),
        )
        rows = cur.fetchall()
        for r in rows:
            qid, ngo_id, outreach_id, donor_id, to_phone, message_body, status, retry_count, retry_at = r
            try:
                wamid = send_whatsapp_text(wa_token, wa_phone_id, to_phone, message_body)
                cur.execute(
                    """
                    UPDATE wa_delivery_queue
                    SET status = 'sent', wamid = %s, last_error = NULL, updated_at = NOW()
                    WHERE id = %s
                    """,
                    (wamid, qid),
                )
                processed += 1
            except Exception as exc:
                rc = int(retry_count or 0) + 1
                nstatus = "failed" if rc < 3 else "permanently_failed"
                cur.execute(
                    """
                    UPDATE wa_delivery_queue
                    SET status = %s, retry_count = %s, last_error = %s,
                        retry_at = NOW() + INTERVAL '5 minutes', updated_at = NOW()
                    WHERE id = %s
                    """,
                    (nstatus, rc, str(exc)[:500], qid),
                )
    return {"ok": True, "processed": processed, "source": "postgres"}
