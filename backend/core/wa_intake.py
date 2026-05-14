"""
Parse WhatsApp Cloud API inbound payloads: org code prefix + free text → Field MIS agent + intake log.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from agents.field_mis_agent import field_mis_agent
from core.db import db_conn
from core import wa_registry


def _lookup_ngo_for_code(code: str) -> Optional[str]:
    c = code.strip().upper()
    hit = wa_registry.mem_lookup_code(c)
    if hit:
        return hit
    with db_conn() as conn:
        if conn is None:
            return None
        cur = conn.cursor()
        try:
            cur.execute(
                "SELECT ngo_id FROM ngo_whatsapp_codes WHERE UPPER(org_code) = %s LIMIT 1",
                (c,),
            )
            row = cur.fetchone()
            if row:
                ngo_id = str(row[0])
                wa_registry.mem_register_code(c, ngo_id)
                return ngo_id
        except Exception:
            pass
    return None


def _default_ngo_from_env() -> Optional[str]:
    import os
    v = os.getenv("WHATSAPP_DEFAULT_NGO_ID", "").strip()
    return v or None


def _invoke_field_mis(raw_text: str, ngo_id: str) -> Dict[str, Any]:
    initial: Dict[str, Any] = {
        "ngo_id": ngo_id,
        "event_type": "whatsapp.message.parsed",
        "raw_input": raw_text,
        "source_language": "english",
        "parsed_data": {},
        "beneficiary_id": None,
        "is_duplicate": False,
        "validation_errors": [],
        "translated_summary": "",
        "dashboard_update": {},
        "alert_required": False,
        "status": "",
    }
    try:
        return dict(field_mis_agent.invoke(initial))
    except Exception as exc:
        return {"status": "error", "error": str(exc)[:300], "translated_summary": raw_text[:200]}


def extract_inbound_text_messages(payload: Dict[str, Any]) -> List[Tuple[str, str]]:
    """Return list of (from_wa_e164, text_body) from a WhatsApp webhook JSON body."""
    out: List[Tuple[str, str]] = []
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            for msg in value.get("messages") or []:
                if msg.get("type") != "text":
                    continue
                frm = str(msg.get("from") or "").strip()
                body = ((msg.get("text") or {}).get("body") or "").strip()
                if frm and body:
                    out.append((frm, body))
    return out


def process_inbound_text(from_phone: str, text_body: str) -> Dict[str, Any]:
    """
    First whitespace-delimited token = org code (e.g. GJDEMO). Remainder = field report text.
    """
    parts = text_body.strip().split(None, 1)
    if not parts:
        return {"ok": False, "reason": "empty"}
    code = parts[0]
    rest = parts[1].strip() if len(parts) > 1 else ""
    if not rest:
        return {"ok": False, "reason": "missing_body_after_code", "code": code}

    ngo_id = _lookup_ngo_for_code(code) or _default_ngo_from_env()
    if not ngo_id:
        return {"ok": False, "reason": "unknown_org_code", "code": code}

    agent_out = _invoke_field_mis(rest, ngo_id)
    rid = str(uuid.uuid4())
    record = {
        "id": rid,
        "ngo_id": ngo_id,
        "source": "whatsapp",
        "from_phone": from_phone,
        "org_code": code.upper(),
        "raw_text": rest,
        "agent_status": agent_out.get("status"),
        "summary": agent_out.get("translated_summary") or rest[:500],
        "dashboard_update": agent_out.get("dashboard_update") or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    wa_registry.append_mis_intake(ngo_id, record)

    # Optional Postgres mirror
    with db_conn() as conn:
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS wa_field_intake (
                        id TEXT PRIMARY KEY,
                        ngo_id TEXT NOT NULL,
                        from_phone TEXT NOT NULL,
                        org_code TEXT NOT NULL,
                        raw_text TEXT NOT NULL,
                        agent_status TEXT,
                        summary TEXT,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cur.execute(
                    """
                    INSERT INTO wa_field_intake (id, ngo_id, from_phone, org_code, raw_text, agent_status, summary, payload)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        rid,
                        ngo_id,
                        from_phone,
                        code.upper(),
                        rest,
                        str(agent_out.get("status") or ""),
                        str(agent_out.get("translated_summary") or "")[:2000],
                        json.dumps({"dashboard_update": agent_out.get("dashboard_update")}),
                    ),
                )
            except Exception:
                pass

    return {"ok": True, "ngo_id": ngo_id, "intake_id": rid, "agent": agent_out}


def process_whatsapp_payload(payload: Dict[str, Any]) -> Dict[str, int]:
    counts = {"messages_seen": 0, "messages_accepted": 0}
    for from_phone, body in extract_inbound_text_messages(payload):
        counts["messages_seen"] += 1
        r = process_inbound_text(from_phone, body)
        if r.get("ok"):
            counts["messages_accepted"] += 1
    return counts


_ORG_CODE_RE = re.compile(r"^[A-Za-z0-9_-]{3,16}$")


def ensure_org_code_for_ngo(ngo_id: str, preferred: Optional[str] = None) -> str:
    """
    Return existing org_code or create one. Persists to DB when available.
    """
    import random
    import string

    with db_conn() as conn:
        if conn is not None:
            cur = conn.cursor()
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS ngo_whatsapp_codes (
                    ngo_id TEXT PRIMARY KEY,
                    org_code VARCHAR(16) NOT NULL UNIQUE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("SELECT org_code FROM ngo_whatsapp_codes WHERE ngo_id = %s LIMIT 1", (ngo_id,))
            row = cur.fetchone()
            if row:
                code = str(row[0])
                wa_registry.mem_register_code(code, ngo_id)
                return code
            base = (preferred or "").strip().upper()
            if not _ORG_CODE_RE.match(base):
                base = "GJ" + "".join(random.choices(string.ascii_uppercase + string.digits, k=5))
            # uniqueness loop
            code = base[:16]
            for _ in range(20):
                cur.execute("SELECT 1 FROM ngo_whatsapp_codes WHERE org_code = %s", (code,))
                if not cur.fetchone():
                    break
                code = "GJ" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
            cur.execute(
                "INSERT INTO ngo_whatsapp_codes (ngo_id, org_code) VALUES (%s, %s) ON CONFLICT (ngo_id) DO NOTHING",
                (ngo_id, code),
            )
            wa_registry.mem_register_code(code, ngo_id)
            return code

    # memory-only DB
    existing = wa_registry.mem_get_code_for_ngo(ngo_id)
    if existing:
        return existing
    code = (preferred or "").strip().upper()
    if not _ORG_CODE_RE.match(code):
        code = "GJ" + "".join(random.choices(string.ascii_uppercase + string.digits, k=5))
    wa_registry.mem_register_code(code, ngo_id)
    return code
