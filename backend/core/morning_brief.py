"""
Morning Brief Agent — role-aware daily priorities + optional WhatsApp to field staff.
"""
from __future__ import annotations

import os
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from core.db import db_conn
from core.wa_delivery_queue import enqueue_wa_delivery

MORNING_BRIEF_MEM_BY_NGO: Dict[str, Dict[str, Any]] = {}


def _field_phones_for_ngo(ngo_id: str) -> List[str]:
    phones: List[str] = []
    env = os.getenv("FIELD_BRIEF_WHATSAPP_PHONES", "").strip()
    if env:
        phones.extend(p.strip() for p in env.split(",") if p.strip())
    with db_conn() as conn:
        if conn is None:
            return phones
        cur = conn.cursor()
        try:
            cur.execute(
                """
                SELECT COALESCE(meta->'whatsapp'->>'phone', meta->>'phone', '')
                FROM ngos WHERE id = %s::uuid
                """,
                (ngo_id,),
            )
            row = cur.fetchone()
            if row and row[0]:
                phones.append(str(row[0]).strip())
        except Exception:
            pass
    seen = set()
    out: List[str] = []
    for p in phones:
        digits = "".join(c for c in p if c.isdigit())
        if len(digits) >= 10 and digits not in seen:
            seen.add(digits)
            out.append(digits if digits.startswith("91") else f"91{digits[-10:]}")
    return out[:5]


def _gather_field_priorities(ngo_id: str) -> List[str]:
    lines: List[str] = []
    with db_conn() as conn:
        if conn is None:
            return [
                "Review pending MIS reports in Programs.",
                "Verify new enrollments (Aadhaar) before they count in dashboards.",
            ]
        cur = conn.cursor()
        try:
            cur.execute(
                """
                SELECT COUNT(*)::int FROM program_beneficiaries
                WHERE ngo_id = %s::uuid AND aadhaar = false
                  AND created_at >= (CURRENT_TIMESTAMP - INTERVAL '7 days')
                """,
                (ngo_id,),
            )
            n = int((cur.fetchone() or [0])[0] or 0)
            if n > 0:
                lines.append(f"{n} enrollment(s) need Aadhaar verification.")
        except Exception:
            pass
        try:
            cur.execute(
                """
                SELECT COUNT(*)::int FROM mis_field_reviews
                WHERE ngo_id = %s::uuid AND status = 'pending'
                """,
                (ngo_id,),
            )
            n = int((cur.fetchone() or [0])[0] or 0)
            if n > 0:
                lines.append(f"{n} field MIS report(s) awaiting supervisor approval.")
        except Exception:
            pass
    if not lines:
        lines.append("No urgent field items — great day for visits and data capture.")
    return lines


def _gather_ed_priorities(ngo_id: str) -> List[str]:
    lines: List[str] = []
    with db_conn() as conn:
        if conn is None:
            return ["Review compliance renewals and fundraising pipeline on Today."]
        cur = conn.cursor()
        try:
            cur.execute(
                """
                SELECT name, expiry_date FROM compliance_documents
                WHERE ngo_id = %s::uuid
                  AND expiry_date IS NOT NULL
                  AND expiry_date::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '45 days')
                ORDER BY expiry_date ASC LIMIT 1
                """,
                (ngo_id,),
            )
            row = cur.fetchone()
            if row:
                lines.append(f"Compliance: {row[0]} renewal due soon.")
        except Exception:
            pass
    if not lines:
        lines.append("Funding, programs and compliance are on track — check Today for details.")
    return lines


def run_morning_brief_delivery(*, ngo_id: str, ngo_name: str = "NGO") -> Dict[str, Any]:
    """Run Morning Brief Agent: store narratives and queue field WhatsApp."""
    run_date = str(date.today())
    field_lines = _gather_field_priorities(ngo_id)
    ed_lines = _gather_ed_priorities(ngo_id)
    base_url = (os.getenv("APP_PUBLIC_URL") or "").rstrip("/") or "https://app.goodjobs.in"

    field_text = (
        f"Good morning from {ngo_name}! 🌅\n"
        + "\n".join(f"• {ln}" for ln in field_lines)
        + f"\n\nOpen Today: {base_url}/"
    )
    ed_text = (
        f"Executive brief — {run_date}\n"
        + "\n".join(f"• {ln}" for ln in ed_lines)
        + f"\n\nDashboard: {base_url}/"
    )

    wa_queued = 0
    for phone in _field_phones_for_ngo(ngo_id):
        try:
            enqueue_wa_delivery(
                ngo_id=ngo_id,
                to_phone=phone,
                message_body=field_text[:4096],
                outreach_id=f"morning-brief-{run_date}",
            )
            wa_queued += 1
        except Exception:
            pass

    record = {
        "run_date": run_date,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "brief_by_role": {"field": field_text, "ed": ed_text, "programs": field_text},
        "field_priorities": field_lines,
        "ed_priorities": ed_lines,
        "whatsapp_queued": wa_queued,
        "status": "delivered",
    }
    MORNING_BRIEF_MEM_BY_NGO[ngo_id] = record
    return record
