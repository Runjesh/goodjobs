"""
In-memory registry for WhatsApp field onboarding (org code → tenant) and MIS intake rows.

When DATABASE_URL is set, org codes are also persisted in `ngo_whatsapp_codes` (see schema).
This module always mirrors codes for O(1) webhook routing without importing the FastAPI app.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

# org_code (UPPERCASE) -> ngo_id (app token string, e.g. ngo_001)
_MEM_CODES: Dict[str, str] = {}

# ngo_id -> newest-first list of parsed WhatsApp field intakes
MIS_INTAKE_MEM: Dict[str, List[Dict[str, Any]]] = {}


def mem_register_code(org_code: str, ngo_id: str) -> None:
    _MEM_CODES[org_code.strip().upper()] = ngo_id.strip()


def mem_lookup_code(org_code: str) -> Optional[str]:
    return _MEM_CODES.get(org_code.strip().upper())


def append_mis_intake(ngo_id: str, record: Dict[str, Any]) -> None:
    bucket = MIS_INTAKE_MEM.setdefault(ngo_id, [])
    bucket.insert(0, record)
    # cap per NGO to keep memory bounded in demo
    del bucket[500:]


def list_mis_intake(ngo_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    return list(MIS_INTAKE_MEM.get(ngo_id, [])[:limit])


def mem_get_code_for_ngo(ngo_id: str) -> Optional[str]:
    for code, nid in _MEM_CODES.items():
        if nid == ngo_id.strip():
            return code
    return None
