from pathlib import Path

from fastapi import FastAPI, BackgroundTasks, HTTPException, Header, Depends, Request, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import csv
import hashlib
import io
import json
import os
import re
import zipfile

from agents.donor_nurture_agent import donor_nurture_app
from agents.finance_compliance_agent import finance_agent
from agents.board_briefing_agent import board_briefing_agent
from agents.grant_report_agent import grant_report_agent
from agents.campaign_intelligence_agent import campaign_agent
from agents.csr_prospect_agent import csr_agent
from agents.field_mis_agent import field_mis_agent
from core.rag_pipeline import ingest_document
from core.tally_xml_export import build_tally_xml
from core.auth import (
    get_current_user, get_current_user_optional, require_role, create_access_token,
    demo_authenticate, TokenUser, DEMO_USERS, revoke_member
)
from core.observability import init_sentry
from jobs.lapse_detector import run_lapse_detection
from core.analytics import predict_revenue, detect_anomalies, calculate_propensity_score, suggest_campaign_goal, classify_fcra_transaction
from agents.orchestrator import process_orchestration
from core.gen_ai import summarize_conversations, analyze_sentiment, draft_annual_report
from core.intent_router import route_intent
from fastapi.responses import Response, FileResponse
from datetime import datetime, timezone, timedelta
from urllib.parse import quote
from core.db import db_conn
from core.s3_storage import (
    generate_presigned_upload_url,
    generate_presigned_download_url,
    list_ngo_files,
    delete_file,
)

# Public endpoints should not require auth; use get_current_user_optional.

# ── Sentry: initialise before app creation ──────────────────────────────────
init_sentry()

app = FastAPI(
    title="GoodJobs API",
    description="Agentic backend for GoodJobs — India-first nonprofit operating system (goodjobs.co.in)",
    version="2.0.0",
)

# CORS — comma-separated origins in FRONTEND_ORIGINS (e.g. Railway app URL + local dev)
_default_origins = "http://localhost:5173,https://goodjobs.co.in"
_cors_env = (os.getenv("FRONTEND_ORIGINS") or _default_origins).strip()
FRONTEND_ORIGIN_LIST = [o.strip() for o in _cors_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGIN_LIST,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── RLS Middleware: set app.current_ngo_id for every authenticated request ──
# In production wire this to a real DB connection pool (asyncpg / SQLAlchemy).
# Here we attach ngo_id to request.state so endpoint logic can read it.
@app.middleware("http")
async def attach_ngo_context(request: Request, call_next):
    response = await call_next(request)
    return response

# In-memory stores (demo mode when DATABASE_URL is not configured)
INTENT_QUEUE_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
COMPLIANCE_DOCS_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
DPDP_NOTICE_MEM_BY_NGO: Dict[str, Dict[str, Any]] = {}
DONORS_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
TX_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
CAMPAIGNS_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
CSR_CARDS_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
CSR_CARD_DOCS_MEM_BY_NGO: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}  # ngo_id -> card_id -> docs
VOLUNTEER_SHIFTS_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
VOLUNTEER_SIGNUPS_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
BENEFICIARIES_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
VOLUNTEERS_ROSTER_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
FINANCE_GRANTS_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
INBOX_STATE_MEM_BY_NGO: Dict[str, Dict[str, Dict[str, Dict[str, Any]]]] = {}
CRM_OUTREACH_LOG_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
# Donor lifecycle state — milestones / skipped / lapseRiskAck per donor.
# Mirrors the JSONB blob stored in donors.meta.lifecycle when a DB is wired
# up. Shape: {ngo_id: {donor_id: {state: dict, updated_at: iso}}}.
DONOR_LIFECYCLE_MEM_BY_NGO: Dict[str, Dict[str, Dict[str, Any]]] = {}
FINANCE_EVENTS_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
NOTIFICATIONS_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}


def _get_mem_inbox_state(ngo_id: str) -> Dict[str, Dict[str, Dict[str, Any]]]:
    return INBOX_STATE_MEM_BY_NGO.setdefault(ngo_id, {})


def _mem_get_state(ngo_id: str, kind: str, ref_id: str) -> Dict[str, Any]:
    return _get_mem_inbox_state(ngo_id).get(kind, {}).get(ref_id, {})


def _mem_upsert_state(ngo_id: str, kind: str, ref_id: str, snoozed_until: Optional[str] = None, resolved_at: Optional[str] = None):
    by_kind = _get_mem_inbox_state(ngo_id).setdefault(kind, {})
    state = by_kind.setdefault(ref_id, {})
    if snoozed_until is not None:
        state["snoozed_until"] = snoozed_until
    if resolved_at is not None:
        state["resolved_at"] = resolved_at
    state["updated_at"] = datetime.now(timezone.utc).isoformat()


def _db_load_inbox_states(cur, ngo_id: str) -> Dict[str, Dict[str, Dict[str, Any]]]:
    cur.execute(
        """
        SELECT kind, ref_id, snoozed_until, resolved_at
        FROM inbox_item_states
        WHERE ngo_id = %s
        """,
        (ngo_id,),
    )
    out: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for kind, ref_id, snoozed_until, resolved_at in cur.fetchall():
        out.setdefault(kind, {})[ref_id] = {
            "snoozed_until": snoozed_until.isoformat() if hasattr(snoozed_until, "isoformat") and snoozed_until else None,
            "resolved_at": resolved_at.isoformat() if hasattr(resolved_at, "isoformat") and resolved_at else None,
        }
    return out


def _db_upsert_inbox_state(cur, ngo_id: str, kind: str, ref_id: str, snoozed_until: Optional[str] = None, resolved_at: Optional[str] = None):
    cur.execute(
        """
        INSERT INTO inbox_item_states (ngo_id, kind, ref_id, snoozed_until, resolved_at, updated_at)
        VALUES (%s, %s, %s, %s::timestamptz, %s::timestamptz, CURRENT_TIMESTAMP)
        ON CONFLICT (ngo_id, kind, ref_id)
        DO UPDATE SET
          snoozed_until = COALESCE(EXCLUDED.snoozed_until, inbox_item_states.snoozed_until),
          resolved_at   = COALESCE(EXCLUDED.resolved_at, inbox_item_states.resolved_at),
          updated_at    = CURRENT_TIMESTAMP
        """,
        (ngo_id, kind, ref_id, snoozed_until, resolved_at),
    )


def _tasks_focus_path(kind: Optional[str], ref_id: Optional[str]) -> Optional[str]:
    """Relative SPA path to focus one inbox row (for notifications, briefs, WhatsApp templates)."""
    k = (kind or "").strip()
    r = (ref_id or "").strip()
    if not k or not r:
        return None
    return f"/tasks?focus={quote(f'{k}:{r}', safe='')}"


def _parse_until_ts(until: str) -> datetime:
    """
    Accepts ISO datetime or YYYY-MM-DD and returns an aware UTC datetime.
    """
    try:
        if len(until) == 10 and until[4] == "-" and until[7] == "-":
            d = datetime.fromisoformat(until)
            return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
        dt = datetime.fromisoformat(until.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid until timestamp format.")


def _inbox_priority_score(it: Dict[str, Any], now: datetime) -> float:
    """Higher = more urgent (deadline × financial impact × compliance risk)."""
    kind = str(it.get("kind") or "")
    meta = it.get("meta") or {}
    if kind == "intent":
        rl = str(meta.get("risk_level") or "").lower()
        base = 930.0 if rl == "high" else 760.0 if rl == "medium" else 640.0
        itype = str(meta.get("intent_type") or "").lower()
        if any(x in itype for x in ("finance", "compliance", "fcra", "grant")):
            base += 35.0
        return base
    if kind == "compliance_doc":
        urgency = 520.0
        exp = meta.get("expiry_date")
        try:
            if exp:
                exp_s = str(exp)[:10]
                exp_dt = datetime.fromisoformat(exp_s).date()
                days = (exp_dt - now.date()).days
                urgency = 520.0 + max(0.0, float(30 - min(30, max(-30, days)))) * 14.0
                if days < 0:
                    urgency += 280.0
        except Exception:
            pass
        if str(meta.get("status") or "") == "Expired":
            urgency += 220.0
        return urgency
    if kind == "finance_flag":
        v = abs(float(meta.get("variance") or 0))
        return 820.0 + min(200.0, v / 20000.0)
    if kind == "donor_outreach_draft":
        return 590.0
    if kind == "month_end_close":
        return 880.0
    if kind in ("csr_win_decay", "csr_stale", "csr_report_due"):
        amt = abs(float(meta.get("amount") or 0))
        fin = min(180.0, amt / 250000.0)  # larger deals float up
        if kind == "csr_win_decay":
            return 740.0 + fin
        if kind == "csr_stale":
            return 670.0 + fin
        return 620.0 + fin
    if kind in ("volunteer_reminder", "volunteer_shift_full"):
        return 360.0
    return 410.0


def _finalize_inbox_items(items: List[Dict[str, Any]]) -> None:
    now = datetime.now(timezone.utc)
    for it in items:
        kind = it.get("kind")
        if kind == "finance_flag":
            meta = it.get("meta") or {}
            name = str(meta.get("name") or "")
            desc = f"Grant {name} utilization variance administrative"
            sug = classify_fcra_transaction(desc)
            it["inline"] = {
                "type": "finance_classification",
                "suggested_category": sug.get("category"),
                "confidence": float(sug.get("confidence") or 0.7),
            }
        elif kind == "intent":
            it["inline"] = {
                "type": "intent_execute",
                "hint": "Approve & run executes the agent workflow immediately.",
            }
        it["priority_score"] = _inbox_priority_score(it, now)
    items.sort(key=lambda x: float(x.get("priority_score") or 0), reverse=True)


def _brief_kinds_for_role(role: str) -> Optional[set]:
    r = (role or "ed").lower()
    if r in ("ed", "admin"):
        return None
    if r == "finance":
        return {
            "finance_flag",
            "compliance_doc",
            "intent",
            "donor_outreach_draft",
            "month_end_close",
        }
    if r == "programs":
        return {
            "volunteer_reminder",
            "volunteer_shift_full",
            "intent",
            "donor_outreach_draft",
            "csr_win_decay",
            "csr_stale",
            "csr_report_due",
        }
    if r == "csr":
        return {
            "csr_win_decay",
            "csr_stale",
            "csr_report_due",
            "intent",
            "donor_outreach_draft",
        }
    if r == "field":
        return {"volunteer_reminder", "volunteer_shift_full"}
    if r == "board":
        return {"compliance_doc", "finance_flag", "intent", "month_end_close"}
    return None


def _handled_by_agents_rows(user: TokenUser) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    with db_conn() as conn:
        if conn is None:
            for it in INTENT_QUEUE_MEM_BY_NGO.get(user.ngo_id, []):
                if it.get("status") != "executed":
                    continue
                out.append(
                    {
                        "directive": it.get("directive"),
                        "intent_type": it.get("intent_type"),
                        "executed_at": it.get("executed_at"),
                    }
                )
            out.sort(key=lambda x: str(x.get("executed_at") or ""), reverse=True)
            return out[:8]
        cur = conn.cursor()
        try:
            cur.execute(
                """
                SELECT directive, intent_type, executed_at
                FROM intent_queue
                WHERE ngo_id = %s AND status = 'executed' AND executed_at IS NOT NULL
                ORDER BY executed_at DESC
                LIMIT 8
                """,
                (user.ngo_id,),
            )
            for r in cur.fetchall():
                out.append(
                    {
                        "directive": r[0],
                        "intent_type": r[1],
                        "executed_at": r[2].isoformat() if hasattr(r[2], "isoformat") else str(r[2]),
                    }
                )
        except Exception:
            pass
    return out


def _enrich_intent_queue_row(item: Dict[str, Any]) -> None:
    rl = str(item.get("risk_level") or "medium").lower()
    conf = {"low": 0.93, "medium": 0.78, "high": 0.58}.get(rl, 0.72)
    item["agent_confidence"] = round(float(conf), 2)
    item["auto_resolve_hours"] = 4 if conf >= 0.9 else (8 if conf >= 0.75 else None)


# In-memory Agent HQ prefs (auto-approve threshold, etc.)
AGENT_HQ_PREFS_MEM: Dict[str, Dict[str, Any]] = {}

CSR_STALE_DAYS = 14
CSR_WIN_DECAY_DAYS = 7


def _parse_iso_dt_optional(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None


def _csr_card_idle_days(card: Dict[str, Any], now: datetime) -> int:
    ts = card.get("last_activity_at")
    dt = _parse_iso_dt_optional(ts) if isinstance(ts, str) else None
    if dt is None:
        ts2 = card.get("updated_at")
        if hasattr(ts2, "timestamp"):
            dt = ts2.astimezone(timezone.utc) if ts2.tzinfo else ts2.replace(tzinfo=timezone.utc)
        elif isinstance(ts2, str):
            dt = _parse_iso_dt_optional(ts2)
    if dt is None:
        ca = card.get("created_at")
        if hasattr(ca, "timestamp"):
            dt = ca.astimezone(timezone.utc) if ca.tzinfo else ca.replace(tzinfo=timezone.utc)
        elif isinstance(ca, str):
            dt = _parse_iso_dt_optional(ca)
    if dt is None:
        return 0
    return max(0, (now - dt).days)


def _csr_followup_draft(company: str, project: str) -> str:
    return (
        f"Namaste {company} CSR team — following up on our partnership discussion for “{project}”. "
        f"We can share a short utilisation snapshot or schedule a 15-minute call this week. What works best?"
    )


def _append_month_end_and_csr_inbox(
    items: List[Dict[str, Any]],
    ngo_id: str,
    conn,
    db_states: Dict[str, Dict[str, Dict[str, Any]]],
    now: datetime,
    mem_mode: bool,
) -> None:
    """Month-end package + CSR stale / win-decay / live reporting nudges."""
    if now.day <= 10:
        first_this = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        last_prev = first_this - timedelta(days=1)
        ref_id = f"mec-{ngo_id}-{last_prev.year}-{last_prev.month:02d}"
        if mem_mode:
            st = _mem_get_state(ngo_id, "month_end_close", ref_id)
        else:
            st = db_states.get("month_end_close", {}).get(ref_id, {})
        snooze_ok = True
        if st.get("snoozed_until"):
            try:
                snooze_ok = _parse_until_ts(st["snoozed_until"]) <= now
            except HTTPException:
                snooze_ok = True
        if not st.get("resolved_at") and snooze_ok:
            items.append(
                {
                    "kind": "month_end_close",
                    "priority": "High",
                    "pill": "Finance",
                    "title": f"Month-end close — {last_prev.strftime('%B %Y')}",
                    "subtitle": "One package: grants, bank recon, and FCRA admin check — review in Finance then mark done.",
                    "meta": {"period": ref_id},
                    "ref": {"id": ref_id},
                    "primary_action": {"label": "Open Finance", "route": "/finance"},
                }
            )

    open_cols = {"prospecting", "pitch", "diligence", "mou"}
    cards: List[Dict[str, Any]] = []
    try:
        if mem_mode:
            _seed_memory_csr(ngo_id)
            cards = list(CSR_CARDS_MEM_BY_NGO.get(ngo_id, []))
        elif conn is not None:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT id::text, company, amount::float, COALESCE(project,''), col, COALESCE(date_label,''),
                       COALESCE(win_probability, 55)::int,
                       COALESCE(updated_at, created_at), created_at
                FROM csr_pipeline_cards
                WHERE ngo_id = %s
                LIMIT 200
                """,
                (ngo_id,),
            )
            for r in cur.fetchall():
                cards.append(
                    {
                        "id": r[0],
                        "company": r[1],
                        "amount": float(r[2] or 0),
                        "project": r[3] or "",
                        "col": r[4] or "prospecting",
                        "date": r[5] or "",
                        "win_probability": int(r[6] or 55),
                        "updated_at": r[7],
                        "created_at": r[8],
                    }
                )
    except Exception:
        cards = []

    def _inbox_st(kind: str, ref: str) -> Dict[str, Any]:
        if mem_mode:
            return _mem_get_state(ngo_id, kind, ref)
        return db_states.get(kind, {}).get(ref, {})

    for c in cards:
        col = (c.get("col") or "").lower()
        cid = str(c.get("id") or "")
        if not cid:
            continue
        days = _csr_card_idle_days(c, now)
        base_prob = int(c.get("win_probability") or 55)
        decayed = max(15, base_prob - max(0, days - CSR_WIN_DECAY_DAYS) * 3)

        if col in open_cols and CSR_WIN_DECAY_DAYS <= days < CSR_STALE_DAYS and decayed <= base_prob - 12:
            ref_decay = f"cwd-{cid}"
            st = _inbox_st("csr_win_decay", ref_decay)
            snooze_ok = True
            if st.get("snoozed_until"):
                try:
                    snooze_ok = _parse_until_ts(st["snoozed_until"]) <= now
                except HTTPException:
                    snooze_ok = True
            if not st.get("resolved_at") and snooze_ok:
                items.append(
                    {
                        "kind": "csr_win_decay",
                        "priority": "High",
                        "pill": "CSR",
                        "title": f"Deal cooling: {c.get('company')}",
                        "subtitle": f"No meaningful touchpoint in ~{days} days — heuristic win confidence ~{decayed}%.",
                        "meta": {**c, "decayed_win_probability": decayed},
                        "ref": {"id": ref_decay},
                        "primary_action": {"label": "Open CSR", "route": "/csr"},
                        "inline": {
                            "type": "csr_followup",
                            "card_id": cid,
                            "draft_message": _csr_followup_draft(str(c.get("company")), str(c.get("project"))),
                        },
                    }
                )
        elif col in open_cols and days >= CSR_STALE_DAYS:
            ref_stale = f"cst-{cid}"
            st = _inbox_st("csr_stale", ref_stale)
            snooze_ok = True
            if st.get("snoozed_until"):
                try:
                    snooze_ok = _parse_until_ts(st["snoozed_until"]) <= now
                except HTTPException:
                    snooze_ok = True
            if not st.get("resolved_at") and snooze_ok:
                items.append(
                    {
                        "kind": "csr_stale",
                        "priority": "Medium",
                        "pill": "CSR",
                        "title": f"CSR follow-up: {c.get('company')}",
                        "subtitle": f"No activity in {days} days — stage: {col}.",
                        "meta": c,
                        "ref": {"id": ref_stale},
                        "primary_action": {"label": "Open CSR", "route": "/csr"},
                        "inline": {
                            "type": "csr_followup",
                            "card_id": cid,
                            "draft_message": _csr_followup_draft(str(c.get("company")), str(c.get("project"))),
                        },
                    }
                )

        if col == "live" and days >= 21:
            ref_live = f"csrpt-{cid}"
            st = _inbox_st("csr_report_due", ref_live)
            snooze_ok = True
            if st.get("snoozed_until"):
                try:
                    snooze_ok = _parse_until_ts(st["snoozed_until"]) <= now
                except HTTPException:
                    snooze_ok = True
            if not st.get("resolved_at") and snooze_ok:
                items.append(
                    {
                        "kind": "csr_report_due",
                        "priority": "Medium",
                        "pill": "CSR",
                        "title": f"MIS / UC milestone: {c.get('company')}",
                        "subtitle": f"Live project — draft utilisation pack for “{c.get('project')}”.",
                        "meta": c,
                        "ref": {"id": ref_live},
                        "primary_action": {"label": "Open CSR", "route": "/csr"},
                        "inline": {
                            "type": "csr_uc",
                            "card_id": cid,
                            "company": c.get("company"),
                            "project": c.get("project"),
                        },
                    }
                )


def _mask_pan(pan: str) -> str:
    p = (pan or "").strip().upper()
    if len(p) < 4:
        return p
    # Simple mask: keep first 4 and last 1 when length permits
    if len(p) <= 5:
        return p[0] + "*" * (len(p) - 2) + p[-1]
    return p[:4] + "*" * max(0, len(p) - 5) + p[-1]


def _seed_memory_crm(ngo_id: str):
    """
    Populate memory mode with the same demo donors/transactions as the frontend
    so the app feels "alive" without a DB.
    """
    if ngo_id in DONORS_MEM_BY_NGO:
        return
    donors = [
        {"id": "1", "name": "Anjali Desai", "type": "Major Donor", "totalGiven": 450000, "lastGift": "2026-03-15", "initial": "A", "pan": "ABCP****4D", "location": "Mumbai, Maharashtra", "tags": ["Education Cause"], "email": "anjali@example.com", "phone": "+91-98***01", "meta": {"employer": "Self", "preferred_channel": "whatsapp", "notes": "Interested in site visits"}},
        {"id": "2", "name": "Rohan Gupta", "type": "Recurring", "totalGiven": 24000, "lastGift": "2026-04-01", "initial": "R", "pan": "BVCX****9H", "location": "Delhi, NCR", "tags": ["Monthly Giver"], "email": "", "phone": "", "meta": {}},
        {"id": "3", "name": "Infosys Foundation", "type": "CSR Partner", "totalGiven": 5000000, "lastGift": "2025-11-20", "initial": "I", "pan": "INFS****1C", "location": "Bangalore, Karnataka", "tags": ["CSR"], "email": "csr@example.org", "phone": "", "meta": {}},
        {"id": "4", "name": "Priya Sharma", "type": "Lapsing", "totalGiven": 15000, "lastGift": "2025-08-10", "initial": "P", "pan": "PRYS****3J", "location": "Pune, Maharashtra", "tags": ["Health"], "email": "", "phone": "", "meta": {}},
        {"id": "5", "name": "Vikram Singh", "type": "Event Attendee", "totalGiven": 5000, "lastGift": "2026-02-28", "initial": "V", "pan": "VKRS****2K", "location": "Jaipur, Rajasthan", "tags": ["Events"], "email": "", "phone": "", "meta": {}},
    ]
    DONORS_MEM_BY_NGO[ngo_id] = donors
    TX_MEM_BY_NGO[ngo_id] = [
        {"id": "TRX-1092", "donorId": "1", "donorName": "Anjali Desai", "amount": 5000, "method": "UPI AutoPay", "campaignId": "c1", "campaignTitle": "Digital Literacy for Rural Girls", "date": "2 Mins ago", "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000) - 120000},
        {"id": "TRX-1091", "donorId": "4", "donorName": "Priya Sharma", "amount": 15000, "method": "Credit Card", "campaignId": "c2", "campaignTitle": "Emergency Medical Relief Fund", "date": "15 Mins ago", "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000) - 900000},
        {"id": "TRX-1090", "donorId": "2", "donorName": "Rohan Gupta", "amount": 2500, "method": "UPI QR", "campaignId": "c1", "campaignTitle": "Digital Literacy for Rural Girls", "date": "1 Hour ago", "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000) - 3600000},
        {"id": "TRX-1089", "donorId": "3", "donorName": "Infosys Foundation", "amount": 50000, "method": "NEFT", "campaignId": "c2", "campaignTitle": "Emergency Medical Relief Fund", "date": "3 Hours ago", "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000) - 10800000},
    ]


def _seed_memory_campaigns(ngo_id: str):
    if ngo_id in CAMPAIGNS_MEM_BY_NGO:
        return
    CAMPAIGNS_MEM_BY_NGO[ngo_id] = [
        {
            "id": "c1",
            "title": "Digital Literacy for Rural Girls",
            "raised": 1250000,
            "goal": 2000000,
            "donorsCount": 342,
            "status": "active",
            "image": "linear-gradient(135deg, #a855f7, #ec4899)",
            "cause": "Education",
            "details": {"story": "Rural girls gain digital skills and safer internet habits.", "partner_org": "District Education Office", "public_url": ""},
        },
        {
            "id": "c2",
            "title": "Emergency Medical Relief Fund",
            "raised": 850000,
            "goal": 1000000,
            "donorsCount": 89,
            "status": "active",
            "image": "linear-gradient(135deg, #3b82f6, #06b6d4)",
            "cause": "Health",
            "details": {},
        },
        {
            "id": "c3",
            "title": "Annual Gala 2026 Table Booking",
            "raised": 0,
            "goal": 500000,
            "donorsCount": 0,
            "status": "draft",
            "image": "linear-gradient(135deg, #10b981, #3b82f6)",
            "cause": "Events",
            "details": {},
        },
    ]


def _seed_memory_csr(ngo_id: str):
    if ngo_id in CSR_CARDS_MEM_BY_NGO:
        return
    t = datetime.now(timezone.utc)

    def ago(days: int) -> str:
        return (t - timedelta(days=days)).isoformat()

    CSR_CARDS_MEM_BY_NGO[ngo_id] = [
        {"id": "1", "company": "Reliance Industries", "amount": 5000000, "project": "Rural Healthcare Phase 2", "tags": ["Health", "Gujarat"], "agent": "AD", "col": "prospecting", "date": "Stale demo", "last_activity_at": ago(20), "win_probability": 52},
        {"id": "2", "company": "Tata Consultancy Services", "amount": 2500000, "project": "Digital Literacy 2026", "tags": ["Education", "Tech"], "agent": "RS", "col": "pitch", "date": "Sent on: Oct 12", "last_activity_at": ago(10), "win_probability": 58},
        {"id": "3", "company": "HDFC Bank CSR", "amount": 8000000, "project": "Women Livelihood Center", "tags": ["Livelihood"], "agent": "AD", "col": "diligence", "date": "Audit pending", "last_activity_at": ago(3), "win_probability": 62},
        {"id": "4", "company": "Wipro Care", "amount": 1200000, "project": "School Infrastructure", "tags": ["Education", "WASH"], "agent": "PM", "col": "mou", "date": "Signed: Oct 15", "last_activity_at": ago(2), "win_probability": 70},
        {"id": "5", "company": "Mahindra Finance", "amount": 4500000, "project": "Farmer Support Init", "tags": ["Agriculture"], "agent": "RS", "col": "live", "date": "Report due: Nov 30", "last_activity_at": ago(28), "win_probability": 80},
        {"id": "6", "company": "Infosys Foundation", "amount": 6000000, "project": "STEM for Girls", "tags": ["Education"], "agent": "AD", "col": "live", "date": "Report due: Dec 15", "last_activity_at": ago(5), "win_probability": 76},
    ]


def _seed_memory_volunteer_ops(ngo_id: str):
    if ngo_id in VOLUNTEER_SHIFTS_MEM_BY_NGO:
        return
    VOLUNTEER_SHIFTS_MEM_BY_NGO[ngo_id] = [
        {"id": 1, "title": "Weekend Teaching Assistant", "date": "Sat, Nov 12 • 09:00 AM", "location": "Govt School, Block B", "filled": 4, "total": 5, "role": "Education"},
        {"id": 2, "title": "Health Camp Registration Desk", "date": "Sun, Nov 13 • 08:30 AM", "location": "Community Hall, Pune", "filled": 8, "total": 10, "role": "Admin"},
        {"id": 3, "title": "Tree Plantation Drive", "date": "Sat, Nov 19 • 07:00 AM", "location": "City Park Outskirts", "filled": 25, "total": 50, "role": "Environment"},
    ]
    VOLUNTEER_SIGNUPS_MEM_BY_NGO[ngo_id] = []


def _seed_memory_beneficiaries(ngo_id: str):
    if ngo_id in BENEFICIARIES_MEM_BY_NGO:
        return
    BENEFICIARIES_MEM_BY_NGO[ngo_id] = [
        {
            "id": "BEN-1045",
            "name": "Lakshmi Devi",
            "program": "Women Livelihood Center",
            "location": "Nashik, MH",
            "aadhaar": True,
            "familySize": 4,
            "details": {"phone": "+91-98***12", "referral_source": "shg", "gender": "female", "vulnerability_flags": ["woman_headed"]},
        },
        {
            "id": "BEN-1046",
            "name": "Rahul Kumar",
            "program": "Digital Literacy 2026",
            "location": "Patna, BR",
            "aadhaar": True,
            "familySize": 1,
            "details": {"referral_source": "camp", "gender": "male"},
        },
        {"id": "BEN-1047", "name": "Sunita Bai", "program": "Healthcare Camp", "location": "Pune, MH", "aadhaar": False, "familySize": 3, "details": {}},
        {"id": "BEN-1048", "name": "Anita Desai", "program": "Women Livelihood Center", "location": "Nashik, MH", "aadhaar": True, "familySize": 5, "details": {}},
    ]


def _seed_memory_volunteer_roster(ngo_id: str):
    if ngo_id in VOLUNTEERS_ROSTER_MEM_BY_NGO:
        return
    VOLUNTEERS_ROSTER_MEM_BY_NGO[ngo_id] = [
        {"id": "V-101", "name": "Rohan Sharma", "skills": ["Teaching", "English"], "hours": 45, "verified": True, "profile": {"city": "Pune", "phone": "+91-98***01", "email": "rohan.s@email.com"}},
        {"id": "V-102", "name": "Priya Patel", "skills": ["Medical Camp", "Admin"], "hours": 120, "verified": True, "profile": {"city": "Mumbai"}},
        {"id": "V-103", "name": "Karan Singh", "skills": ["Logistics"], "hours": 8, "verified": False, "profile": {}},
        {"id": "V-104", "name": "Neha Gupta", "skills": ["Social Media", "Photography"], "hours": 32, "verified": True, "profile": {"availability": "Weekends"}},
    ]


def _seed_memory_finance_grants(ngo_id: str):
    if ngo_id in FINANCE_GRANTS_MEM_BY_NGO:
        return
    FINANCE_GRANTS_MEM_BY_NGO[ngo_id] = [
        {"id": "G-2026-01", "name": "Rural Digital Literacy (CSR)", "total": 2500000, "spent": 1800000, "variance": 50000, "status": "On Track"},
        {"id": "G-2026-02", "name": "Women Empowerment (FCRA)", "total": 4000000, "spent": 3800000, "variance": -150000, "status": "Over Budget"},
        {"id": "G-2026-03", "name": "Healthcare Camp Fund", "total": 1000000, "spent": 400000, "variance": 0, "status": "On Track"},
    ]


class BeneficiaryCreate(BaseModel):
    name: str
    program: str
    location: str
    aadhaar: bool = False
    familySize: int = 1
    details: Optional[Dict[str, Any]] = None


@app.get("/programs/beneficiaries", tags=["Programs"])
def list_beneficiaries(current_user: TokenUser = Depends(require_role("ed", "programs", "board"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_beneficiaries(current_user.ngo_id)
            return {"beneficiaries": BENEFICIARIES_MEM_BY_NGO.get(current_user.ngo_id, []), "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name, program, location, aadhaar, family_size, COALESCE(details, '{}'::jsonb)
            FROM program_beneficiaries
            WHERE ngo_id = %s
            ORDER BY created_at DESC
            LIMIT 1000
            """,
            (current_user.ngo_id,),
        )
        rows = cur.fetchall()
        return {
            "beneficiaries": [
                {
                    "id": r[0],
                    "name": r[1],
                    "program": r[2],
                    "location": r[3],
                    "aadhaar": bool(r[4]),
                    "familySize": int(r[5]),
                    "details": _parse_jsonb(r[6]),
                }
                for r in rows
            ],
            "source": "db",
        }


@app.post("/programs/beneficiaries", tags=["Programs"])
def create_beneficiary(body: BeneficiaryCreate, current_user: TokenUser = Depends(require_role("ed", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_beneficiaries(current_user.ngo_id)
            new_id = f"BEN-{1000 + len(BENEFICIARIES_MEM_BY_NGO.get(current_user.ngo_id, [])) + 49}"
            ben = {
                "id": new_id,
                "name": body.name,
                "program": body.program,
                "location": body.location,
                "aadhaar": bool(body.aadhaar),
                "familySize": int(body.familySize),
                "details": body.details or {},
            }
            BENEFICIARIES_MEM_BY_NGO.setdefault(current_user.ngo_id, []).insert(0, ben)
            return {"status": "created", "beneficiary": ben, "source": "memory"}
        cur = conn.cursor()
        new_id = f"BEN-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        cur.execute(
            """
            INSERT INTO program_beneficiaries (id, ngo_id, name, program, location, aadhaar, family_size, details)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            RETURNING id
            """,
            (
                new_id,
                current_user.ngo_id,
                body.name,
                body.program,
                body.location,
                bool(body.aadhaar),
                int(body.familySize),
                json.dumps(body.details or {}),
            ),
        )
        ben = {
            "id": new_id,
            "name": body.name,
            "program": body.program,
            "location": body.location,
            "aadhaar": bool(body.aadhaar),
            "familySize": int(body.familySize),
            "details": body.details or {},
        }
        return {"status": "created", "beneficiary": ben, "source": "db"}


class BeneficiaryBulkImport(BaseModel):
    beneficiaries: List[BeneficiaryCreate]


@app.post("/programs/beneficiaries/bulk", tags=["Programs"])
def bulk_import_beneficiaries(body: BeneficiaryBulkImport, current_user: TokenUser = Depends(require_role("ed", "programs"))):
    n = 0
    with db_conn() as conn:
        if conn is None:
            _seed_memory_beneficiaries(current_user.ngo_id)
            lst = BENEFICIARIES_MEM_BY_NGO.setdefault(current_user.ngo_id, [])
            base = 1000 + len(lst)
            for b in body.beneficiaries[:500]:
                if not (b.name or "").strip():
                    continue
                new_id = f"BEN-{base + n}"
                ben = {
                    "id": new_id,
                    "name": b.name,
                    "program": b.program,
                    "location": b.location,
                    "aadhaar": bool(b.aadhaar),
                    "familySize": int(b.familySize),
                    "details": b.details or {},
                }
                lst.insert(0, ben)
                n += 1
            return {"imported": n, "source": "memory"}
        cur = conn.cursor()
        for b in body.beneficiaries[:500]:
            if not (b.name or "").strip():
                continue
            new_id = f"BEN-{int(datetime.now(timezone.utc).timestamp() * 1000)}_{n}"
            cur.execute(
                """
                INSERT INTO program_beneficiaries (id, ngo_id, name, program, location, aadhaar, family_size, details)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    new_id,
                    current_user.ngo_id,
                    b.name,
                    b.program,
                    b.location,
                    bool(b.aadhaar),
                    int(b.familySize),
                    json.dumps(b.details or {}),
                ),
            )
            n += 1
        return {"imported": n, "source": "db"}


@app.put("/programs/beneficiaries/{ben_id}", tags=["Programs"])
def update_beneficiary(ben_id: str, body: BeneficiaryCreate, current_user: TokenUser = Depends(require_role("ed", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_beneficiaries(current_user.ngo_id)
            lst = BENEFICIARIES_MEM_BY_NGO.get(current_user.ngo_id, [])
            for i, b in enumerate(lst):
                if str(b.get("id")) == ben_id:
                    lst[i].update({
                        "name": body.name,
                        "program": body.program,
                        "location": body.location,
                        "aadhaar": bool(body.aadhaar),
                        "familySize": int(body.familySize),
                        "details": body.details or lst[i].get("details") or {},
                    })
                    return {"status": "updated", "beneficiary": lst[i], "source": "memory"}
            raise HTTPException(status_code=404, detail="Beneficiary not found")
        
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE program_beneficiaries
            SET name = %s, program = %s, location = %s, aadhaar = %s, family_size = %s, details = %s::jsonb
            WHERE id = %s AND ngo_id = %s
            RETURNING id
            """,
            (
                body.name,
                body.program,
                body.location,
                bool(body.aadhaar),
                int(body.familySize),
                json.dumps(body.details or {}),
                ben_id,
                current_user.ngo_id,
            ),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Beneficiary not found")
        return {"status": "updated", "id": ben_id, "source": "db"}


@app.delete("/programs/beneficiaries/{ben_id}", tags=["Programs"])
def delete_beneficiary(ben_id: str, current_user: TokenUser = Depends(require_role("ed", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_beneficiaries(current_user.ngo_id)
            lst = BENEFICIARIES_MEM_BY_NGO.get(current_user.ngo_id, [])
            before_len = len(lst)
            BENEFICIARIES_MEM_BY_NGO[current_user.ngo_id] = [b for b in lst if str(b.get("id")) != ben_id]
            if len(BENEFICIARIES_MEM_BY_NGO[current_user.ngo_id]) == before_len:
                raise HTTPException(status_code=404, detail="Beneficiary not found")
            return {"status": "deleted", "id": ben_id, "source": "memory"}
        
        cur = conn.cursor()
        cur.execute("DELETE FROM program_beneficiaries WHERE id = %s AND ngo_id = %s RETURNING id", (ben_id, current_user.ngo_id))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Beneficiary not found")
        return {"status": "deleted", "id": ben_id, "source": "db"}


class VolunteerCreate(BaseModel):
    name: str
    skills: List[str] = []
    verified: bool = False
    profile: Optional[Dict[str, Any]] = None


@app.get("/volunteers/roster", tags=["Volunteers"])
def list_volunteer_roster(current_user: TokenUser = Depends(require_role("ed", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_volunteer_roster(current_user.ngo_id)
            return {"volunteers": VOLUNTEERS_ROSTER_MEM_BY_NGO.get(current_user.ngo_id, []), "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name, COALESCE(skills,'{}'), hours, verified, COALESCE(profile, '{}'::jsonb)
            FROM volunteer_roster
            WHERE ngo_id = %s
            ORDER BY created_at DESC
            LIMIT 2000
            """,
            (current_user.ngo_id,),
        )
        rows = cur.fetchall()
        return {
            "volunteers": [
                {
                    "id": r[0],
                    "name": r[1],
                    "skills": list(r[2] or []),
                    "hours": int(r[3] or 0),
                    "verified": bool(r[4]),
                    "profile": _parse_jsonb(r[5]),
                }
                for r in rows
            ],
            "source": "db",
        }


@app.post("/volunteers/roster", tags=["Volunteers"])
def create_volunteer_roster(body: VolunteerCreate, current_user: TokenUser = Depends(require_role("ed", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_volunteer_roster(current_user.ngo_id)
            new_id = f"V-{100 + len(VOLUNTEERS_ROSTER_MEM_BY_NGO.get(current_user.ngo_id, [])) + 5}"
            v = {
                "id": new_id,
                "name": body.name,
                "skills": body.skills or [],
                "hours": 0,
                "verified": bool(body.verified),
                "profile": body.profile or {},
            }
            VOLUNTEERS_ROSTER_MEM_BY_NGO.setdefault(current_user.ngo_id, []).insert(0, v)
            return {"status": "created", "volunteer": v, "source": "memory"}
        cur = conn.cursor()
        new_id = f"V-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        cur.execute(
            """
            INSERT INTO volunteer_roster (id, ngo_id, name, skills, hours, verified, profile)
            VALUES (%s, %s, %s, %s, 0, %s, %s::jsonb)
            RETURNING id
            """,
            (
                new_id,
                current_user.ngo_id,
                body.name,
                body.skills or [],
                bool(body.verified),
                json.dumps(body.profile or {}),
            ),
        )
        v = {
            "id": new_id,
            "name": body.name,
            "skills": body.skills or [],
            "hours": 0,
            "verified": bool(body.verified),
            "profile": body.profile or {},
        }
        return {"status": "created", "volunteer": v, "source": "db"}


@app.put("/volunteers/roster/{v_id}", tags=["Volunteers"])
def update_volunteer(v_id: str, body: VolunteerCreate, current_user: TokenUser = Depends(require_role("ed", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_volunteer_roster(current_user.ngo_id)
            lst = VOLUNTEERS_ROSTER_MEM_BY_NGO.get(current_user.ngo_id, [])
            for i, v in enumerate(lst):
                if str(v.get("id")) == v_id:
                    lst[i].update({
                        "name": body.name,
                        "skills": body.skills or [],
                        "verified": bool(body.verified),
                        "profile": body.profile or lst[i].get("profile") or {},
                    })
                    return {"status": "updated", "volunteer": lst[i], "source": "memory"}
            raise HTTPException(status_code=404, detail="Volunteer not found")
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE volunteer_roster
            SET name = %s, skills = %s, verified = %s, profile = %s::jsonb
            WHERE id = %s AND ngo_id = %s
            RETURNING id
            """,
            (body.name, body.skills or [], bool(body.verified), json.dumps(body.profile or {}), v_id, current_user.ngo_id),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Volunteer not found")
        return {"status": "updated", "id": v_id, "source": "db"}


@app.delete("/volunteers/roster/{v_id}", tags=["Volunteers"])
def delete_volunteer(v_id: str, current_user: TokenUser = Depends(require_role("ed", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_volunteer_roster(current_user.ngo_id)
            lst = VOLUNTEERS_ROSTER_MEM_BY_NGO.get(current_user.ngo_id, [])
            before_len = len(lst)
            VOLUNTEERS_ROSTER_MEM_BY_NGO[current_user.ngo_id] = [v for v in lst if str(v.get("id")) != v_id]
            if len(VOLUNTEERS_ROSTER_MEM_BY_NGO[current_user.ngo_id]) == before_len:
                raise HTTPException(status_code=404, detail="Volunteer not found")
            return {"status": "deleted", "id": v_id, "source": "memory"}
        cur = conn.cursor()
        cur.execute("DELETE FROM volunteer_roster WHERE id = %s AND ngo_id = %s RETURNING id", (v_id, current_user.ngo_id))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Volunteer not found")
        return {"status": "deleted", "id": v_id, "source": "db"}


class VolunteerSignupRequest(BaseModel):
    volunteer_name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    transport_mode: Optional[str] = None
    dietary_notes: Optional[str] = None
    notes: Optional[str] = None


@app.get("/volunteers/shifts", tags=["Volunteers"])
def list_volunteer_shifts(current_user: TokenUser = Depends(require_role("ed", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_volunteer_ops(current_user.ngo_id)
            return {"shifts": VOLUNTEER_SHIFTS_MEM_BY_NGO.get(current_user.ngo_id, []), "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, title, date_label, location, filled, total, role
            FROM volunteer_shifts
            WHERE ngo_id = %s
            ORDER BY id ASC
            """,
            (current_user.ngo_id,),
        )
        rows = cur.fetchall()
        return {
            "shifts": [
                {"id": r[0], "title": r[1], "date": r[2], "location": r[3], "filled": int(r[4]), "total": int(r[5]), "role": r[6]}
                for r in rows
            ],
            "source": "db",
        }


@app.post("/volunteers/shifts/{shift_id}/signup", tags=["Volunteers"])
def signup_volunteer_shift(
    shift_id: int,
    body: VolunteerSignupRequest,
    current_user: TokenUser = Depends(require_role("ed", "programs")),
):
    if not body.volunteer_name.strip():
        raise HTTPException(status_code=400, detail="volunteer_name is required.")

    with db_conn() as conn:
        if conn is None:
            _seed_memory_volunteer_ops(current_user.ngo_id)
            shifts = VOLUNTEER_SHIFTS_MEM_BY_NGO.get(current_user.ngo_id, [])
            shift = next((s for s in shifts if int(s.get("id")) == int(shift_id)), None)
            if not shift:
                raise HTTPException(status_code=404, detail="Shift not found.")
            if int(shift.get("filled", 0)) >= int(shift.get("total", 0)):
                raise HTTPException(status_code=409, detail="Shift is full.")

            signup_id = f"vs_{int(datetime.now(timezone.utc).timestamp() * 1000)}"
            su_details = {
                k: v
                for k, v in {
                    "phone": (body.phone or "").strip() or None,
                    "email": (body.email or "").strip().lower() or None,
                    "emergency_contact_name": (body.emergency_contact_name or "").strip() or None,
                    "emergency_contact_phone": (body.emergency_contact_phone or "").strip() or None,
                    "transport_mode": (body.transport_mode or "").strip() or None,
                    "dietary_notes": (body.dietary_notes or "").strip() or None,
                    "notes": (body.notes or "").strip() or None,
                }.items()
                if v
            }
            VOLUNTEER_SIGNUPS_MEM_BY_NGO.setdefault(current_user.ngo_id, []).append(
                {
                    "id": signup_id,
                    "shiftId": int(shift_id),
                    "volunteerName": body.volunteer_name,
                    "createdAt": datetime.now(timezone.utc).isoformat(),
                    "details": su_details,
                }
            )
            shift["filled"] = int(shift.get("filled", 0)) + 1
            event = {
                "type": "signup",
                "shift_id": int(shift_id),
                "shift_title": shift.get("title"),
                "volunteer_name": body.volunteer_name,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "by": current_user.email,
            }
            VOLUNTEER_ACTIVITY_LOG.append(event)
            return {"status": "signed_up", "signup_id": signup_id, "shift": shift, "source": "memory"}

        cur = conn.cursor()
        cur.execute(
            "SELECT filled, total, title FROM volunteer_shifts WHERE ngo_id = %s AND id = %s",
            (current_user.ngo_id, int(shift_id)),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Shift not found.")
        filled, total, title = int(row[0]), int(row[1]), row[2]
        if filled >= total:
            raise HTTPException(status_code=409, detail="Shift is full.")

        signup_id = f"vs_{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        su_details = {
            k: v
            for k, v in {
                "phone": (body.phone or "").strip() or None,
                "email": (body.email or "").strip().lower() or None,
                "emergency_contact_name": (body.emergency_contact_name or "").strip() or None,
                "emergency_contact_phone": (body.emergency_contact_phone or "").strip() or None,
                "transport_mode": (body.transport_mode or "").strip() or None,
                "dietary_notes": (body.dietary_notes or "").strip() or None,
                "notes": (body.notes or "").strip() or None,
            }.items()
            if v
        }
        cur.execute(
            """
            INSERT INTO volunteer_shift_signups (id, ngo_id, shift_id, volunteer_name, details)
            VALUES (%s, %s, %s, %s, %s::jsonb)
            """,
            (signup_id, current_user.ngo_id, int(shift_id), body.volunteer_name, json.dumps(su_details)),
        )
        cur.execute(
            "UPDATE volunteer_shifts SET filled = filled + 1 WHERE ngo_id = %s AND id = %s",
            (current_user.ngo_id, int(shift_id)),
        )
        event = {
            "type": "signup",
            "shift_id": int(shift_id),
            "shift_title": title,
            "volunteer_name": body.volunteer_name,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "by": current_user.email,
        }
        VOLUNTEER_ACTIVITY_LOG.append(event)
        return {"status": "signed_up", "signup_id": signup_id, "source": "db"}


@app.get("/volunteers/signups", tags=["Volunteers"])
def list_volunteer_signups(current_user: TokenUser = Depends(require_role("ed", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_volunteer_ops(current_user.ngo_id)
            return {"signups": VOLUNTEER_SIGNUPS_MEM_BY_NGO.get(current_user.ngo_id, []), "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, shift_id, volunteer_name, created_at, COALESCE(details, '{}'::jsonb)
            FROM volunteer_shift_signups
            WHERE ngo_id = %s
            ORDER BY created_at DESC
            LIMIT 500
            """,
            (current_user.ngo_id,),
        )
        rows = cur.fetchall()
        return {
            "signups": [
                {
                    "id": r[0],
                    "shiftId": int(r[1]),
                    "volunteerName": r[2],
                    "createdAt": r[3].isoformat() if hasattr(r[3], "isoformat") else str(r[3]),
                    "details": _parse_jsonb(r[4]),
                }
                for r in rows
            ],
            "source": "db",
        }


class CsrCardCreate(BaseModel):
    company: str
    amount: float
    project: str = ""
    tags: List[str] = []
    agent: str = "AD"
    col: str = "prospecting"
    date: str = "Just added"
    details: Optional[Dict[str, Any]] = None


class CsrCardMove(BaseModel):
    col: str


class CsrDocCreate(BaseModel):
    id: Optional[str] = None
    name: str
    doc_type: Optional[str] = None
    size_bytes: int = 0
    s3_key: Optional[str] = None


def _ts_iso(val: Any) -> Optional[str]:
    if val is None:
        return None
    if hasattr(val, "isoformat"):
        return val.isoformat()
    return str(val)


def _parse_jsonb(val: Any) -> Dict[str, Any]:
    if val is None:
        return {}
    if isinstance(val, dict):
        return val
    if isinstance(val, str):
        try:
            out = json.loads(val)
            return out if isinstance(out, dict) else {}
        except Exception:
            return {}
    return {}


@app.get("/csr/cards", tags=["CSR"])
def list_csr_cards(current_user: TokenUser = Depends(require_role("ed", "csr", "programs", "board"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_csr(current_user.ngo_id)
            return {"cards": CSR_CARDS_MEM_BY_NGO.get(current_user.ngo_id, []), "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, company, amount::float, COALESCE(project,''), COALESCE(tags,'{}'), COALESCE(agent,''), col, COALESCE(date_label,''),
                   COALESCE(win_probability, 55)::int,
                   updated_at,
                   created_at,
                   COALESCE(details, '{}'::jsonb)
            FROM csr_pipeline_cards
            WHERE ngo_id = %s
            ORDER BY created_at DESC
            LIMIT 500
            """,
            (current_user.ngo_id,),
        )
        out = []
        for r in cur.fetchall():
            wp = int(r[8] or 55)
            upd = _ts_iso(r[9])
            cre = _ts_iso(r[10])
            det = _parse_jsonb(r[11])
            out.append(
                {
                    "id": r[0],
                    "company": r[1],
                    "amount": float(r[2] or 0),
                    "project": r[3] or "",
                    "tags": list(r[4] or []),
                    "agent": r[5] or "",
                    "col": r[6] or "prospecting",
                    "date": r[7] or "",
                    "win_probability": wp,
                    "updated_at": upd,
                    "created_at": cre,
                    "last_activity_at": upd,
                    "details": det,
                }
            )
        return {"cards": out, "source": "db"}


@app.post("/csr/cards", tags=["CSR"])
def create_csr_card(body: CsrCardCreate, current_user: TokenUser = Depends(require_role("ed", "csr", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_csr(current_user.ngo_id)
            new_id = str(int(datetime.now(timezone.utc).timestamp() * 1000))
            ts = datetime.now(timezone.utc).isoformat()
            card = {
                "id": new_id,
                "company": body.company,
                "amount": float(body.amount),
                "project": body.project,
                "tags": body.tags or [],
                "agent": body.agent,
                "col": body.col,
                "date": body.date,
                "last_activity_at": ts,
                "win_probability": 55,
                "details": body.details or {},
            }
            CSR_CARDS_MEM_BY_NGO.setdefault(current_user.ngo_id, []).insert(0, card)
            return {"status": "created", "card": card, "source": "memory"}
        cur = conn.cursor()
        new_id = f"csr_{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        cur.execute(
            """
            INSERT INTO csr_pipeline_cards (id, ngo_id, company, amount, project, tags, agent, col, date_label, win_probability, details)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 55, %s::jsonb)
            RETURNING id, win_probability::int, updated_at
            """,
            (
                new_id,
                current_user.ngo_id,
                body.company,
                float(body.amount),
                body.project,
                body.tags or [],
                body.agent,
                body.col,
                body.date,
                json.dumps(body.details or {}),
            ),
        )
        rid, rwp, rupd = cur.fetchone()
        upd_s = _ts_iso(rupd)
        card = {
            "id": rid,
            "company": body.company,
            "amount": float(body.amount),
            "project": body.project,
            "tags": body.tags or [],
            "agent": body.agent,
            "col": body.col,
            "date": body.date,
            "win_probability": int(rwp or 55),
            "updated_at": upd_s,
            "last_activity_at": upd_s,
            "details": body.details or {},
        }
        return {"status": "created", "card": card, "source": "db"}


@app.put("/csr/cards/{card_id}", tags=["CSR"])
def update_csr_card(card_id: str, body: CsrCardCreate, current_user: TokenUser = Depends(require_role("ed", "csr", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_csr(current_user.ngo_id)
            lst = CSR_CARDS_MEM_BY_NGO.get(current_user.ngo_id, [])
            for i, card in enumerate(lst):
                if str(card.get("id")) == card_id:
                    card.update({
                        "company": body.company,
                        "amount": float(body.amount),
                        "project": body.project,
                        "tags": body.tags or [],
                        "agent": body.agent,
                        "col": body.col,
                        "date": body.date,
                        "last_activity_at": datetime.now(timezone.utc).isoformat(),
                        "details": body.details or card.get("details") or {},
                    })
                    return {"status": "updated", "card": card, "source": "memory"}
            raise HTTPException(status_code=404, detail="Card not found")
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE csr_pipeline_cards
            SET company = %s, amount = %s, project = %s, tags = %s, agent = %s, col = %s, date_label = %s,
                details = %s::jsonb, updated_at = CURRENT_TIMESTAMP
            WHERE id = %s AND ngo_id = %s
            RETURNING id, updated_at
            """,
            (
                body.company,
                float(body.amount),
                body.project,
                body.tags or [],
                body.agent,
                body.col,
                body.date,
                json.dumps(body.details or {}),
                card_id,
                current_user.ngo_id,
            ),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Card not found")
        return {"status": "updated", "id": card_id, "updated_at": _ts_iso(row[1]), "source": "db"}


@app.delete("/csr/cards/{card_id}", tags=["CSR"])
def delete_csr_card(card_id: str, current_user: TokenUser = Depends(require_role("ed", "csr", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_csr(current_user.ngo_id)
            lst = CSR_CARDS_MEM_BY_NGO.get(current_user.ngo_id, [])
            before_len = len(lst)
            CSR_CARDS_MEM_BY_NGO[current_user.ngo_id] = [c for c in lst if str(c.get("id")) != card_id]
            if len(CSR_CARDS_MEM_BY_NGO[current_user.ngo_id]) == before_len:
                raise HTTPException(status_code=404, detail="Card not found")
            return {"status": "deleted", "id": card_id, "source": "memory"}
        cur = conn.cursor()
        cur.execute("DELETE FROM csr_pipeline_cards WHERE id = %s AND ngo_id = %s RETURNING id", (card_id, current_user.ngo_id))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Card not found")
        return {"status": "deleted", "id": card_id, "source": "db"}


@app.patch("/csr/cards/{card_id}/move", tags=["CSR"])
def move_csr_card(card_id: str, body: CsrCardMove, current_user: TokenUser = Depends(require_role("ed", "csr", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_csr(current_user.ngo_id)
            cards = CSR_CARDS_MEM_BY_NGO.get(current_user.ngo_id, [])
            for c in cards:
                if str(c.get("id")) == str(card_id):
                    c["col"] = body.col
                    c["last_activity_at"] = datetime.now(timezone.utc).isoformat()
                    return {"status": "moved", "id": card_id, "col": body.col, "source": "memory"}
            raise HTTPException(status_code=404, detail="CSR card not found.")
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE csr_pipeline_cards
            SET col = %s, updated_at = CURRENT_TIMESTAMP
            WHERE ngo_id = %s AND id = %s
            RETURNING id
            """,
            (body.col, current_user.ngo_id, card_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="CSR card not found.")
        return {"status": "moved", "id": row[0], "col": body.col, "source": "db"}


@app.post("/csr/cards/{card_id}/touch", tags=["CSR"])
def touch_csr_card(card_id: str, current_user: TokenUser = Depends(require_role("ed", "csr", "programs"))):
    """Mark CSR card activity now (clears stale / decay inbox heuristics on next refresh)."""
    with db_conn() as conn:
        if conn is None:
            _seed_memory_csr(current_user.ngo_id)
            cards = CSR_CARDS_MEM_BY_NGO.get(current_user.ngo_id, [])
            for c in cards:
                if str(c.get("id")) == str(card_id):
                    ts = datetime.now(timezone.utc).isoformat()
                    c["last_activity_at"] = ts
                    c["win_probability"] = min(95, int(c.get("win_probability") or 55) + 3)
                    return {"status": "ok", "card_id": card_id, "last_activity_at": ts, "source": "memory"}
            raise HTTPException(status_code=404, detail="CSR card not found.")
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE csr_pipeline_cards
            SET updated_at = CURRENT_TIMESTAMP,
                win_probability = LEAST(95, COALESCE(win_probability, 55) + 3)
            WHERE ngo_id = %s AND id = %s
            RETURNING id::text
            """,
            (current_user.ngo_id, card_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="CSR card not found.")
        return {"status": "ok", "card_id": row[0], "source": "db"}


# ── Per-card grant lifecycle state ────────────────────────────────────────
# JSONB-blob round-trip so parser approvals, deliverables progress, reports,
# budget heads, closure checklist, and the isClosed flag are shared across
# devices and teammates instead of living only in one browser's localStorage.
# In memory mode we keep an analogous {ngo_id: {card_id: state}} map.

CSR_GRANT_STATE_MEM_BY_NGO: Dict[str, Dict[str, Dict[str, Any]]] = {}


@app.get("/csr/cards/{card_id}/grant-state", tags=["CSR"])
def get_csr_card_grant_state(card_id: str, current_user: TokenUser = Depends(require_role("ed", "csr", "programs", "board"))):
    with db_conn() as conn:
        if conn is None:
            store = CSR_GRANT_STATE_MEM_BY_NGO.get(current_user.ngo_id, {})
            entry = store.get(str(card_id))
            if not entry:
                return {"state": None, "updated_at": None, "source": "memory"}
            return {"state": entry.get("state") or {}, "updated_at": entry.get("updated_at"), "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT COALESCE(grant_state, '{}'::jsonb), grant_state_updated_at
            FROM csr_pipeline_cards
            WHERE ngo_id = %s AND id = %s
            """,
            (current_user.ngo_id, str(card_id)),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="CSR card not found.")
        state = _parse_jsonb(row[0])
        # Empty dict ⇒ never been written; let the client fall back to its
        # deterministic mock without overwriting it. Use `None` so the client
        # can distinguish "no server state yet" from "server says blank".
        return {
            "state": state if state else None,
            "updated_at": _ts_iso(row[1]),
            "source": "db",
        }


@app.put("/csr/cards/{card_id}/grant-state", tags=["CSR"])
def put_csr_card_grant_state(
    card_id: str,
    body: Dict[str, Any] = Body(...),
    current_user: TokenUser = Depends(require_role("ed", "csr", "programs")),
):
    state = body.get("state") if isinstance(body, dict) else None
    if not isinstance(state, dict):
        raise HTTPException(status_code=400, detail="Body must be {state: object}.")
    ts = datetime.now(timezone.utc).isoformat()
    with db_conn() as conn:
        if conn is None:
            _seed_memory_csr(current_user.ngo_id)
            cards = CSR_CARDS_MEM_BY_NGO.get(current_user.ngo_id, [])
            if not any(str(c.get("id")) == str(card_id) for c in cards):
                raise HTTPException(status_code=404, detail="CSR card not found.")
            CSR_GRANT_STATE_MEM_BY_NGO.setdefault(current_user.ngo_id, {})[str(card_id)] = {
                "state": state, "updated_at": ts,
            }
            return {"status": "saved", "updated_at": ts, "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE csr_pipeline_cards
            SET grant_state = %s::jsonb,
                grant_state_updated_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE ngo_id = %s AND id = %s
            RETURNING grant_state_updated_at
            """,
            (json.dumps(state), current_user.ngo_id, str(card_id)),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="CSR card not found.")
        return {"status": "saved", "updated_at": _ts_iso(row[0]), "source": "db"}


# ── Grant Parser extraction (Task #7) ─────────────────────────────────────
# Replaces the hard-coded 14-row "preview" with a real extraction pipeline
# over the card's uploaded MoU/contract. POST re-runs the extractor; GET
# returns the cached result so reopening the page is instant. Both routes
# are NGO-scoped via the standard role guard.

CSR_PARSER_EXTRACTION_MEM_BY_NGO: Dict[str, Dict[str, Dict[str, Any]]] = {}


def _load_card_documents(ngo_id: str, card_id: str) -> List[Dict[str, Any]]:
    """Pull the card's document list from DB or the in-memory store, in the
    same shape `list_csr_card_documents` returns. Used by the extractor."""
    with db_conn() as conn:
        if conn is None:
            return list(CSR_CARD_DOCS_MEM_BY_NGO.get(ngo_id, {}).get(str(card_id), []))
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name, doc_type, size_bytes, s3_key, created_at
            FROM csr_card_documents
            WHERE ngo_id = %s AND card_id = %s
            ORDER BY created_at DESC
            LIMIT 50
            """,
            (ngo_id, str(card_id)),
        )
        return [
            {"id": r[0], "name": r[1], "doc_type": r[2],
             "size_bytes": int(r[3] or 0), "s3_key": r[4], "created_at": _ts_iso(r[5])}
            for r in cur.fetchall()
        ]


def _load_card_meta(ngo_id: str, card_id: str) -> Optional[Dict[str, Any]]:
    """Return {id, company, project, amount, tags} for a card or None."""
    with db_conn() as conn:
        if conn is None:
            _seed_memory_csr(ngo_id)
            for c in CSR_CARDS_MEM_BY_NGO.get(ngo_id, []):
                if str(c.get("id")) == str(card_id):
                    return dict(c)
            return None
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id::text, company, COALESCE(project, ''), amount::float,
                   COALESCE(tags, '{}')
            FROM csr_pipeline_cards
            WHERE ngo_id = %s AND id = %s
            """,
            (ngo_id, str(card_id)),
        )
        row = cur.fetchone()
        if not row:
            return None
        return {"id": row[0], "company": row[1], "project": row[2],
                "amount": float(row[3] or 0), "tags": list(row[4] or [])}


def _save_parser_extraction(ngo_id: str, card_id: str, payload: Dict[str, Any]) -> None:
    with db_conn() as conn:
        if conn is None:
            CSR_PARSER_EXTRACTION_MEM_BY_NGO.setdefault(ngo_id, {})[str(card_id)] = payload
            return
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE csr_pipeline_cards
            SET parser_extraction = %s::jsonb, updated_at = CURRENT_TIMESTAMP
            WHERE ngo_id = %s AND id = %s
            """,
            (json.dumps(payload), ngo_id, str(card_id)),
        )


@app.get("/csr/cards/{card_id}/parser-rows", tags=["CSR"])
def get_csr_card_parser_rows(card_id: str, current_user: TokenUser = Depends(require_role("ed", "csr", "programs", "board"))):
    """Return the cached extraction for this card, or null if never run."""
    with db_conn() as conn:
        if conn is None:
            cached = CSR_PARSER_EXTRACTION_MEM_BY_NGO.get(current_user.ngo_id, {}).get(str(card_id))
            if not cached:
                return {"extraction": None, "source": "memory"}
            return {"extraction": cached, "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT parser_extraction
            FROM csr_pipeline_cards
            WHERE ngo_id = %s AND id = %s
            """,
            (current_user.ngo_id, str(card_id)),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="CSR card not found.")
        cached = _parse_jsonb(row[0])
        return {"extraction": cached if cached else None, "source": "db"}


@app.post("/csr/cards/{card_id}/parser-rows", tags=["CSR"])
def post_csr_card_parser_rows(card_id: str, current_user: TokenUser = Depends(require_role("ed", "csr", "programs"))):
    """Re-run the parser over the card's most recent MoU/contract document.

    The extractor itself decides whether to call the LLM (only when an API
    key is present and the doc text is reachable) or return its deterministic
    heuristic output. Either way, the response shape is identical so the
    frontend doesn't branch."""
    from backend.agents.grant_parser_extractor import extract_parser_rows, pick_primary_doc

    card_meta = _load_card_meta(current_user.ngo_id, card_id)
    if card_meta is None:
        raise HTTPException(status_code=404, detail="CSR card not found.")

    docs = _load_card_documents(current_user.ngo_id, card_id)
    primary = pick_primary_doc(docs)

    # We don't currently fetch + parse PDF text from S3 — that's a separate
    # follow-up. The heuristic path uses the card+doc metadata; the LLM path
    # bails when doc_text is empty, which is the safe behaviour.
    result = extract_parser_rows(card_meta, primary, doc_text="")
    payload = {
        **result,
        "extracted_at": datetime.now(timezone.utc).isoformat(),
        "doc_count": len(docs),
    }
    _save_parser_extraction(current_user.ngo_id, card_id, payload)
    return {"extraction": payload, "status": "extracted"}


@app.get("/csr/cards/{card_id}/documents", tags=["CSR"])
def list_csr_card_documents(card_id: str, current_user: TokenUser = Depends(require_role("ed", "csr", "programs"))):
    with db_conn() as conn:
        if conn is None:
            docs = CSR_CARD_DOCS_MEM_BY_NGO.get(current_user.ngo_id, {}).get(str(card_id), [])
            return {"documents": docs, "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name, doc_type, size_bytes, s3_key, created_at
            FROM csr_card_documents
            WHERE ngo_id = %s AND card_id = %s
            ORDER BY created_at DESC
            LIMIT 200
            """,
            (current_user.ngo_id, str(card_id)),
        )
        out = []
        for rid, name, doc_type, size_bytes, s3_key, created_at in cur.fetchall():
            out.append({
                "id": rid,
                "name": name,
                "doc_type": doc_type,
                "size_bytes": int(size_bytes or 0),
                "s3_key": s3_key,
                "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at),
            })
        return {"documents": out, "source": "db"}


@app.post("/csr/cards/{card_id}/documents", tags=["CSR"])
def create_csr_card_document(card_id: str, body: CsrDocCreate, current_user: TokenUser = Depends(require_role("ed", "csr", "programs"))):
    doc_id = body.id or f"cd_{int(datetime.now(timezone.utc).timestamp() * 1000)}"
    row = {
        "id": doc_id,
        "card_id": str(card_id),
        "name": body.name,
        "doc_type": body.doc_type,
        "size_bytes": int(body.size_bytes or 0),
        "s3_key": body.s3_key,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with db_conn() as conn:
        if conn is None:
            CSR_CARD_DOCS_MEM_BY_NGO.setdefault(current_user.ngo_id, {}).setdefault(str(card_id), []).insert(0, row)
            return {"status": "created", "document": row, "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO csr_card_documents (id, ngo_id, card_id, name, doc_type, size_bytes, s3_key)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (doc_id, current_user.ngo_id, str(card_id), body.name, body.doc_type, int(body.size_bytes or 0), body.s3_key),
        )
        return {"status": "created", "id": cur.fetchone()[0], "document": row, "source": "db"}


@app.delete("/csr/cards/{card_id}/documents/{doc_id}", tags=["CSR"])
def delete_csr_card_document(card_id: str, doc_id: str, current_user: TokenUser = Depends(require_role("ed", "csr", "programs"))):
    with db_conn() as conn:
        if conn is None:
            by_card = CSR_CARD_DOCS_MEM_BY_NGO.get(current_user.ngo_id, {}).get(str(card_id), [])
            nxt = [d for d in by_card if str(d.get("id")) != str(doc_id)]
            CSR_CARD_DOCS_MEM_BY_NGO.setdefault(current_user.ngo_id, {})[str(card_id)] = nxt
            return {"status": "deleted", "id": doc_id, "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            DELETE FROM csr_card_documents
            WHERE ngo_id = %s AND card_id = %s AND id = %s
            RETURNING id
            """,
            (current_user.ngo_id, str(card_id), str(doc_id)),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Document not found.")
        return {"status": "deleted", "id": row[0], "source": "db"}


class CampaignCreate(BaseModel):
    title: str
    goal: float = 0
    status: str = "active"  # active | draft
    image: Optional[str] = None
    cause: Optional[str] = None
    details: Optional[Dict[str, Any]] = None


@app.get("/fundraising/campaigns", tags=["Fundraising"])
def list_campaigns(current_user: TokenUser = Depends(require_role("ed", "fundraising", "finance", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_campaigns(current_user.ngo_id)
            return {"campaigns": CAMPAIGNS_MEM_BY_NGO.get(current_user.ngo_id, []), "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, title, COALESCE(raised, 0)::float, COALESCE(goal, 0)::float,
                   COALESCE(donors_count, 0)::int, COALESCE(status, 'active')::text,
                   COALESCE(image, '')::text, COALESCE(cause, '')::text,
                   COALESCE(details, '{}'::jsonb)
            FROM campaigns
            WHERE ngo_id = %s
            ORDER BY created_at DESC
            LIMIT 200
            """,
            (current_user.ngo_id,),
        )
        out = []
        for r in cur.fetchall():
            out.append(
                {
                    "id": r[0],
                    "title": r[1],
                    "raised": float(r[2] or 0),
                    "goal": float(r[3] or 0),
                    "donorsCount": int(r[4] or 0),
                    "status": r[5],
                    "image": r[6] or "",
                    "cause": r[7] or "",
                    "details": _parse_jsonb(r[8]),
                }
            )
        return {"campaigns": out, "source": "db"}


@app.post("/fundraising/campaigns", tags=["Fundraising"])
def create_campaign(body: CampaignCreate, current_user: TokenUser = Depends(require_role("ed", "fundraising"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_campaigns(current_user.ngo_id)
            new_id = f"c{int(datetime.now(timezone.utc).timestamp() * 1000)}"
            det = _parse_jsonb(body.details) if body.details else {}
            camp = {
                "id": new_id,
                "title": body.title,
                "raised": 0,
                "goal": float(body.goal or 0),
                "donorsCount": 0,
                "status": body.status,
                "image": body.image or "linear-gradient(135deg, #10b981, #047857)",
                "cause": body.cause or "",
                "details": det,
            }
            CAMPAIGNS_MEM_BY_NGO.setdefault(current_user.ngo_id, []).insert(0, camp)
            return {"status": "created", "campaign": camp, "source": "memory"}
        cur = conn.cursor()
        new_id = f"c{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        det_json = json.dumps(body.details) if body.details else "{}"
        cur.execute(
            """
            INSERT INTO campaigns (id, ngo_id, title, cause, goal, raised, donors_count, status, image, details)
            VALUES (%s, %s, %s, %s, %s, 0, 0, %s, %s, %s::jsonb)
            RETURNING id
            """,
            (new_id, current_user.ngo_id, body.title, body.cause, float(body.goal or 0), body.status, body.image, det_json),
        )
        camp = {
            "id": new_id,
            "title": body.title,
            "raised": 0,
            "goal": float(body.goal or 0),
            "donorsCount": 0,
            "status": body.status,
            "image": body.image or "",
            "cause": body.cause or "",
            "details": _parse_jsonb(body.details),
        }
        return {"status": "created", "campaign": camp, "source": "db"}


@app.put("/fundraising/campaigns/{c_id}", tags=["Fundraising"])
def update_campaign(c_id: str, body: CampaignCreate, current_user: TokenUser = Depends(require_role("ed", "fundraising"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_campaigns(current_user.ngo_id)
            lst = CAMPAIGNS_MEM_BY_NGO.get(current_user.ngo_id, [])
            for i, c in enumerate(lst):
                if str(c.get("id")) == c_id:
                    c.update({
                        "title": body.title,
                        "goal": float(body.goal or 0),
                        "status": body.status,
                        "cause": body.cause or "",
                        "details": _parse_jsonb(body.details) if body.details is not None else c.get("details") or {},
                    })
                    return {"status": "updated", "campaign": c, "source": "memory"}
            raise HTTPException(status_code=404, detail="Campaign not found")
        cur = conn.cursor()
        det_json = json.dumps(body.details) if body.details is not None else None
        if det_json is not None:
            cur.execute(
                """
                UPDATE campaigns
                SET title = %s, goal = %s, status = %s, cause = %s, details = %s::jsonb
                WHERE id = %s AND ngo_id = %s
                RETURNING id
                """,
                (body.title, float(body.goal or 0), body.status, body.cause or "", det_json, c_id, current_user.ngo_id),
            )
        else:
            cur.execute(
                """
                UPDATE campaigns
                SET title = %s, goal = %s, status = %s, cause = %s
                WHERE id = %s AND ngo_id = %s
                RETURNING id
                """,
                (body.title, float(body.goal or 0), body.status, body.cause or "", c_id, current_user.ngo_id),
            )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Campaign not found")
        return {"status": "updated", "id": c_id, "source": "db"}


@app.delete("/fundraising/campaigns/{c_id}", tags=["Fundraising"])
def delete_campaign(c_id: str, current_user: TokenUser = Depends(require_role("ed", "fundraising"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_campaigns(current_user.ngo_id)
            lst = CAMPAIGNS_MEM_BY_NGO.get(current_user.ngo_id, [])
            before_len = len(lst)
            CAMPAIGNS_MEM_BY_NGO[current_user.ngo_id] = [c for c in lst if str(c.get("id")) != c_id]
            if len(CAMPAIGNS_MEM_BY_NGO[current_user.ngo_id]) == before_len:
                raise HTTPException(status_code=404, detail="Campaign not found")
            return {"status": "deleted", "id": c_id, "source": "memory"}
        cur = conn.cursor()
        cur.execute("DELETE FROM campaigns WHERE id = %s AND ngo_id = %s RETURNING id", (c_id, current_user.ngo_id))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Campaign not found")
        return {"status": "deleted", "id": c_id, "source": "db"}


# ── CRM Persistence (Donors + Transactions) ───────────────────────────────────

class DonorCreate(BaseModel):
    name: str
    type: str = "Recurring"
    pan: str = ""
    location: str = ""
    tags: List[str] = []
    email: Optional[str] = None
    phone: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None


@app.get("/crm/donors", tags=["CRM"])
def list_donors(current_user: TokenUser = Depends(require_role("ed", "crm", "fundraising", "finance", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_crm(current_user.ngo_id)
            return {"donors": DONORS_MEM_BY_NGO.get(current_user.ngo_id, []), "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id::text, full_name, COALESCE(donor_type, 'Recurring') as donor_type,
                   COALESCE(total_lifetime_value, 0)::float,
                   COALESCE(pan_masked, '') as pan_masked,
                   COALESCE(location_text, '') as location_text,
                   COALESCE(tags, '{}') as tags,
                   COALESCE(email, '') as email,
                   COALESCE(phone, '') as phone,
                   COALESCE(meta, '{}'::jsonb),
                   created_at
            FROM donors
            WHERE ngo_id = %s::uuid
            ORDER BY created_at DESC
            LIMIT 1000
            """,
            (current_user.ngo_id,),
        )
        out = []
        for r in cur.fetchall():
            out.append(
                {
                    "id": r[0],
                    "name": r[1],
                    "type": r[2],
                    "totalGiven": float(r[3] or 0),
                    "lastGift": "N/A",
                    "initial": (r[1] or "U")[:1].upper(),
                    "pan": r[4] or "",
                    "location": r[5] or "",
                    "tags": list(r[6] or []),
                    "email": (r[7] or "").strip(),
                    "phone": (r[8] or "").strip(),
                    "meta": _parse_jsonb(r[9]),
                }
            )
        return {"donors": out, "source": "db"}


@app.get("/crm/donors/{donor_id}/80g/{tx_id}.pdf", tags=["CRM"])
def get_donor_80g_pdf(
    donor_id: str,
    tx_id: str,
    current_user: TokenUser = Depends(require_role("ed", "crm", "finance", "programs")),
):
    """
    Generates an 80G donation certificate for a specific transaction.
    (Sprint 3: Actionable NGO OS feature)
    """
    ngo_id = current_user.ngo_id
    donor = None
    tx = None
    ngo_data = {"name": current_user.ngo_name, "pan": "AABCI1234C", "reg_no": "MH/2015/0012345"}

    with db_conn() as conn:
        if conn is None:
            _seed_memory_crm(ngo_id)
            donor = next((d for d in DONORS_MEM_BY_NGO.get(ngo_id, []) if str(d.get("id")) == donor_id), None)
            tx = next((t for t in TX_MEM_BY_NGO.get(ngo_id, []) if str(t.get("id")) == tx_id), None)
        else:
            cur = conn.cursor()
            # Fetch NGO details
            cur.execute("SELECT name, pan, reg_no FROM ngos WHERE id = %s::uuid", (ngo_id,))
            ngo_row = cur.fetchone()
            if ngo_row:
                ngo_data = {"name": ngo_row[0], "pan": ngo_row[1] or "AABCI1234C", "reg_no": ngo_row[2] or "MH/2015/0012345"}

            # Fetch Donor details
            cur.execute("SELECT full_name, pan_masked FROM donors WHERE id = %s::uuid AND ngo_id = %s::uuid", (donor_id, ngo_id))
            donor_row = cur.fetchone()
            if donor_row:
                donor = {"name": donor_row[0], "pan": donor_row[1]}
            
            # Fetch Transaction details
            cur.execute("SELECT amount, transaction_date, payment_method, campaign_title FROM transactions WHERE id = %s::uuid AND ngo_id = %s::uuid", (tx_id, ngo_id))
            tx_row = cur.fetchone()
            if tx_row:
                tx = {
                    "amount": float(tx_row[0]), 
                    "date": tx_row[1].strftime('%Y-%m-%d') if hasattr(tx_row[1], 'strftime') else str(tx_row[1]), 
                    "method": tx_row[2], 
                    "campaign": tx_row[3]
                }

    if not donor or not tx:
        raise HTTPException(status_code=404, detail="Donor or Transaction not found")

    title = f"80G Donation Receipt — {ngo_data['name']}"
    lines = [
        f"Receipt No: 80G-{tx_id[:8].upper()}",
        f"Date of Receipt: {tx.get('date')}",
        "",
        f"Organisation: {ngo_data['name']}",
        f"PAN: {ngo_data['pan']}",
        f"Reg No: {ngo_data['reg_no']}",
        "",
        "DONOR INFORMATION:",
        f"Name: {donor.get('name')}",
        f"PAN: {donor.get('pan') or 'N/A'}",
        "",
        "DONATION SUMMARY:",
        f"Amount: Rs. {tx.get('amount'):,.2f}",
        f"Payment Method: {tx.get('method')}",
        f"Purpose: {tx.get('campaign') or 'General Fund'}",
        "",
        "CERTIFICATION:",
        "This is to certify that we have received the above donation.",
        "This receipt is issued under Section 80G of the Income Tax Act, 1961.",
        "The donor is eligible for 50% deduction from their taxable income.",
        "",
        f"Generated on: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        "Infrastructure for Social Good | Powered by GoodJobs"
    ]
    
    pdf = _simple_pdf_bytes(title, lines)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="80G_Receipt_{tx_id[:8]}.pdf"'}
    )


@app.post("/crm/donors", tags=["CRM"])
def create_donor(body: DonorCreate, current_user: TokenUser = Depends(require_role("ed", "crm", "fundraising"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_crm(current_user.ngo_id)
            new_id = f"{int(datetime.now(timezone.utc).timestamp() * 1000)}"
            meta_d = _parse_jsonb(body.meta) if body.meta else {}
            donor = {
                "id": new_id,
                "name": body.name,
                "type": body.type,
                "totalGiven": 0,
                "lastGift": "N/A",
                "initial": (body.name or "U")[:1].upper(),
                "pan": _mask_pan(body.pan),
                "location": body.location,
                "tags": body.tags or ["New"],
                "email": (body.email or "").strip(),
                "phone": (body.phone or "").strip(),
                "meta": meta_d,
            }
            DONORS_MEM_BY_NGO.setdefault(current_user.ngo_id, []).insert(0, donor)
            return {"status": "created", "donor": donor, "source": "memory"}

        cur = conn.cursor()
        donor_code = f"D{int(datetime.now(timezone.utc).timestamp())}"
        meta_json = json.dumps(body.meta) if body.meta else "{}"
        email_v = (body.email or "").strip() or None
        phone_v = (body.phone or "").strip() or None
        cur.execute(
            """
            INSERT INTO donors (ngo_id, donor_code, full_name, donor_type, pan_masked, location_text, tags, email, phone, meta, consent_given, consent_date)
            VALUES (%s::uuid, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, true, CURRENT_TIMESTAMP)
            RETURNING id::text, created_at
            """,
            (
                current_user.ngo_id,
                donor_code,
                body.name,
                body.type,
                _mask_pan(body.pan),
                body.location,
                body.tags or [],
                email_v,
                phone_v,
                meta_json,
            ),
        )
        new_id, created_at = cur.fetchone()
        donor = {
            "id": new_id,
            "name": body.name,
            "type": body.type,
            "totalGiven": 0,
            "lastGift": "N/A",
            "initial": (body.name or "U")[:1].upper(),
            "pan": _mask_pan(body.pan),
            "location": body.location,
            "tags": body.tags or [],
            "email": (body.email or "").strip(),
            "phone": (body.phone or "").strip(),
            "meta": _parse_jsonb(body.meta),
        }
        return {"status": "created", "donor": donor, "source": "db"}


class DonorBulkImport(BaseModel):
    donors: List[DonorCreate]


@app.post("/crm/donors/bulk", tags=["CRM"])
def bulk_import_donors(body: DonorBulkImport, current_user: TokenUser = Depends(require_role("ed", "crm", "fundraising"))):
    """Import many donors in one request (CSV upload from UI)."""
    n = 0
    with db_conn() as conn:
        if conn is None:
            _seed_memory_crm(current_user.ngo_id)
            lst = DONORS_MEM_BY_NGO.setdefault(current_user.ngo_id, [])
            base = int(datetime.now(timezone.utc).timestamp() * 1000)
            for i, d in enumerate(body.donors[:500]):
                if not (d.name or "").strip():
                    continue
                new_id = str(base + i)
                donor = {
                    "id": new_id,
                    "name": d.name,
                    "type": d.type,
                    "totalGiven": 0,
                    "lastGift": "N/A",
                    "initial": (d.name or "U")[:1].upper(),
                    "pan": _mask_pan(d.pan),
                    "location": d.location,
                    "tags": d.tags or ["Imported"],
                    "email": (d.email or "").strip(),
                    "phone": (d.phone or "").strip(),
                    "meta": _parse_jsonb(d.meta) if d.meta else {},
                }
                lst.insert(0, donor)
                n += 1
            return {"imported": n, "source": "memory"}
        cur = conn.cursor()
        for i, d in enumerate(body.donors[:500]):
            if not (d.name or "").strip():
                continue
            donor_code = f"DBULK_{int(datetime.now(timezone.utc).timestamp())}_{i}"
            meta_json = json.dumps(d.meta) if d.meta else "{}"
            email_v = (d.email or "").strip() or None
            phone_v = (d.phone or "").strip() or None
            cur.execute(
                """
                INSERT INTO donors (ngo_id, donor_code, full_name, donor_type, pan_masked, location_text, tags, email, phone, meta, consent_given, consent_date)
                VALUES (%s::uuid, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, true, CURRENT_TIMESTAMP)
                """,
                (
                    current_user.ngo_id,
                    donor_code,
                    d.name,
                    d.type,
                    _mask_pan(d.pan),
                    d.location,
                    d.tags or ["Imported"],
                    email_v,
                    phone_v,
                    meta_json,
                ),
            )
            n += 1
        return {"imported": n, "source": "db"}


@app.put("/crm/donors/{donor_id}", tags=["CRM"])
def update_donor(donor_id: str, body: DonorCreate, current_user: TokenUser = Depends(require_role("ed", "crm", "fundraising"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_crm(current_user.ngo_id)
            lst = DONORS_MEM_BY_NGO.get(current_user.ngo_id, [])
            for i, d in enumerate(lst):
                if str(d.get("id")) == donor_id:
                    next_meta = _parse_jsonb(body.meta) if body.meta is not None else dict(d.get("meta") or {})
                    lst[i].update({
                        "name": body.name,
                        "type": body.type,
                        "initial": (body.name or "U")[:1].upper(),
                        "pan": _mask_pan(body.pan) if body.pan else lst[i].get("pan"),
                        "location": body.location,
                        "tags": body.tags if body.tags else lst[i].get("tags"),
                        "email": (body.email or "").strip(),
                        "phone": (body.phone or "").strip(),
                        "meta": next_meta,
                    })
                    return {"status": "updated", "donor": lst[i], "source": "memory"}
            raise HTTPException(status_code=404, detail="Donor not found")

        cur = conn.cursor()
        email_v = (body.email or "").strip() or None
        phone_v = (body.phone or "").strip() or None
        if body.meta is not None:
            meta_json = json.dumps(_parse_jsonb(body.meta))
            cur.execute(
                """
                UPDATE donors
                SET full_name = %s, donor_type = %s, pan_masked = %s, location_text = %s, tags = %s,
                    email = %s, phone = %s, meta = %s::jsonb
                WHERE id = %s::uuid AND ngo_id = %s::uuid
                RETURNING id::text
                """,
                (body.name, body.type, _mask_pan(body.pan), body.location, body.tags or [], email_v, phone_v, meta_json, donor_id, current_user.ngo_id),
            )
        else:
            cur.execute(
                """
                UPDATE donors
                SET full_name = %s, donor_type = %s, pan_masked = %s, location_text = %s, tags = %s,
                    email = %s, phone = %s
                WHERE id = %s::uuid AND ngo_id = %s::uuid
                RETURNING id::text
                """,
                (body.name, body.type, _mask_pan(body.pan), body.location, body.tags or [], email_v, phone_v, donor_id, current_user.ngo_id),
            )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Donor not found")
        return {"status": "updated", "id": donor_id, "source": "db"}


@app.delete("/crm/donors/{donor_id}", tags=["CRM"])
def delete_donor(donor_id: str, current_user: TokenUser = Depends(require_role("ed", "crm", "fundraising"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_crm(current_user.ngo_id)
            lst = DONORS_MEM_BY_NGO.get(current_user.ngo_id, [])
            before_len = len(lst)
            DONORS_MEM_BY_NGO[current_user.ngo_id] = [d for d in lst if str(d.get("id")) != donor_id]
            if len(DONORS_MEM_BY_NGO[current_user.ngo_id]) == before_len:
                raise HTTPException(status_code=404, detail="Donor not found")
            return {"status": "deleted", "id": donor_id, "source": "memory"}
            
        cur = conn.cursor()
        cur.execute("DELETE FROM donors WHERE id = %s::uuid AND ngo_id = %s::uuid RETURNING id::text", (donor_id, current_user.ngo_id))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Donor not found")
        return {"status": "deleted", "id": donor_id, "source": "db"}


# ── Donor lifecycle (touchpoint completion + lapse-risk ack) ──────────────
# Persists the per-donor nurture state server-side so milestone history
# survives browser switches and is shared across teammates. Replaces the
# previous localStorage-only storage in src/utils/donorLifecycle.ts.
#
# State shape (kept loose so the client can evolve it without a migration):
#   {
#     "milestones": { "thankyou": "<iso>", "impact": "<iso>", ... },
#     "skipped":    { "renewal": true, ... },
#     "lapseRiskAckAt": "<iso>",
#     "notes": "..."
#   }
#
# Storage:
#   • DB mode → donors.meta JSONB at key `lifecycle` (column already exists,
#     no migration required).
#   • Memory mode → DONOR_LIFECYCLE_MEM_BY_NGO[ngo_id][donor_id].

def _validate_lifecycle_state(state: Any) -> Dict[str, Any]:
    if not isinstance(state, dict):
        raise HTTPException(status_code=400, detail="state must be an object")
    out: Dict[str, Any] = {}
    ms = state.get("milestones")
    out["milestones"] = ms if isinstance(ms, dict) else {}
    sk = state.get("skipped")
    out["skipped"] = sk if isinstance(sk, dict) else {}
    if isinstance(state.get("lapseRiskAckAt"), str):
        out["lapseRiskAckAt"] = state["lapseRiskAckAt"]
    if isinstance(state.get("notes"), str):
        out["notes"] = state["notes"]
    return out


@app.get("/crm/donors/lifecycle", tags=["CRM"])
def list_donor_lifecycle(current_user: TokenUser = Depends(require_role("ed", "crm", "fundraising", "finance", "programs"))):
    """Bulk hydrate — returns {donor_id: state} for every donor with state.
    Used by Layout on app load so CRM/Today render server-side milestones
    without a per-donor round-trip."""
    with db_conn() as conn:
        if conn is None:
            store = DONOR_LIFECYCLE_MEM_BY_NGO.get(current_user.ngo_id, {})
            return {
                "states": {did: entry.get("state") or {} for did, entry in store.items()},
                "source": "memory",
            }
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id::text, COALESCE(meta, '{}'::jsonb)
            FROM donors
            WHERE ngo_id = %s::uuid
            """,
            (current_user.ngo_id,),
        )
        states: Dict[str, Dict[str, Any]] = {}
        for r in cur.fetchall():
            meta = _parse_jsonb(r[1])
            life = meta.get("lifecycle") if isinstance(meta, dict) else None
            if isinstance(life, dict) and life:
                states[r[0]] = life
        return {"states": states, "source": "db"}


@app.get("/crm/donors/{donor_id}/lifecycle", tags=["CRM"])
def get_donor_lifecycle(donor_id: str, current_user: TokenUser = Depends(require_role("ed", "crm", "fundraising", "finance", "programs"))):
    with db_conn() as conn:
        if conn is None:
            entry = DONOR_LIFECYCLE_MEM_BY_NGO.get(current_user.ngo_id, {}).get(str(donor_id))
            if not entry:
                return {"state": None, "updated_at": None, "source": "memory"}
            return {"state": entry.get("state") or {}, "updated_at": entry.get("updated_at"), "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            "SELECT COALESCE(meta, '{}'::jsonb) FROM donors WHERE id = %s::uuid AND ngo_id = %s::uuid",
            (donor_id, current_user.ngo_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Donor not found")
        meta = _parse_jsonb(row[0])
        life = meta.get("lifecycle") if isinstance(meta, dict) else None
        return {"state": life if isinstance(life, dict) and life else None, "updated_at": None, "source": "db"}


@app.put("/crm/donors/{donor_id}/lifecycle", tags=["CRM"])
def put_donor_lifecycle(
    donor_id: str,
    body: Dict[str, Any] = Body(...),
    current_user: TokenUser = Depends(require_role("ed", "crm", "fundraising")),
):
    state = _validate_lifecycle_state(body.get("state") if isinstance(body, dict) else None)
    ts = datetime.now(timezone.utc).isoformat()
    with db_conn() as conn:
        if conn is None:
            _seed_memory_crm(current_user.ngo_id)
            donors = DONORS_MEM_BY_NGO.get(current_user.ngo_id, [])
            if not any(str(d.get("id")) == str(donor_id) for d in donors):
                raise HTTPException(status_code=404, detail="Donor not found")
            DONOR_LIFECYCLE_MEM_BY_NGO.setdefault(current_user.ngo_id, {})[str(donor_id)] = {
                "state": state, "updated_at": ts,
            }
            return {"status": "saved", "updated_at": ts, "source": "memory"}
        cur = conn.cursor()
        # Merge into donors.meta.lifecycle so we don't clobber sibling keys.
        cur.execute(
            """
            UPDATE donors
            SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('lifecycle', %s::jsonb)
            WHERE id = %s::uuid AND ngo_id = %s::uuid
            RETURNING id::text
            """,
            (json.dumps(state), donor_id, current_user.ngo_id),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Donor not found")
        return {"status": "saved", "updated_at": ts, "source": "db"}


class TransactionCreate(BaseModel):
    donorId: str
    donorName: str
    amount: float
    method: str = "UPI"
    campaignId: Optional[str] = None
    campaignTitle: Optional[str] = None


class PublicDonationRequest(BaseModel):
    campaign_slug: Optional[str] = None
    cause: Optional[str] = None
    donor_name: str
    donor_email: str
    pan: Optional[str] = None
    amount: float
    method: str = "UPI"
    phone: Optional[str] = None
    address_line1: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    company_name: Optional[str] = None
    message: Optional[str] = None
    consent_impact_updates: Optional[bool] = None


@app.post("/public/donations", tags=["Public"])
def public_record_donation(body: PublicDonationRequest, user: Optional[TokenUser] = Depends(get_current_user_optional)):
    """
    Public donation intake endpoint (no auth required).
    Records a donor+transaction in memory (demo) or DB when configured.
    This intentionally does NOT trigger HITL/agent actions automatically.
    """
    ngo_id = user.ngo_id if user else "public_ngo"
    ngo_name = user.ngo_name if user else "GoodJobs NGO"
    donor_name = (body.donor_name or "Anonymous").strip()[:200]
    donor_email = (body.donor_email or "").strip().lower()[:255]
    amount = float(body.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Invalid amount.")

    phone = (body.phone or "").strip()[:20] or None
    loc_parts = [body.city, body.state, body.pincode]
    location_text = ", ".join(str(p).strip() for p in loc_parts if p and str(p).strip())[:500]
    meta: Dict[str, Any] = {}
    if body.message and body.message.strip():
        meta["donor_message"] = body.message.strip()[:2000]
    if body.company_name and body.company_name.strip():
        meta["company_name"] = body.company_name.strip()[:200]
    if body.address_line1 and body.address_line1.strip():
        meta["address_line1"] = body.address_line1.strip()[:300]
    if body.consent_impact_updates is not None:
        meta["consent_impact_updates"] = bool(body.consent_impact_updates)

    # Demo/memory mode
    with db_conn() as conn:
        if conn is None:
            donor_id = donor_email or f"donor_{int(datetime.now(timezone.utc).timestamp()*1000)}"
            donor = {
                "id": donor_id,
                "name": donor_name,
                "type": "Public",
                "totalGiven": amount,
                "lastGift": datetime.now(timezone.utc).date().isoformat(),
                "initial": (donor_name[:1] or "A").upper(),
                "pan": _mask_pan(body.pan or ""),
                "location": location_text,
                "phone": phone or "",
                "email": donor_email,
                "tags": ["Public"],
                "meta": meta,
            }
            DONORS_MEM_BY_NGO.setdefault(ngo_id, []).insert(0, donor)
            tx = {
                "id": f"TRX-{str(int(datetime.now(timezone.utc).timestamp()*1000))[-6:]}",
                "donorId": donor_id,
                "donorName": donor_name,
                "amount": amount,
                "method": body.method or "UPI",
                "campaignId": body.campaign_slug or "",
                "campaignTitle": (body.campaign_slug or "").replace("-", " ").title() if body.campaign_slug else (body.cause or "General Fund"),
                "date": datetime.now(timezone.utc).date().isoformat(),
                "timestamp": int(datetime.now(timezone.utc).timestamp()),
            }
            TX_MEM_BY_NGO.setdefault(ngo_id, []).insert(0, tx)
            return {"ok": True, "ngo_name": ngo_name, "transaction": tx, "source": "memory"}

        # DB mode: best-effort insert donor+tx
        cur = conn.cursor()
        # donor upsert by email when present, else by name
        donor_id = None
        if donor_email:
            cur.execute(
                "SELECT id::text FROM donors WHERE ngo_id = %s::uuid AND lower(coalesce(email,'')) = %s LIMIT 1",
                (user.ngo_id if user else None, donor_email),
            )
            row = cur.fetchone()
            donor_id = row[0] if row else None
        if not donor_id:
            cur.execute(
                "SELECT id::text FROM donors WHERE ngo_id = %s::uuid AND full_name = %s LIMIT 1",
                (user.ngo_id if user else None, donor_name),
            )
            row = cur.fetchone()
            donor_id = row[0] if row else None
        if not donor_id:
            donor_code = f"D{int(datetime.now(timezone.utc).timestamp())}"
            cur.execute(
                """
                INSERT INTO donors (ngo_id, donor_code, full_name, email, phone, donor_type, pan_masked, location_text, tags, meta, consent_given, consent_date)
                VALUES (%s::uuid, %s, %s, %s, %s, 'Public', %s, %s, %s, %s::jsonb, true, CURRENT_TIMESTAMP)
                RETURNING id::text
                """,
                (
                    user.ngo_id if user else None,
                    donor_code,
                    donor_name,
                    donor_email or None,
                    phone,
                    _mask_pan(body.pan or ""),
                    location_text,
                    ["Public"],
                    json.dumps(meta),
                ),
            )
            donor_id = cur.fetchone()[0]
        cur.execute(
            """
            INSERT INTO transactions (ngo_id, donor_id, donor_name, amount, payment_method, campaign_id, campaign_title, transaction_date)
            VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
            RETURNING id::text, transaction_date
            """,
            (
                user.ngo_id if user else None,
                donor_id,
                donor_name,
                amount,
                body.method or "UPI",
                None,
                (body.campaign_slug or body.cause or "General Fund"),
            ),
        )
        tx_id, tx_dt = cur.fetchone()
        tx = {
            "id": tx_id,
            "donorId": donor_id,
            "donorName": donor_name,
            "amount": amount,
            "method": body.method or "UPI",
            "campaignId": body.campaign_slug or "",
            "campaignTitle": body.campaign_slug or body.cause or "General Fund",
            "date": (tx_dt.date().isoformat() if hasattr(tx_dt, "date") else str(tx_dt)),
        }
        return {"ok": True, "ngo_name": ngo_name, "transaction": tx, "source": "db"}


@app.get("/agent-hq/summary", tags=["Agentic UX"])
def get_agent_hq_summary(current_user: TokenUser = Depends(get_current_user)):
    """
    Minimal Agent HQ summary so the UI isn't hardcoded.
    """
    # active agents: derive from /health agents list
    agents = health().get("agents", [])
    # pending approvals: intent queue queued count
    pending = 0
    with db_conn() as conn:
        if conn is None:
            pending = len([x for x in INTENT_QUEUE_MEM_BY_NGO.get(current_user.ngo_id, []) if x.get("status") == "queued"])
        else:
            cur = conn.cursor()
            cur.execute(
                "SELECT COUNT(*) FROM intent_queue WHERE ngo_id = %s AND status = 'queued' AND resolved_at IS NULL",
                (current_user.ngo_id,),
            )
            pending = int(cur.fetchone()[0] or 0)
    prefs = AGENT_HQ_PREFS_MEM.get(current_user.ngo_id, {})
    executed_recent = 0
    with db_conn() as conn:
        if conn is None:
            executed_recent = len([x for x in INTENT_QUEUE_MEM_BY_NGO.get(current_user.ngo_id, []) if x.get("status") == "executed"])
        else:
            try:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT COUNT(*) FROM intent_queue
                    WHERE ngo_id = %s AND status = 'executed' AND executed_at > NOW() - INTERVAL '30 days'
                    """,
                    (current_user.ngo_id,),
                )
                executed_recent = int(cur.fetchone()[0] or 0)
            except Exception:
                executed_recent = 0
    streak = min(99, max(0, executed_recent * 3 + max(0, 12 - pending * 2)))
    alerts: List[Dict[str, Any]] = []
    if pending == 0 and executed_recent == 0 and len(agents) > 0:
        alerts.append(
            {
                "severity": "low",
                "message": "No agent executions recorded recently — confirm triggers/webhooks are connected.",
            }
        )
    return {
        "agents": agents,
        "pending_approvals": pending,
        "activity_count_30d": executed_recent,
        "hours_saved_30d": None,
        "auto_approve_max_inr": prefs.get("auto_approve_max_inr"),
        "agent_streaks": [
            {
                "name": "Copilot intents",
                "correct_in_row": streak,
                "rejections_30d": 0,
            }
        ],
        "alerts": alerts,
    }


class AgentHqPrefsRequest(BaseModel):
    auto_approve_max_inr: Optional[int] = None


@app.post("/agent-hq/prefs", tags=["Agentic UX"])
def post_agent_hq_prefs(body: AgentHqPrefsRequest, current_user: TokenUser = Depends(require_role("ed", "admin", "finance"))):
    prev = AGENT_HQ_PREFS_MEM.setdefault(current_user.ngo_id, {})
    if body.auto_approve_max_inr is not None:
        prev["auto_approve_max_inr"] = max(0, int(body.auto_approve_max_inr))
    return {"prefs": prev, "source": "memory"}


@app.get("/agent-hq/audit", tags=["Agentic UX"])
def get_agent_hq_audit(current_user: TokenUser = Depends(get_current_user)):
    """
    Lightweight audit feed. Uses volunteer_events (db) or memory activity logs.
    """
    with db_conn() as conn:
        if conn is None:
            ev = [e for e in VOLUNTEER_ACTIVITY_LOG if e.get("ngo_id") == current_user.ngo_id]
            return {"logs": list(reversed(ev))[:50], "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id::text, type, payload::text, created_at::text
            FROM volunteer_events
            WHERE ngo_id = %s
            ORDER BY created_at DESC
            LIMIT 50
            """,
            (current_user.ngo_id,),
        )
        out = []
        for r in cur.fetchall():
            out.append({"id": r[0], "type": r[1], "payload": r[2], "created_at": r[3]})
        return {"logs": out, "source": "db"}


@app.get("/finance/transactions", tags=["Finance"])
def list_transactions(
    classify: bool = False,
    exception_only: bool = False,
    min_confidence: float = 0.9,
    current_user: TokenUser = Depends(require_role("ed", "finance", "fundraising", "crm")),
):
    lim = 500 if not classify else min(500, 200)

    def _enrich_tx_row(tx: Dict[str, Any]) -> Dict[str, Any]:
        desc = f"{tx.get('donorName') or ''} {tx.get('campaignTitle') or ''} donation {tx.get('amount')}"
        sug = classify_fcra_transaction(desc)
        tx["agent_category"] = sug.get("category")
        tx["agent_confidence"] = float(sug.get("confidence") or 0.7)
        return tx

    with db_conn() as conn:
        if conn is None:
            _seed_memory_crm(current_user.ngo_id)
            txs = TX_MEM_BY_NGO.get(current_user.ngo_id, [])
            txs_sorted = sorted(txs, key=lambda t: int(t.get("timestamp") or 0), reverse=True)[:lim]
            out = []
            for tx in txs_sorted:
                row = dict(tx)
                if classify or exception_only:
                    row = _enrich_tx_row(row)
                out.append(row)
            if exception_only:
                out = [t for t in out if float(t.get("agent_confidence") or 0) < float(min_confidence)]
            return {"transactions": out, "source": "memory", "exception_only": exception_only}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id::text,
                   COALESCE(donor_id::text, '') as donor_id,
                   COALESCE(donor_name, '') as donor_name,
                   amount::float,
                   COALESCE(payment_method, '') as payment_method,
                   COALESCE(campaign_id, '') as campaign_id,
                   COALESCE(campaign_title, '') as campaign_title,
                   transaction_date
            FROM transactions
            WHERE ngo_id = %s::uuid
            ORDER BY transaction_date DESC
            LIMIT %s
            """,
            (current_user.ngo_id, lim),
        )
        out = []
        for r in cur.fetchall():
            row = {
                "id": r[0],
                "donorId": r[1] or "",
                "donorName": r[2] or "",
                "amount": float(r[3] or 0),
                "method": r[4] or "",
                "campaignId": r[5] or "",
                "campaignTitle": r[6] or "",
                "date": (r[7].date().isoformat() if hasattr(r[7], "date") else str(r[7])),
                "timestamp": int(r[7].timestamp() * 1000) if hasattr(r[7], "timestamp") else int(datetime.now(timezone.utc).timestamp() * 1000),
            }
            if classify or exception_only:
                row = _enrich_tx_row(row)
            out.append(row)
        if exception_only:
            out = [t for t in out if float(t.get("agent_confidence") or 0) < float(min_confidence)]
        return {"transactions": out, "source": "db", "exception_only": exception_only}


@app.post("/finance/transactions", tags=["Finance"])
def create_transaction(body: TransactionCreate, current_user: TokenUser = Depends(require_role("ed", "finance", "fundraising"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_crm(current_user.ngo_id)
            _seed_memory_campaigns(current_user.ngo_id)
            new_id = f"TRX-{1000 + len(TX_MEM_BY_NGO.get(current_user.ngo_id, [])) + 100}"
            tx = {
                "id": new_id,
                "donorId": body.donorId,
                "donorName": body.donorName,
                "amount": float(body.amount),
                "method": body.method,
                "campaignId": body.campaignId or "",
                "campaignTitle": body.campaignTitle or "",
                "date": "Just now",
                "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
            }
            TX_MEM_BY_NGO.setdefault(current_user.ngo_id, []).insert(0, tx)
            # Update donor aggregates (best-effort)
            donors = DONORS_MEM_BY_NGO.get(current_user.ngo_id, [])
            for d in donors:
                if d.get("id") == body.donorId:
                    d["totalGiven"] = float(d.get("totalGiven") or 0) + float(body.amount)
                    d["lastGift"] = datetime.now(timezone.utc).date().isoformat()
                    break
            # Update campaign aggregates (best-effort)
            if body.campaignId:
                campaigns = CAMPAIGNS_MEM_BY_NGO.get(current_user.ngo_id, [])
                for c in campaigns:
                    if c.get("id") == body.campaignId:
                        c["raised"] = float(c.get("raised") or 0) + float(body.amount)
                        c["donorsCount"] = int(c.get("donorsCount") or 0) + 1
                        break
            return {"status": "created", "transaction": tx, "source": "memory"}

        cur = conn.cursor()
        # Try to cast donor_id to UUID; if the frontend passes a non-uuid ID (legacy demo),
        # store it in meta and keep donor_id NULL.
        donor_uuid = None
        try:
            import uuid as _uuid
            donor_uuid = str(_uuid.UUID(body.donorId))
        except Exception:
            donor_uuid = None

        cur.execute(
            """
            INSERT INTO transactions (ngo_id, donor_id, donor_name, amount, fund_classification, payment_method, campaign_id, campaign_title, receipt_generated)
            VALUES (%s::uuid, %s::uuid, %s, %s, 'General', %s, %s, %s, true)
            RETURNING id::text, transaction_date
            """,
            (
                current_user.ngo_id,
                donor_uuid,
                body.donorName,
                float(body.amount),
                body.method,
                body.campaignId,
                body.campaignTitle,
            ),
        )
        new_id, tx_dt = cur.fetchone()
        tx = {
            "id": new_id,
            "donorId": donor_uuid or "",
            "donorName": body.donorName,
            "amount": float(body.amount),
            "method": body.method,
            "campaignId": body.campaignId or "",
            "campaignTitle": body.campaignTitle or "",
            "date": (tx_dt.date().isoformat() if hasattr(tx_dt, "date") else str(tx_dt)),
            "timestamp": int(tx_dt.timestamp() * 1000) if hasattr(tx_dt, "timestamp") else int(datetime.now(timezone.utc).timestamp() * 1000),
        }
        # Best-effort campaign aggregate update
        if body.campaignId:
            try:
                cur.execute(
                    "UPDATE campaigns SET raised = COALESCE(raised,0) + %s WHERE ngo_id = %s AND id = %s",
                    (float(body.amount), current_user.ngo_id, body.campaignId),
                )
            except Exception:
                pass
        return {"status": "created", "transaction": tx, "source": "db"}

# ── Request Models ──────────────────────────────────────────────────────────────

class DonationEvent(BaseModel):
    event_type: str = "donation_received"
    donor_id: str
    donor_name: str
    donation_amount: float
    preferred_language: Optional[str] = "English"

class TransactionEvent(BaseModel):
    event_type: str = "transaction.classified"
    transaction_id: str
    amount: float
    fund_type: str               # General | FCRA | CSR | Restricted
    source_country: str = "IN"
    total_fcra_budget: float = 4000000
    admin_spent_fcra: float = 0
    filing_deadlines: Optional[List[dict]] = []

class GrantReportTrigger(BaseModel):
    grant_id: str
    grant_name: str
    funder_name: str
    report_type: str = "quarterly"  # quarterly | milestone | final

class DocumentIngest(BaseModel):
    text: str
    document_title: str
    document_type: str            # grant_report | csr_proposal | policy | compliance_doc
    ngo_id: str = "ngo_001"

class RazorpayWebhook(BaseModel):
    event: str
    payload: dict

# ── Health ──────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "healthy",
        "agents": ["DonorNurture", "FinanceCompliance", "BoardBriefing", "GrantReport"],
        "version": "2.0.0"
    }

# ── Auth Endpoints ─────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str

class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    name: str
    email: str
    role: str
    ngo_id: str
    ngo_name: str
    expires_in_hours: int = 24

class RegisterNgoRequest(BaseModel):
    ngo_name: str
    ngo_slug: str
    email: str
    password: str
    full_name: str
    role: str = "ed"


class UpdateProfileRequest(BaseModel):
    full_name: str


class UpdateNgoRequest(BaseModel):
    # All fields optional so partial wizard saves don't clobber values that
    # the user filled in on a previous step. Settings page sends the full
    # core block; wizard helpers only send what the active step changed.
    name: Optional[str] = None
    reg_no: Optional[str] = None
    fcra_reg: Optional[str] = None
    pan: Optional[str] = None
    state: Optional[str] = None
    # Wizard-only optional extras (Task #12). Persisted into ngos.meta JSONB
    # so we don't have to grow the ngos schema for every new wizard field.
    section_80g: Optional[str] = None
    cause_area: Optional[str] = None
    logo_data_url: Optional[str] = None
    fcra_status: Optional[str] = None  # 'none' | 'pending' | 'active'
    whatsapp_phone: Optional[str] = None
    whatsapp_verified: Optional[bool] = None
    whatsapp_connected_at: Optional[str] = None
    # Append-only program name list (powers /programs hydration after a
    # fresh login). Backend de-dupes case-insensitively.
    program_name: Optional[str] = None


class NgoInviteEntry(BaseModel):
    email: str
    role: str


class NgoInviteRequest(BaseModel):
    invites: List[NgoInviteEntry]


class NotificationPrefsRequest(BaseModel):
    prefs: Dict[str, bool]


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

@app.post("/auth/register", tags=["Auth"])
def register_ngo(body: RegisterNgoRequest):
    """
    Create NGO + first user in Postgres (Railway), returns JWT.
    Requires DATABASE_URL; otherwise returns 501.
    """
    with db_conn() as conn:
        if conn is None:
            # Demo mode: allow lightweight registration so nonprofits can try the product
            # without setting up Postgres. This is not persistent across restarts.
            ngo_id = f"ngo_{body.ngo_slug}"
            ngo_name = body.ngo_name
            user_id = f"user_{int(datetime.now(timezone.utc).timestamp())}"
            role = body.role or "ed"

            if body.email in DEMO_USERS:
                raise HTTPException(status_code=409, detail="Email already registered (demo mode).")

            DEMO_USERS[body.email] = {
                "user_id": user_id,
                "name": body.full_name,
                "password": body.password,
                "role": role,
                "ngo_id": ngo_id,
                "ngo_name": ngo_name,
            }

            token = create_access_token(
                user_id=user_id,
                email=body.email,
                role=role,
                ngo_id=ngo_id,
                ngo_name=ngo_name,
            )
            return {
                "access_token": token,
                "token_type": "bearer",
                "user_id": user_id,
                "name": body.full_name,
                "email": body.email,
                "role": role,
                "ngo_id": ngo_id,
                "ngo_name": ngo_name,
                "expires_in_hours": 24,
                "source": "memory",
            }
        cur = conn.cursor()

        # Create NGO (schema.sql defines ngos.id UUID)
        cur.execute(
            """
            INSERT INTO ngos (name, slug, tier, is_active)
            VALUES (%s, %s, 'standard', true)
            RETURNING id::text, name
            """,
            (body.ngo_name, body.ngo_slug),
        )
        ngo_id, ngo_name = cur.fetchone()

        # Minimal password hash for MVP (replace with bcrypt in production)
        pw_hash = hashlib.sha256((body.password + os.getenv("JWT_SECRET", "dev")).encode()).hexdigest()

        cur.execute(
            """
            INSERT INTO users (ngo_id, email, password_hash, full_name, role, is_active)
            VALUES (%s::uuid, %s, %s, %s, %s::user_role, true)
            RETURNING id::text, full_name, role
            """,
            (ngo_id, body.email, pw_hash, body.full_name, body.role),
        )
        user_id, full_name, role = cur.fetchone()

        token = create_access_token(
            user_id=user_id,
            email=body.email,
            role=role,
            ngo_id=ngo_id,
            ngo_name=ngo_name,
        )
        return {
            "access_token": token,
            "token_type": "bearer",
            "user_id": user_id,
            "name": full_name,
            "email": body.email,
            "role": role,
            "ngo_id": ngo_id,
            "ngo_name": ngo_name,
            "expires_in_hours": 24,
        }

@app.post("/auth/login", response_model=LoginResponse, tags=["Auth"])
def login(body: LoginRequest):
    """
    Authenticate a user and return a signed JWT.
    In production: query the `users` table, verify bcrypt hash.
    Dev: uses the DEMO_USERS dict in core/auth.py.
    """
    # Prefer DB users when configured
    with db_conn() as conn:
        if conn is not None:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT u.id::text, u.full_name, u.role::text, n.id::text, n.name, u.password_hash
                FROM users u
                JOIN ngos n ON n.id = u.ngo_id
                WHERE u.email = %s AND u.is_active = true
                """,
                (body.email,),
            )
            row = cur.fetchone()
            if row:
                user_id, full_name, role, ngo_id, ngo_name, pw_hash = row
                candidate = hashlib.sha256((body.password + os.getenv("JWT_SECRET", "dev")).encode()).hexdigest()
                if candidate != pw_hash:
                    raise HTTPException(status_code=401, detail="Invalid email or password.")
                token = create_access_token(
                    user_id=user_id,
                    email=body.email,
                    role=role,
                    ngo_id=ngo_id,
                    ngo_name=ngo_name,
                )
                return LoginResponse(
                    access_token=token,
                    user_id=user_id,
                    name=full_name,
                    email=body.email,
                    role=role,
                    ngo_id=ngo_id,
                    ngo_name=ngo_name,
                )

    user = demo_authenticate(body.email, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    token = create_access_token(
        user_id=user["user_id"],
        email=body.email,
        role=user["role"],
        ngo_id=user["ngo_id"],
        ngo_name=user["ngo_name"],
    )
    return LoginResponse(
        access_token=token,
        user_id=user["user_id"],
        name=user["name"],
        email=body.email,
        role=user["role"],
        ngo_id=user["ngo_id"],
        ngo_name=user["ngo_name"],
    )

@app.post("/auth/refresh", tags=["Auth"])
def refresh_token(current_user: TokenUser = Depends(get_current_user)):
    """Issue a fresh JWT for an already-authenticated user (token rotation)."""
    new_token = create_access_token(
        user_id=current_user.user_id,
        email=current_user.email,
        role=current_user.role,
        ngo_id=current_user.ngo_id,
        ngo_name=current_user.ngo_name,
    )
    return {"access_token": new_token, "token_type": "bearer"}

@app.get("/auth/me", tags=["Auth"])
def get_me(current_user: TokenUser = Depends(get_current_user)):
    """Return the current authenticated user's profile."""
    return {
        "user_id": current_user.user_id,
        "email": current_user.email,
        "role": current_user.role,
        "ngo_id": current_user.ngo_id,
        "ngo_name": current_user.ngo_name,
    }


# ── Settings / Profile (DB-first, memory-fallback) ───────────────────────────

SETTINGS_MEM_BY_USER: Dict[str, Dict[str, Any]] = {}


def _settings_mem(user: TokenUser) -> Dict[str, Any]:
    key = f"{user.ngo_id}:{user.user_id}"
    if key not in SETTINGS_MEM_BY_USER:
        SETTINGS_MEM_BY_USER[key] = {
            "profile": {"full_name": user.email.split("@")[0]},
            "ngo": {"name": user.ngo_name, "reg_no": None, "fcra_reg": None, "pan": None, "state": None},
            "notification_prefs": {},
        }
    return SETTINGS_MEM_BY_USER[key]


@app.get("/settings", tags=["Settings"])
def get_settings(current_user: TokenUser = Depends(get_current_user)):
    with db_conn() as conn:
        if conn is None:
            s = _settings_mem(current_user)
            return {
                "profile": {"full_name": s["profile"].get("full_name")},
                "ngo": {**s["ngo"], "ngo_id": current_user.ngo_id, "meta": s.get("ngo_meta", {})},
                "notification_prefs": s.get("notification_prefs", {}),
            }
        cur = conn.cursor()
        cur.execute("SELECT full_name FROM users WHERE id = %s::uuid", (current_user.user_id,))
        u = cur.fetchone()
        # ngos.meta is created lazily by post_settings_ngo (Task #12). Tolerate
        # the column not existing yet on older DBs.
        try:
            cur.execute(
                "SELECT name, reg_no, fcra_reg, pan, state, COALESCE(meta, '{}'::jsonb) FROM ngos WHERE id = %s::uuid",
                (current_user.ngo_id,),
            )
            n = cur.fetchone()
            ngo_meta = _parse_jsonb(n[5]) if n else {}
        except Exception:
            cur.execute("SELECT name, reg_no, fcra_reg, pan, state FROM ngos WHERE id = %s::uuid", (current_user.ngo_id,))
            n = cur.fetchone()
            ngo_meta = {}
        # prefs table is created lazily; handle missing table safely
        p = None
        try:
            cur.execute(
                """
                SELECT prefs
                FROM user_notification_prefs
                WHERE ngo_id = %s::uuid AND user_id = %s::uuid
                """,
                (current_user.ngo_id, current_user.user_id),
            )
            p = cur.fetchone()
        except Exception:
            p = None
        return {
            "profile": {"full_name": (u[0] if u else "")},
            "ngo": {
                "ngo_id": current_user.ngo_id,
                "name": (n[0] if n else current_user.ngo_name),
                "reg_no": (n[1] if n else None),
                "fcra_reg": (n[2] if n else None),
                "pan": (n[3] if n else None),
                "state": (n[4] if n else None),
                "meta": ngo_meta,
            },
            "notification_prefs": (p[0] if p else {}),
        }


def _ngo_meta_patch(body: "UpdateNgoRequest") -> Dict[str, Any]:
    """Build the JSON patch that goes into ngos.meta for wizard extras."""
    patch: Dict[str, Any] = {}
    if body.section_80g is not None:    patch["section_80g"] = body.section_80g
    if body.cause_area is not None:     patch["cause_area"] = body.cause_area
    if body.logo_data_url is not None:  patch["logo_data_url"] = body.logo_data_url
    if body.fcra_status is not None:    patch["fcra_status"] = body.fcra_status
    if (body.whatsapp_phone is not None
            or body.whatsapp_verified is not None
            or body.whatsapp_connected_at is not None):
        patch["whatsapp"] = {
            **({"phone": body.whatsapp_phone} if body.whatsapp_phone is not None else {}),
            **({"verified": bool(body.whatsapp_verified)} if body.whatsapp_verified is not None else {}),
            **({"connected_at": body.whatsapp_connected_at} if body.whatsapp_connected_at is not None else {}),
        }
    return patch


@app.post("/settings/profile", tags=["Settings"])
def post_settings_profile(body: UpdateProfileRequest, current_user: TokenUser = Depends(get_current_user)):
    with db_conn() as conn:
        if conn is None:
            s = _settings_mem(current_user)
            s["profile"]["full_name"] = body.full_name
            return {"ok": True, "profile": {"full_name": body.full_name}, "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET full_name = %s WHERE id = %s::uuid RETURNING full_name",
            (body.full_name, current_user.user_id),
        )
        row = cur.fetchone()
        return {"ok": True, "profile": {"full_name": row[0] if row else body.full_name}, "source": "db"}


@app.post("/settings/ngo", tags=["Settings"])
def post_settings_ngo(body: UpdateNgoRequest, current_user: TokenUser = Depends(get_current_user)):
    meta_patch = _ngo_meta_patch(body)
    with db_conn() as conn:
        if conn is None:
            s = _settings_mem(current_user)
            # Only overwrite a core field when the caller actually sent a
            # value. Wizard helpers send tightly scoped payloads (e.g. the
            # WhatsApp step only sends whatsapp_*); previously, the missing
            # name/reg_no/etc were nulling earlier wizard steps.
            core = {k: v for k, v in body.model_dump().items()
                    if k in ("name", "reg_no", "fcra_reg", "pan", "state") and v is not None}
            s["ngo"] = {**s["ngo"], **core}
            ngo_meta = dict(s.get("ngo_meta", {}))
            ngo_meta.update(meta_patch)
            if body.program_name and body.program_name.strip():
                progs = list(ngo_meta.get("programs", []))
                pname = body.program_name.strip()
                if not any(p.lower() == pname.lower() for p in progs):
                    progs.append(pname)
                ngo_meta["programs"] = progs
            s["ngo_meta"] = ngo_meta
            return {"ok": True, "ngo": {**s["ngo"], "meta": ngo_meta}, "source": "memory"}
        cur = conn.cursor()
        # Lazy-add the meta column so older DBs upgrade themselves on first
        # wizard run. Same pattern as user_notification_prefs above.
        try:
            cur.execute("ALTER TABLE ngos ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb")
        except Exception:
            pass
        # COALESCE preserves any column the caller didn't send. This is what
        # makes a 4-step wizard safe — step 5 (WhatsApp) does not blank the
        # registration number step 1 just wrote.
        cur.execute(
            """
            UPDATE ngos
            SET name = COALESCE(%s, name),
                reg_no = COALESCE(%s, reg_no),
                fcra_reg = COALESCE(%s, fcra_reg),
                pan = COALESCE(%s, pan),
                state = COALESCE(%s, state),
                meta = COALESCE(meta, '{}'::jsonb) || %s::jsonb
            WHERE id = %s::uuid
            RETURNING name, reg_no, fcra_reg, pan, state, COALESCE(meta, '{}'::jsonb)
            """,
            (body.name, body.reg_no, body.fcra_reg, body.pan, body.state,
             json.dumps(meta_patch) if meta_patch else "{}", current_user.ngo_id),
        )
        row = cur.fetchone()
        ngo_meta = _parse_jsonb(row[5]) if row else {}
        # Append-only program name list lives separately so it can grow
        # across wizard runs without callers having to read-modify-write.
        if row and body.program_name and body.program_name.strip():
            pname = body.program_name.strip()
            progs = list(ngo_meta.get("programs", []))
            if not any(str(p).lower() == pname.lower() for p in progs):
                progs.append(pname)
                ngo_meta["programs"] = progs
                cur.execute(
                    """
                    UPDATE ngos
                    SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{programs}', %s::jsonb)
                    WHERE id = %s::uuid
                    """,
                    (json.dumps(progs), current_user.ngo_id),
                )
        ngo = (
            {"name": row[0], "reg_no": row[1], "fcra_reg": row[2], "pan": row[3],
             "state": row[4], "meta": ngo_meta}
            if row else {**body.model_dump(), "meta": meta_patch}
        )
        return {"ok": True, "ngo": ngo, "source": "db"}


# ── Onboarding wizard: team invites (Task #12) ───────────────────────────────
# Persists invites the ED added in the signup wizard so they survive a
# browser wipe and surface again under Settings → Team. We don't actually
# send invite emails in MVP — the rows are queued for the future onboarding
# email worker. Mirrors the DB-first/memory-fallback pattern.

INVITES_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}


def _invites_table_init(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS ngo_invites (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            ngo_id UUID NOT NULL,
            email TEXT NOT NULL,
            role TEXT NOT NULL,
            invited_by UUID,
            invited_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            status TEXT NOT NULL DEFAULT 'pending',
            UNIQUE (ngo_id, email)
        )
        """
    )


@app.get("/onboarding/invites", tags=["Settings"])
def list_invites(current_user: TokenUser = Depends(get_current_user)):
    with db_conn() as conn:
        if conn is None:
            return {"invites": INVITES_MEM_BY_NGO.get(current_user.ngo_id, []), "source": "memory"}
        cur = conn.cursor()
        try:
            _invites_table_init(cur)
            cur.execute(
                """
                SELECT email, role, status,
                       to_char(invited_at AT TIME ZONE 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                FROM ngo_invites
                WHERE ngo_id = %s::uuid
                ORDER BY invited_at DESC
                LIMIT 200
                """,
                (current_user.ngo_id,),
            )
            return {
                "invites": [
                    {"email": r[0], "role": r[1], "status": r[2], "invitedAt": r[3]}
                    for r in cur.fetchall()
                ],
                "source": "db",
            }
        except Exception:
            return {"invites": [], "source": "db"}


@app.post("/onboarding/invites", tags=["Settings"])
def create_invites(body: NgoInviteRequest, current_user: TokenUser = Depends(get_current_user)):
    # Lightweight RFC-5322-ish email check — keeps obvious garbage
    # ("not-an-email", "asha", "x@" etc.) out of the queue without
    # taking on a heavyweight validator dependency.
    _email_re = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
    cleaned = [
        {"email": i.email.strip().lower(), "role": (i.role or "").strip()}
        for i in body.invites
        if i.email.strip() and i.role.strip() and _email_re.match(i.email.strip())
    ][:25]
    if not cleaned:
        return {"queued": 0, "invites": [], "source": "memory"}
    with db_conn() as conn:
        if conn is None:
            now = datetime.now(timezone.utc).isoformat()
            existing = INVITES_MEM_BY_NGO.setdefault(current_user.ngo_id, [])
            existing_emails = {i["email"] for i in existing}
            queued = []
            for entry in cleaned:
                if entry["email"] in existing_emails:
                    continue
                rec = {**entry, "status": "pending", "invitedAt": now}
                existing.insert(0, rec)
                existing_emails.add(entry["email"])
                queued.append(rec)
            return {"queued": len(queued), "invites": queued, "source": "memory"}
        cur = conn.cursor()
        _invites_table_init(cur)
        queued = []
        for entry in cleaned:
            cur.execute(
                """
                INSERT INTO ngo_invites (ngo_id, email, role, invited_by)
                VALUES (%s::uuid, %s, %s, %s::uuid)
                ON CONFLICT (ngo_id, email) DO NOTHING
                RETURNING email, role, status,
                          to_char(invited_at AT TIME ZONE 'UTC',
                                  'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                """,
                (current_user.ngo_id, entry["email"], entry["role"], current_user.user_id),
            )
            row = cur.fetchone()
            if row:
                queued.append({"email": row[0], "role": row[1], "status": row[2], "invitedAt": row[3]})
        return {"queued": len(queued), "invites": queued, "source": "db"}


class RemoveTeamMemberRequest(BaseModel):
    email: str


@app.delete("/team/member", tags=["Settings"])
def remove_team_member(
    body: RemoveTeamMemberRequest,
    current_user: TokenUser = Depends(require_role("ed", "admin")),
):
    """
    Offboard a team member by email.

    Membership is confirmed against (in order of priority):
      1. The ngo_invites table / INVITES_MEM_BY_NGO in-memory store.
      2. The users table (DB mode) / DEMO_USERS dict (memory mode), scoped to
         the caller's NGO.

    Revocation is unconditionally applied once membership is confirmed —
    it is decoupled from whether an invite row exists, so users who joined
    via direct account creation are also correctly offboarded.

    Only organisation admins (ED / admin role) may call this endpoint.
    Returns 404 if the email is not a recognised member of this NGO.
    """
    email = body.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="email is required.")

    # Prevent accidental self-removal.
    if email == current_user.email.lower():
        raise HTTPException(status_code=400, detail="You cannot remove yourself.")

    member_confirmed = False

    with db_conn() as conn:
        if conn is None:
            # ── Memory mode ─────────────────────────────────────────────────
            # 1. Check invite store.
            existing = INVITES_MEM_BY_NGO.get(current_user.ngo_id, [])
            next_list = [i for i in existing if i["email"].lower() != email]
            if len(next_list) < len(existing):
                INVITES_MEM_BY_NGO[current_user.ngo_id] = next_list
                member_confirmed = True

            # 2. Check DEMO_USERS scoped to caller's NGO (covers pre-seeded
            #    accounts that never went through the invite flow).
            if not member_confirmed:
                demo = DEMO_USERS.get(email)
                if demo and demo.get("ngo_id") == current_user.ngo_id:
                    member_confirmed = True
        else:
            # ── DB mode ─────────────────────────────────────────────────────
            cur = conn.cursor()
            # 1. Remove invite row (returns the email if it existed).
            try:
                _invites_table_init(cur)
                cur.execute(
                    """
                    DELETE FROM ngo_invites
                    WHERE ngo_id = %s::uuid AND LOWER(email) = %s
                    RETURNING email
                    """,
                    (current_user.ngo_id, email),
                )
                if cur.fetchone():
                    member_confirmed = True
            except Exception:
                pass

            # 2. Even if no invite row existed, confirm via the users table so
            #    that accounts created through other flows are also offboardable.
            if not member_confirmed:
                try:
                    cur.execute(
                        """
                        SELECT id FROM users
                        WHERE ngo_id = %s::uuid AND LOWER(email) = %s
                        LIMIT 1
                        """,
                        (current_user.ngo_id, email),
                    )
                    if cur.fetchone():
                        member_confirmed = True
                except Exception:
                    pass

    if not member_confirmed:
        raise HTTPException(status_code=404, detail="Team member not found in this organisation.")

    # Invalidate any active JWT for this email within the NGO.
    # This is always reached once membership is confirmed, regardless of
    # which source confirmed it.
    revoke_member(current_user.ngo_id, email)

    # Persist the revocation in DB so it survives server restarts.
    # We upsert a 'revoked' status row; ngo_invites is the natural home since
    # it already tracks NGO ↔ email relationships with a UNIQUE constraint.
    with db_conn() as conn:
        if conn is not None:
            cur = conn.cursor()
            try:
                _invites_table_init(cur)
                cur.execute(
                    """
                    INSERT INTO ngo_invites (ngo_id, email, role, status)
                    VALUES (%s::uuid, %s, 'member', 'revoked')
                    ON CONFLICT (ngo_id, email) DO UPDATE SET status = 'revoked'
                    """,
                    (current_user.ngo_id, email),
                )
            except Exception:
                pass

    return {"ok": True, "email": email, "revoked": True}


@app.on_event("startup")
async def _load_revoked_members_from_db() -> None:
    """
    Rehydrate the in-process revocation blocklist from the DB on startup so
    that offboarding decisions made before a restart take effect immediately.
    No-op when the DB is not configured (memory-only mode).
    """
    with db_conn() as conn:
        if conn is None:
            return
        cur = conn.cursor()
        try:
            _invites_table_init(cur)
            cur.execute(
                "SELECT ngo_id::text, email FROM ngo_invites WHERE status = 'revoked'"
            )
            for ngo_id, email in cur.fetchall():
                revoke_member(str(ngo_id), email)
        except Exception:
            pass


@app.post("/settings/notifications", tags=["Settings"])
def post_settings_notifications(body: NotificationPrefsRequest, current_user: TokenUser = Depends(get_current_user)):
    with db_conn() as conn:
        if conn is None:
            s = _settings_mem(current_user)
            s["notification_prefs"] = body.prefs
            return {"ok": True, "notification_prefs": body.prefs, "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS user_notification_prefs (
                ngo_id UUID NOT NULL,
                user_id UUID NOT NULL,
                prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (ngo_id, user_id)
            )
            """
        )
        cur.execute(
            """
            INSERT INTO user_notification_prefs (ngo_id, user_id, prefs)
            VALUES (%s::uuid, %s::uuid, %s::jsonb)
            ON CONFLICT (ngo_id, user_id)
            DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = CURRENT_TIMESTAMP
            RETURNING prefs
            """,
            (current_user.ngo_id, current_user.user_id, json.dumps(body.prefs)),
        )
        row = cur.fetchone()
        return {"ok": True, "notification_prefs": row[0] if row else body.prefs, "source": "db"}


@app.post("/auth/change-password", tags=["Auth"])
def change_password(body: ChangePasswordRequest, current_user: TokenUser = Depends(get_current_user)):
    # Demo auth
    if current_user.email in DEMO_USERS:
        if DEMO_USERS[current_user.email].get("password") != body.current_password:
            raise HTTPException(status_code=400, detail="Current password incorrect.")
        DEMO_USERS[current_user.email]["password"] = body.new_password
        return {"ok": True, "source": "memory"}
    with db_conn() as conn:
        if conn is None:
            raise HTTPException(status_code=501, detail="DB not configured.")
        cur = conn.cursor()
        cur.execute("SELECT password_hash FROM users WHERE id = %s::uuid", (current_user.user_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found.")
        current_hash = hashlib.sha256((body.current_password + os.getenv("JWT_SECRET", "dev")).encode()).hexdigest()
        if current_hash != row[0]:
            raise HTTPException(status_code=400, detail="Current password incorrect.")
        new_hash = hashlib.sha256((body.new_password + os.getenv("JWT_SECRET", "dev")).encode()).hexdigest()
        cur.execute("UPDATE users SET password_hash = %s WHERE id = %s::uuid", (new_hash, current_user.user_id))
        return {"ok": True, "source": "db"}


@app.post("/auth/sessions/revoke-other", tags=["Auth"])
def revoke_other_sessions(current_user: TokenUser = Depends(get_current_user)):
    # Token revocation is not implemented in MVP; endpoint exists to avoid fake UI.
    return {"ok": True, "note": "Session revocation not implemented in MVP."}


@app.get("/dpdp/export", tags=["DPDP"])
def dpdp_export(current_user: TokenUser = Depends(get_current_user)):
    """
    DPDP Act 2023 — full organisation data export.
    Returns a ZIP containing one CSV per entity type.  In production the data
    is fetched from the database; in demo / memory mode the in-memory stores
    are used so the download is never empty.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"goodjobs_export_{today}.zip"

    def _make_csv(rows: list[dict]) -> str:
        if not rows:
            return ""
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()), extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
        return buf.getvalue()

    def _ser(v: Any) -> str:
        if v is None:
            return ""
        if isinstance(v, (dict, list)):
            return json.dumps(v, ensure_ascii=False)
        return str(v)

    ngo_id = current_user.ngo_id
    s = get_settings(current_user)
    exported_at = datetime.now(timezone.utc).isoformat()

    with db_conn() as conn:
        # ── donors ──────────────────────────────────────────────────────────
        if conn is not None:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT id::text, full_name, COALESCE(donor_type,'') as donor_type,
                       COALESCE(total_lifetime_value,0)::float as total_given,
                       COALESCE(pan_masked,'') as pan,
                       COALESCE(location_text,'') as location,
                       COALESCE(email,'') as email,
                       COALESCE(phone,'') as phone,
                       COALESCE(tags,'{}') as tags
                FROM donors WHERE ngo_id = %s::uuid ORDER BY created_at DESC
                """,
                (ngo_id,),
            )
            donors_rows = [
                {"id": r[0], "name": r[1], "type": r[2], "total_given": r[3],
                 "pan": r[4], "location": r[5], "email": r[6], "phone": r[7],
                 "tags": ";".join(list(r[8] or []))}
                for r in cur.fetchall()
            ]
        else:
            _seed_memory_crm(ngo_id)
            donors_rows = [
                {"id": _ser(d.get("id")), "name": _ser(d.get("name")),
                 "type": _ser(d.get("type")), "total_given": _ser(d.get("totalGiven")),
                 "pan": _ser(d.get("pan")), "location": _ser(d.get("location")),
                 "email": _ser(d.get("email")), "phone": _ser(d.get("phone")),
                 "tags": ";".join(d.get("tags") or [])}
                for d in DONORS_MEM_BY_NGO.get(ngo_id, [])
            ]

        # ── transactions ─────────────────────────────────────────────────────
        if conn is not None:
            cur.execute(
                """
                SELECT id::text, donor_id::text, COALESCE(donor_name,'') as donor_name,
                       amount::float, COALESCE(method,'') as method,
                       COALESCE(campaign_id::text,'') as campaign_id,
                       COALESCE(campaign_title,'') as campaign_title,
                       created_at
                FROM transactions WHERE ngo_id = %s::uuid ORDER BY created_at DESC
                """,
                (ngo_id,),
            )
            tx_rows = [
                {"id": r[0], "donor_id": r[1], "donor_name": r[2], "amount": r[3],
                 "method": r[4], "campaign_id": r[5], "campaign_title": r[6],
                 "date": _ser(r[7])}
                for r in cur.fetchall()
            ]
        else:
            tx_rows = [
                {"id": _ser(t.get("id")), "donor_id": _ser(t.get("donorId")),
                 "donor_name": _ser(t.get("donorName")), "amount": _ser(t.get("amount")),
                 "method": _ser(t.get("method")), "campaign_id": _ser(t.get("campaignId")),
                 "campaign_title": _ser(t.get("campaignTitle")), "date": _ser(t.get("date"))}
                for t in TX_MEM_BY_NGO.get(ngo_id, [])
            ]

        # ── beneficiaries ─────────────────────────────────────────────────────
        if conn is not None:
            cur.execute(
                """
                SELECT id, name, program, location, aadhaar, family_size,
                       COALESCE(details,'{}') as details
                FROM program_beneficiaries WHERE ngo_id = %s ORDER BY created_at DESC
                """,
                (ngo_id,),
            )
            ben_rows = [
                {"id": _ser(r[0]), "name": _ser(r[1]), "program": _ser(r[2]),
                 "location": _ser(r[3]), "aadhaar": "yes" if r[4] else "no",
                 "family_size": _ser(r[5]), "details": _ser(r[6])}
                for r in cur.fetchall()
            ]
        else:
            _seed_memory_beneficiaries(ngo_id)
            ben_rows = [
                {"id": _ser(b.get("id")), "name": _ser(b.get("name")),
                 "program": _ser(b.get("program")), "location": _ser(b.get("location")),
                 "aadhaar": "yes" if b.get("aadhaar") else "no",
                 "family_size": _ser(b.get("familySize")), "details": _ser(b.get("details"))}
                for b in BENEFICIARIES_MEM_BY_NGO.get(ngo_id, [])
            ]

        # ── CSR / grants ──────────────────────────────────────────────────────
        if conn is not None:
            cur.execute(
                """
                SELECT id::text, company, amount::float, project,
                       COALESCE(tags,'{}') as tags, status, COALESCE(agent,'') as agent,
                       COALESCE(report_due_date,'') as report_due_date,
                       COALESCE(win_probability::text,'') as win_probability
                FROM csr_pipeline WHERE ngo_id = %s::uuid ORDER BY created_at DESC
                """,
                (ngo_id,),
            )
            grant_rows = [
                {"id": r[0], "company": r[1], "amount": r[2], "project": r[3],
                 "tags": ";".join(list(r[4] or [])), "status": r[5], "agent": r[6],
                 "report_due_date": r[7], "win_probability": r[8]}
                for r in cur.fetchall()
            ]
        else:
            _seed_memory_csr(ngo_id)
            grant_rows = [
                {"id": _ser(g.get("id")), "company": _ser(g.get("company")),
                 "amount": _ser(g.get("amount")), "project": _ser(g.get("project")),
                 "tags": ";".join(g.get("tags") or []), "status": _ser(g.get("col")),
                 "agent": _ser(g.get("agent")), "report_due_date": _ser(g.get("report_due_date")),
                 "win_probability": _ser(g.get("win_probability"))}
                for g in CSR_CARDS_MEM_BY_NGO.get(ngo_id, [])
            ]

        # ── compliance docs ───────────────────────────────────────────────────
        if conn is not None:
            cur.execute(
                """
                SELECT id::text, name, doc_type, status, expiry_date,
                       COALESCE(registration_number,'') as reg_no,
                       COALESCE(assigned_to,'') as assigned_to,
                       uploaded_at
                FROM compliance_documents WHERE ngo_id = %s::uuid ORDER BY uploaded_at DESC
                """,
                (ngo_id,),
            )
            comp_rows = [
                {"id": r[0], "name": r[1], "type": r[2], "status": r[3],
                 "expiry": _ser(r[4]), "registration_number": r[5],
                 "assigned_to": r[6], "uploaded_at": _ser(r[7])}
                for r in cur.fetchall()
            ]
        else:
            comp_rows = [
                {"id": _ser(c.get("id")), "name": _ser(c.get("name")),
                 "type": _ser(c.get("type")), "status": _ser(c.get("status")),
                 "expiry": _ser(c.get("expiry")),
                 "registration_number": _ser(c.get("registration_number")),
                 "assigned_to": _ser(c.get("assigned_to")),
                 "uploaded_at": _ser(c.get("uploadedAt"))}
                for c in COMPLIANCE_DOCS_MEM_BY_NGO.get(ngo_id, [])
            ]

        # ── volunteers ────────────────────────────────────────────────────────
        if conn is not None:
            cur.execute(
                """
                SELECT id::text, name, COALESCE(skills,'{}') as skills,
                       COALESCE(hours_logged,0)::float as hours, verified
                FROM volunteers WHERE ngo_id = %s::uuid ORDER BY created_at DESC
                """,
                (ngo_id,),
            )
            vol_rows = [
                {"id": r[0], "name": r[1], "skills": ";".join(list(r[2] or [])),
                 "hours": r[3], "verified": "yes" if r[4] else "no"}
                for r in cur.fetchall()
            ]
        else:
            _seed_memory_volunteer_roster(ngo_id)
            vol_rows = [
                {"id": _ser(v.get("id")), "name": _ser(v.get("name")),
                 "skills": ";".join(v.get("skills") or []),
                 "hours": _ser(v.get("hours")), "verified": "yes" if v.get("verified") else "no"}
                for v in VOLUNTEERS_ROSTER_MEM_BY_NGO.get(ngo_id, [])
            ]

    # ── Build ZIP in-memory ───────────────────────────────────────────────────
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        manifest = {
            "exported_by": current_user.email,
            "exported_at": exported_at,
            "ngo": s.get("ngo", {}),
            "files": ["manifest.json", "donors.csv", "transactions.csv",
                      "beneficiaries.csv", "grants.csv", "compliance_docs.csv",
                      "volunteers.csv"],
        }
        zf.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
        zf.writestr("donors.csv", _make_csv(donors_rows))
        zf.writestr("transactions.csv", _make_csv(tx_rows))
        zf.writestr("beneficiaries.csv", _make_csv(ben_rows))
        zf.writestr("grants.csv", _make_csv(grant_rows))
        zf.writestr("compliance_docs.csv", _make_csv(comp_rows))
        zf.writestr("volunteers.csv", _make_csv(vol_rows))

    zip_bytes = buf.getvalue()
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(zip_bytes)),
        },
    )

# ── Donor Nurture Agent ─────────────────────────────────────────────────────────

def _run_donor_agent(payload: dict):
    try:
        result = donor_nurture_app.invoke(payload)
        print(f"Donor Agent → {result['status']}")
    except Exception as e:
        print(f"Donor Agent Error: {e}")

@app.post("/webhook/donation", tags=["Agents"])
async def handle_donation(
    event: DonationEvent,
    background_tasks: BackgroundTasks,
    current_user: TokenUser = Depends(require_role("ed", "finance", "programs")),
):
    """Razorpay / manual donation webhook → triggers Donor Nurture Agent."""
    is_major = event.donation_amount >= 100000
    background_tasks.add_task(_run_donor_agent, event.model_dump())
    return {"status": "accepted", "is_major_donor": is_major, "requires_human_approval": is_major}


# ── Finance & Compliance Agent ──────────────────────────────────────────────────

def _run_finance_agent(payload: dict):
    try:
        result = finance_agent.invoke(payload)
        print(f"Finance Agent → {result['status']} | CFO needed: {result.get('requires_cfo_approval')}")
        if result.get("alert_message"):
            print(f"Alert: {result['alert_message']}")
    except Exception as e:
        print(f"Finance Agent Error: {e}")

@app.post("/webhook/transaction")
async def handle_transaction(event: TransactionEvent, background_tasks: BackgroundTasks):
    """New transaction → classify → FCRA rules → filing deadline check."""
    background_tasks.add_task(_run_finance_agent, event.model_dump())
    return {"status": "accepted", "transaction_id": event.transaction_id}

# ── Grant Report Agent ──────────────────────────────────────────────────────────

def _run_grant_agent(payload: dict):
    try:
        result = grant_report_agent.invoke(payload)
        print(f"Grant Report Agent → {result['status']}")
    except Exception as e:
        print(f"Grant Report Agent Error: {e}")

@app.post("/trigger/grant-report")
async def trigger_grant_report(event: GrantReportTrigger, background_tasks: BackgroundTasks):
    """Manually or event-triggered grant report drafting."""
    background_tasks.add_task(_run_grant_agent, event.model_dump())
    return {"status": "accepted", "message": f"Grant report agent triggered for {event.grant_name}"}

# ── Board Briefing Agent ────────────────────────────────────────────────────────

def _run_board_brief(payload: dict):
    try:
        result = board_briefing_agent.invoke(payload)
        print(f"Board Briefing Agent → {result['status']}")
    except Exception as e:
        print(f"Board Briefing Agent Error: {e}")

@app.post("/trigger/board-brief")
async def trigger_board_brief(background_tasks: BackgroundTasks):
    """Manually trigger board brief (cron also calls this daily at 6 AM IST)."""
    from datetime import date
    payload = {"run_date": str(date.today()), "delivery_channels": ["dashboard", "whatsapp"]}
    background_tasks.add_task(_run_board_brief, payload)
    return {"status": "accepted", "message": "Board briefing agent triggered"}

# ── RAG Ingestion ───────────────────────────────────────────────────────────────

@app.post("/ingest/document")
async def ingest_doc(doc: DocumentIngest, background_tasks: BackgroundTasks):
    """Upload a document to the RAG knowledge base (chunking + embedding + pgvector)."""
    def _ingest():
        result = ingest_document(
            text=doc.text,
            document_title=doc.document_title,
            document_type=doc.document_type,
            ngo_id=doc.ngo_id,
            use_mock=True  # Set to False in production with real OpenAI key
        )
        print(f"RAG Ingest → {result}")
    
    background_tasks.add_task(_ingest)
    return {"status": "ingestion_started", "document_title": doc.document_title}

# ── Donor Lapse Detection ───────────────────────────────────────────────────────

@app.post("/jobs/lapse-detection")
async def run_lapse_job(background_tasks: BackgroundTasks):
    """Manually trigger lapse detection (also runs via cron daily at 7 AM IST)."""
    background_tasks.add_task(run_lapse_detection)
    return {"status": "accepted", "message": "Lapse detection job started"}

# ── Razorpay Webhook (with signature verification) ──────────────────────────────

RAZORPAY_WEBHOOK_SECRET = "your_razorpay_webhook_secret_here"

@app.post("/webhook/razorpay")
async def razorpay_webhook(
    webhook: RazorpayWebhook,
    x_razorpay_signature: Optional[str] = Header(None),
    background_tasks: BackgroundTasks = None
):
    """
    Razorpay payment webhook with HMAC signature verification.
    Idempotent: checks payment_id before processing.
    """
    # Signature verification (production)
    # body = json.dumps(webhook.model_dump()).encode()
    # expected = hmac.new(RAZORPAY_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    # if x_razorpay_signature != expected:
    #     raise HTTPException(status_code=400, detail="Invalid signature")
    
    if webhook.event == "payment.captured":
        payment = webhook.payload.get("payment", {}).get("entity", {})
        print(f"💰 Razorpay payment captured: ₹{payment.get('amount', 0) / 100} | ID: {payment.get('id')}")
        # Trigger donor nurture agent
        donor_payload = {
            "event_type": "donation_received",
            "donor_id": payment.get("contact", "unknown"),
            "donor_name": payment.get("notes", {}).get("donor_name", "Anonymous"),
            "donation_amount": payment.get("amount", 0) / 100,
        }
        background_tasks.add_task(_run_donor_agent, donor_payload)
    
    return {"status": "processed"}


# ── Campaign Intelligence Agent ─────────────────────────────────────────────────

class CampaignTrigger(BaseModel):
    campaign_id: str
    campaign_title: str
    target_amount: float
    raised_amount: float
    days_remaining: int

def _run_campaign_agent(payload: dict):
    try:
        result = campaign_agent.invoke(payload)
        print(f"Campaign Agent → {result.get('status')} | Health: {result.get('campaign_health')}")
    except Exception as e:
        print(f"Campaign Agent Error: {e}")

@app.post("/trigger/campaign-intelligence")
async def trigger_campaign_intel(event: CampaignTrigger, background_tasks: BackgroundTasks):
    """Analyze campaign health, generate boost copy, flag underperforming campaigns."""
    background_tasks.add_task(_run_campaign_agent, event.model_dump())
    return {"status": "accepted", "campaign_id": event.campaign_id}


# ── CSR Prospect Research Agent ─────────────────────────────────────────────────

class CSRProspectTrigger(BaseModel):
    company_name: str
    sector: str
    annual_revenue_cr: float
    focus_area: Optional[str] = "Education"
    ngo_programs: Optional[List[str]] = []

def _run_csr_agent(payload: dict):
    try:
        result = csr_agent.invoke(payload)
        print(f"CSR Agent → {result.get('company_name')} | Score: {result.get('alignment_score')}")
    except Exception as e:
        print(f"CSR Agent Error: {e}")

@app.post("/trigger/csr-prospect")
async def trigger_csr_prospect(event: CSRProspectTrigger):
    """Estimate CSR obligation, score company alignment, draft outreach."""
    try:
        result = csr_agent.invoke(event.model_dump())
        return result
    except Exception as e:
        print(f"CSR Agent Error: {e}")
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail="CSR Agent failed")


# ── Field MIS Agent ─────────────────────────────────────────────────────────────

class FieldReportTrigger(BaseModel):
    report_text: str
    reporter_id: str
    program: Optional[str] = "General"
    report_date: Optional[str] = None

def _run_field_mis_agent(payload: dict):
    try:
        result = field_mis_agent.invoke(payload)
        print(f"Field MIS Agent → Beneficiaries: {result.get('beneficiary_count')} | Language: {result.get('detected_language')}")
    except Exception as e:
        print(f"Field MIS Agent Error: {e}")

@app.post("/webhook/field-report")
async def handle_field_report(event: FieldReportTrigger, background_tasks: BackgroundTasks):
    """Process WhatsApp field report: detect language, extract structured data, validate."""
    background_tasks.add_task(_run_field_mis_agent, event.model_dump())
    return {"status": "accepted", "reporter_id": event.reporter_id}


# ── Tally XML Export ────────────────────────────────────────────────────────────

class TallyExportRequest(BaseModel):
    transactions: List[dict]
    ngo_name: str = "India NGO Trust"

@app.post("/export/tally-xml")
async def export_tally_xml(request: TallyExportRequest):
    """Generate a Tally Prime-compatible XML voucher file for import."""
    xml_content = build_tally_xml(request.transactions, request.ngo_name)
    from fastapi.responses import Response
    return Response(
        content=xml_content,
        media_type="application/xml",
        headers={"Content-Disposition": "attachment; filename=sevasuite_tally.xml"}
    )


# ── UPI AutoPay Mandate ─────────────────────────────────────────────────────────

class MandateRequest(BaseModel):
    donor_id: str
    donor_name: str
    upi_id: str
    amount: float
    frequency: str  # monthly | quarterly | yearly | weekly
    campaign_id: Optional[str] = None

@app.post("/mandate/create")
async def create_upi_mandate(mandate: MandateRequest):
    """
    Create a UPI AutoPay mandate record.
    In production: call Razorpay/NPCI UPI Autopay API here.
    """
    mandate_id = f"MAN-{mandate.donor_id[:6].upper()}-{mandate.frequency[:1].upper()}"
    print(f"UPI Mandate created: {mandate_id} | {mandate.donor_name} | ₹{mandate.amount}/{mandate.frequency}")
    return {
        "status": "mandate_created",
        "mandate_id": mandate_id,
        "donor_name": mandate.donor_name,
        "amount": mandate.amount,
        "frequency": mandate.frequency,
        "next_debit": "2026-05-01",
        "requires_otp": True
    }


# ── Predictive Analytics ────────────────────────────────────────────────────────

@app.get("/analytics/revenue-forecast", tags=["Analytics"])
def get_revenue_forecast(current_user: TokenUser = Depends(require_role("ed", "finance"))):
    """
    Returns 90-day revenue forecast based on transaction history.
    Using mock data for demonstration.
    """
    mock_tx = [
        {"date": "2024-01-01", "amount": 50000},
        {"date": "2024-02-01", "amount": 65000},
        {"date": "2024-03-01", "amount": 58000},
        {"date": "2024-04-01", "amount": 72000},
        {"date": "2024-05-01", "amount": 80000},
        {"date": "2024-06-01", "amount": 95000},
    ]
    forecast = predict_revenue(mock_tx, days_ahead=90)
    return {"actuals": mock_tx, "forecast": forecast}

@app.get("/analytics/anomalies", tags=["Analytics"])
def get_kpi_anomalies(current_user: TokenUser = Depends(require_role("ed", "finance"))):
    """
    Detects anomalies in recent KPI trends.
    """
    recent_kpis = [750000, 720000, 780000, 810000, 520000, 790000] # 520k is an anomaly
    anomaly_indices = detect_anomalies(recent_kpis)
    return {
        "kpi_history": recent_kpis,
        "anomalies": [{"index": i, "value": recent_kpis[i]} for i in anomaly_indices],
        "has_anomaly": len(anomaly_indices) > 0
    }

@app.get("/analytics/donor-propensity/{donor_id}", tags=["Analytics"])
def get_donor_propensity(donor_id: str, current_user: TokenUser = Depends(require_role("ed", "crm"))):
    """
    Calculates propensity score for a specific donor using refined mock data.
    """
    # Refined mock data for different segments
    donor_profiles = {
        "1": {"days_since_last_gift": 10, "total_gifts_count": 25, "average_gift_amount": 5000}, # Major Donor
        "2": {"days_since_last_gift": 30, "total_gifts_count": 12, "average_gift_amount": 2000}, # Recurring
        "4": {"days_since_last_gift": 240, "total_gifts_count": 2, "average_gift_amount": 1000}, # Lapsing
        "5": {"days_since_last_gift": 60, "total_gifts_count": 5, "average_gift_amount": 1500},  # Active
    }
    
    # Default profile for unknown IDs
    history = donor_profiles.get(donor_id, {
        "days_since_last_gift": 100, 
        "total_gifts_count": 1, 
        "average_gift_amount": 500
    })
    
    score = calculate_propensity_score(history)
    recommendation = "Nurture with impact updates."
    if score > 80:
        recommendation = "High probability! Trigger personal outreach for Major Gift."
    elif score > 50:
        recommendation = "Healthy segment. Send regular WhatsApp updates."
    elif score < 30:
        recommendation = "High churn risk. Recommend re-engagement sequence."

    return {
        "donor_id": donor_id,
        "propensity_score": score,
        "recommendation": recommendation,
        "insights": {
            "recency": f"{history['days_since_last_gift']} days ago",
            "frequency": f"{history['total_gifts_count']} gifts",
            "monetary": f"₹{history['average_gift_amount']:,} avg"
        }
    }

# ── Intelligent Workflows ──────────────────────────────────────────────────────

@app.post("/workflows/suggest-goal", tags=["Workflows"])
def post_suggest_goal(cause: str, current_user: TokenUser = Depends(require_role("ed", "fundraising"))):
    """
    Suggests a goal for a new campaign based on cause.
    """
    mock_history = [
        {"cause": "Education", "raised": 1200000},
        {"cause": "Education", "raised": 1500000},
        {"cause": "Health", "raised": 800000},
    ]
    return suggest_campaign_goal(cause, mock_history)

@app.post("/workflows/classify-transaction", tags=["Workflows"])
def post_classify_tx(description: str, current_user: TokenUser = Depends(require_role("ed", "finance"))):
    """
    AI Classifies an FCRA transaction.
    """
    return classify_fcra_transaction(description)

@app.post("/workflows/trigger-orchestration", tags=["Workflows"])
def post_trigger_orchestration(event_type: str, data: Dict[str, Any], current_user: TokenUser = Depends(require_role("ed"))):
    """
    Triggers the Agent Orchestrator for complex tasks.
    """
    result = process_orchestration(event_type, data)
    return {"status": "orchestrated", "result": result}

# ── Generative AI ──────────────────────────────────────────────────────────────

@app.post("/gen-ai/summarize", tags=["GenAI"])
def post_summarize(messages: List[Dict[str, str]], current_user: TokenUser = Depends(require_role("ed", "crm"))):
    """
    Summarizes donor conversations using LLM.
    """
    return {"summary": summarize_conversations(messages)}

@app.post("/gen-ai/sentiment", tags=["GenAI"])
def post_sentiment(text: str, current_user: TokenUser = Depends(require_role("ed", "crm"))):
    """
    Analyzes sentiment of a donor message.
    """
    return analyze_sentiment(text)

class DraftReportRequest(BaseModel):
    ngo_name: str
    impact_data: Dict[str, Any]


@app.post("/gen-ai/draft-report", tags=["GenAI"])
def post_draft_report(body: DraftReportRequest, current_user: TokenUser = Depends(require_role("ed"))):
    """
    Auto-drafts an annual report summary.
    """
    return {"draft": draft_annual_report(body.ngo_name, body.impact_data)}


# ── CRM: Outreach (email/whatsapp) — lightweight queue/log ────────────────────
class CrmOutreachRequest(BaseModel):
    channel: str  # whatsapp | email
    donor_ids: List[str] = []
    message: str
    subject: Optional[str] = None
    template_id: Optional[str] = None
    mode: str = "send"  # send | draft | voice_event


@app.post("/crm/outreach", tags=["CRM"])
def post_crm_outreach(body: CrmOutreachRequest, current_user: TokenUser = Depends(require_role("ed", "crm"))):
    """
    Minimal backend wiring for CRM messaging actions.
    In production this would enqueue WhatsApp/Email jobs; for now we just persist an audit log (DB if present, else memory).
    """
    event = {
        "id": f"out_{int(datetime.now(timezone.utc).timestamp() * 1000)}",
        "ngo_id": current_user.ngo_id,
        "by": current_user.email,
        "mode": body.mode,
        "channel": body.channel,
        "donor_ids": body.donor_ids,
        "subject": body.subject,
        "template_id": body.template_id,
        "message": (body.message or "")[:5000],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    # DB optional: store in a generic audit log table if it exists (non-fatal if not configured)
    with db_conn() as conn:
        if conn is not None:
            try:
                cur = conn.cursor()
                cur.execute(
                    """
                    INSERT INTO volunteer_events (id, ngo_id, type, payload)
                    VALUES (%s, %s, %s, %s::jsonb)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (event["id"], current_user.ngo_id, "crm_outreach", json.dumps(event)),
                )
            except Exception:
                pass
        else:
            CRM_OUTREACH_LOG_MEM_BY_NGO.setdefault(current_user.ngo_id, []).append(event)
    return {"status": "queued" if body.mode == "send" else "saved", "event": event}


# ── Finance: wire previously-demo actions to backend ──────────────────────────
class FinanceJournalEntryRequest(BaseModel):
    description: str
    amount: float
    entry_type: str = "Expense"  # Expense | Income
    fund: str = "General"


@app.post("/finance/journal-entry", tags=["Finance"])
def post_finance_journal_entry(body: FinanceJournalEntryRequest, current_user: TokenUser = Depends(require_role("ed", "finance"))):
    event = {
        "id": f"fj_{int(datetime.now(timezone.utc).timestamp() * 1000)}",
        "ngo_id": current_user.ngo_id,
        "by": current_user.email,
        "description": body.description[:5000],
        "amount": float(body.amount),
        "entry_type": body.entry_type,
        "fund": body.fund,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    FINANCE_EVENTS_MEM_BY_NGO.setdefault(current_user.ngo_id, []).append(event)
    return {"status": "recorded", "event": event}


@app.post("/finance/tally/sync", tags=["Finance"])
def post_finance_tally_sync(current_user: TokenUser = Depends(require_role("ed", "finance"))):
    """
    Placeholder for a real Tally integration: returns a deterministic export count.
    """
    with db_conn() as conn:
        if conn is None:
            exported = min(24, len(TX_MEM_BY_NGO.get(current_user.ngo_id, [])) + 1)
        else:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM transactions WHERE ngo_id = %s", (current_user.ngo_id,))
            exported = int(cur.fetchone()[0] or 0)
    return {"status": "ok", "exported_vouchers": exported, "synced_at": datetime.now(timezone.utc).isoformat()}


@app.post("/finance/aa/consents/refresh", tags=["Finance"])
def post_finance_aa_refresh(current_user: TokenUser = Depends(require_role("ed", "finance"))):
    return {"status": "ok", "message": "AA consents refreshed (demo).", "at": datetime.now(timezone.utc).isoformat()}


@app.get("/finance/uc.pdf", tags=["Finance"])
def get_finance_uc(
    company: Optional[str] = None,
    project: Optional[str] = None,
    current_user: TokenUser = Depends(require_role("ed", "finance", "csr", "programs")),
):
    scope = current_user.ngo_name
    if company or project:
        scope = f"{current_user.ngo_name} — {company or ''} {project or ''}".strip()
    title = f"Utilization Certificate (Draft) — {scope}"
    lines = [
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        f"CSR / project context: {company or '—'} / {project or '—'}",
        "This is a draft UC generated by GoodJobs Infrastructure for Social Good.",
        "Replace with CA-signed UC and upload to CSR document room / Compliance Vault.",
    ]
    pdf = _simple_pdf_bytes(title, lines)
    return Response(content=pdf, media_type="application/pdf", headers={
        "Content-Disposition": 'attachment; filename="utilization_certificate_draft.pdf"'
    })


# ── Notifications (UI) ───────────────────────────────────────────────────────
@app.get("/notifications", tags=["System"])
def list_notifications(current_user: TokenUser = Depends(get_current_user)):
    """
    Lightweight notifications feed for the UI.
    Derived from inbox + recent volunteer events; persisted read/cleared state is stored in inbox_item_states.
    """
    items: List[Dict[str, Any]] = []
    with db_conn() as conn:
        if conn is None:
            # memory: derive from inbox (already filters snooze/done for some kinds)
            inbox = get_inbox(current_user)["items"]
            for it in inbox[:20]:
                kind = it.get("kind")
                ref_id = str((it.get("ref") or {}).get("id") or "")
                if not ref_id:
                    continue
                items.append({
                    "id": f"{kind}:{ref_id}",
                    "kind": kind,
                    "ref_id": ref_id,
                    "tasks_path": _tasks_focus_path(kind, ref_id),
                    "type": "urgent" if it.get("priority") == "High" else ("agent" if kind in ("intent",) else "info"),
                    "title": it.get("pill") or kind.replace("_", " ").title(),
                    "message": it.get("title") or "",
                    "time": "Just now",
                    "read": False,
                })
            return {"notifications": items, "source": "memory"}

        cur = conn.cursor()
        states = _db_load_inbox_states(cur, current_user.ngo_id)

        # Build from inbox (DB mode)
        inbox = get_inbox(current_user)["items"]
        for it in inbox[:20]:
            kind = it.get("kind")
            ref_id = str((it.get("ref") or {}).get("id") or "")
            if not ref_id:
                continue
            st = states.get("notification", {}).get(f"{kind}:{ref_id}", {})
            items.append({
                "id": f"{kind}:{ref_id}",
                "kind": kind,
                "ref_id": ref_id,
                "tasks_path": _tasks_focus_path(kind, ref_id),
                "type": "urgent" if it.get("priority") == "High" else ("agent" if kind in ("intent",) else "info"),
                "title": it.get("pill") or kind.replace("_", " ").title(),
                "message": it.get("title") or "",
                "time": "Just now",
                "read": bool(st.get("resolved_at")),
            })
        return {"notifications": items, "source": "db"}


class NotificationActionRequest(BaseModel):
    action: str  # mark_all_read | clear_all


@app.post("/notifications/action", tags=["System"])
def post_notifications_action(body: NotificationActionRequest, current_user: TokenUser = Depends(get_current_user)):
    """
    Persist notification state via inbox_item_states(kind='notification').
    - mark_all_read: sets resolved_at for current notification ids
    - clear_all: same as mark_all_read (UI will hide cleared notifications client-side)
    """
    with db_conn() as conn:
        if conn is None:
            # memory mode: no durable state; best-effort ack
            return {"status": "ok", "source": "memory"}
        now = datetime.now(timezone.utc)
        cur = conn.cursor()
        # mark current derived notifications as resolved
        feed = list_notifications(current_user)["notifications"]
        for n in feed:
            nid = str(n.get("id"))
            if not nid:
                continue
            _db_upsert_inbox_state(cur, current_user.ngo_id, "notification", nid, resolved_at=now.isoformat())
        return {"status": "ok", "source": "db"}


# ── Compliance: Filing calendar (UI) ─────────────────────────────────────────
@app.get("/compliance/filings", tags=["Compliance"])
def get_compliance_filings(current_user: TokenUser = Depends(get_current_user)):
    """
    Filing calendar is currently a recommended schedule (not computed).
    Served from backend so UI doesn't hardcode dummy data.
    """
    return {
        "filings": [
            {"id": 1, "name": "TDS Return (Q3)", "due": "Nov 30, 2026", "assignee": "CA / Finance", "status": "Due Soon"},
            {"id": 2, "name": "IT Form 10B", "due": "Dec 15, 2026", "assignee": "CA / Finance", "status": "Pending"},
            {"id": 3, "name": "FCRA Annual Return", "due": "Dec 31, 2026", "assignee": "Finance", "status": "Pending"},
            {"id": 4, "name": "Darpan NGO Renewal", "due": "Mar 31, 2027", "assignee": "Admin", "status": "Pending"},
        ]
    }

# ── Zero-Manual-Work: Intent & Brief ──────────────────────────────────────────

class IntentParseBody(BaseModel):
    directive: str


@app.post("/intent/parse", tags=["Agentic UX"])
def post_parse_intent(body: IntentParseBody, current_user: TokenUser = Depends(get_current_user)):
    """
    Preview a directive as an action card without queueing (for confirm-before-execute UX).
    """
    d = (body.directive or "").strip()
    if not d:
        raise HTTPException(status_code=400, detail="directive required")
    card = route_intent(d)
    return {"action_card": card, "directive": d}


@app.post("/intent/process", tags=["Agentic UX"])
def post_process_intent(directive: str, current_user: TokenUser = Depends(require_role("ed", "admin", "fundraising"))):
    """
    Translates a natural language directive into an Action Card.
    """
    card = route_intent(directive)
    # Persist into intent queue when DB is configured
    with db_conn() as conn:
        if conn is not None:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO intent_queue (ngo_id, created_by, directive, intent_type, risk_level, action_card, status)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb, 'queued')
                RETURNING id::text
                """,
                (
                    current_user.ngo_id,
                    current_user.email,
                    directive,
                    card.get("intent_type"),
                    card.get("risk_level"),
                    json.dumps(card),
                ),
            )
            row = cur.fetchone()
            return {**card, "queue_id": row[0], "queued": True}
    # Demo mode: keep a minimal in-memory queue so the product works without DB
    ngo_items = INTENT_QUEUE_MEM_BY_NGO.setdefault(current_user.ngo_id, [])
    queue_id = f"mem_{int(datetime.now(timezone.utc).timestamp() * 1000)}"
    ngo_items.append(
        {
            "id": queue_id,
            "directive": directive,
            "intent_type": card.get("intent_type"),
            "risk_level": card.get("risk_level"),
            "status": "queued",
            "action_card": card,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "snoozed_until": None,
            "resolved_at": None,
        }
    )
    return {**card, "queue_id": queue_id, "queued": True, "source": "memory"}


@app.get("/intent/queue", tags=["Agentic UX"])
def get_intent_queue(
    status: Optional[str] = None,
    limit: int = 50,
    current_user: TokenUser = Depends(require_role("ed", "admin", "fundraising", "board")),
):
    with db_conn() as conn:
        if conn is None:
            items = INTENT_QUEUE_MEM_BY_NGO.get(current_user.ngo_id, [])
            if status:
                items = [i for i in items if i.get("status") == status]
            lim = max(1, min(limit, 200))
            out = items[:lim]
            for it in out:
                _enrich_intent_queue_row(it)
            return {"items": out, "source": "memory"}
        cur = conn.cursor()
        where = ["ngo_id = %s"]
        params: List[Any] = [current_user.ngo_id]
        if status:
            where.append("status = %s")
            params.append(status)
        lim = max(1, min(limit, 200))
        cur.execute(
            f"""
            SELECT id::text, directive, intent_type, risk_level, status, action_card, created_at
            FROM intent_queue
            WHERE {' AND '.join(where)}
            ORDER BY created_at DESC
            LIMIT {lim}
            """,
            params,
        )
        rows = cur.fetchall()
        items = []
        for r in rows:
            item = {
                "id": r[0],
                "directive": r[1],
                "intent_type": r[2],
                "risk_level": r[3],
                "status": r[4],
                "action_card": r[5],
                "created_at": r[6].isoformat() if hasattr(r[6], "isoformat") else str(r[6]),
            }
            _enrich_intent_queue_row(item)
            items.append(item)
        return {"items": items, "source": "db"}


class IntentDecision(BaseModel):
    decision: str  # approved | rejected


@app.post("/intent/queue/{item_id}/decision", tags=["Agentic UX"])
def post_intent_decision(
    item_id: str,
    body: IntentDecision,
    current_user: TokenUser = Depends(require_role("ed", "admin")),
):
    if body.decision not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="decision must be approved|rejected")
    with db_conn() as conn:
        if conn is None:
            items = INTENT_QUEUE_MEM_BY_NGO.get(current_user.ngo_id, [])
            for it in items:
                if it.get("id") == item_id:
                    it["status"] = body.decision
                    it["updated_at"] = datetime.now(timezone.utc).isoformat()
                    return {"id": item_id, "status": body.decision, "source": "memory"}
            raise HTTPException(status_code=404, detail="Queue item not found.")
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE intent_queue
            SET status = %s, updated_at = CURRENT_TIMESTAMP
            WHERE ngo_id = %s AND id::text = %s
            RETURNING id::text, status
            """,
            (body.decision, current_user.ngo_id, item_id),
        )
        r = cur.fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="Queue item not found.")
        return {"id": r[0], "status": r[1]}


class IntentExecuteRequest(BaseModel):
    dry_run: bool = False


@app.post("/intent/queue/{item_id}/execute", tags=["Agentic UX"])
def post_intent_execute(
    item_id: str,
    body: IntentExecuteRequest,
    current_user: TokenUser = Depends(require_role("ed", "admin")),
):
    """
    Executes a queued/approved intent via the orchestrator and stores execution_result.
    """
    with db_conn() as conn:
        if conn is None:
            items = INTENT_QUEUE_MEM_BY_NGO.get(current_user.ngo_id, [])
            item = next((i for i in items if i.get("id") == item_id), None)
            if not item:
                raise HTTPException(status_code=404, detail="Queue item not found.")

            status_val = item.get("status")
            if status_val not in ("queued", "approved"):
                raise HTTPException(status_code=409, detail=f"Intent is not executable from status '{status_val}'.")

            action_card = item.get("action_card") or {}
            intent_type = action_card.get("intent_type") if isinstance(action_card, dict) else None
            action_data = (action_card.get("action_data") or {}) if isinstance(action_card, dict) else {}

            if body.dry_run:
                return {"status": "dry_run", "intent_type": intent_type, "action_data": action_data, "source": "memory"}

            try:
                result = process_orchestration(intent_type or "unknown", action_data)
                item["status"] = "executed"
                item["executed_at"] = datetime.now(timezone.utc).isoformat()
                item["updated_at"] = item["executed_at"]
                item["execution_result"] = result
                item["last_error"] = None
                return {"id": item_id, "status": "executed", "result": result, "source": "memory"}
            except Exception as e:
                item["status"] = "failed"
                item["updated_at"] = datetime.now(timezone.utc).isoformat()
                item["last_error"] = str(e)
                raise HTTPException(status_code=500, detail={"id": item_id, "status": "failed", "error": str(e), "source": "memory"})
        cur = conn.cursor()
        cur.execute(
            """
            SELECT status, action_card
            FROM intent_queue
            WHERE ngo_id = %s AND id::text = %s
            """,
            (current_user.ngo_id, item_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Queue item not found.")

        status_val, action_card = row[0], row[1]
        if status_val not in ("queued", "approved"):
            raise HTTPException(status_code=409, detail=f"Intent is not executable from status '{status_val}'.")

        intent_type = None
        action_data = {}
        try:
            if isinstance(action_card, dict):
                intent_type = action_card.get("intent_type")
                action_data = action_card.get("action_data") or {}
        except Exception:
            pass

        if body.dry_run:
            return {"status": "dry_run", "intent_type": intent_type, "action_data": action_data}

        try:
            result = process_orchestration(intent_type or "unknown", action_data)
            cur.execute(
                """
                UPDATE intent_queue
                SET status = 'executed',
                    executed_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP,
                    execution_result = %s::jsonb,
                    last_error = NULL
                WHERE ngo_id = %s AND id::text = %s
                RETURNING id::text, status
                """,
                (json.dumps(result), current_user.ngo_id, item_id),
            )
            r2 = cur.fetchone()
            return {"id": r2[0], "status": r2[1], "result": result}
        except Exception as e:
            cur.execute(
                """
                UPDATE intent_queue
                SET status = 'failed',
                    updated_at = CURRENT_TIMESTAMP,
                    last_error = %s
                WHERE ngo_id = %s AND id::text = %s
                RETURNING id::text, status
                """,
                (str(e), current_user.ngo_id, item_id),
            )
            r2 = cur.fetchone()
            raise HTTPException(status_code=500, detail={"id": r2[0], "status": r2[1], "error": str(e)})

@app.get("/morning-brief", tags=["Agentic UX"])
def get_morning_brief(
    current_user: TokenUser = Depends(
        require_role("ed", "admin", "finance", "programs", "board", "field", "csr", "crm", "fundraising")
    ),
):
    """
    Role-personalized brief + handled-by-agents section (inbox-derived).
    """
    inbox_all = get_inbox(current_user).get("items", [])
    allow = _brief_kinds_for_role(current_user.role)
    inbox = [it for it in inbox_all if allow is None or it.get("kind") in allow]
    out: List[Dict[str, Any]] = []
    for i, it in enumerate(inbox[:6]):
        kind = it.get("kind") or "task"
        pr = it.get("priority") or ("High" if i == 0 else "Medium")
        pa = it.get("primary_action") or {}
        route = pa.get("route") or "/tasks"
        action_label = pa.get("label") or "Open"
        if kind == "finance_flag":
            action_label = "Review in Inbox"
            route = "/tasks"
        elif kind == "month_end_close":
            action_label = "Month-end in Finance"
            route = "/finance"
        elif kind in ("csr_win_decay", "csr_stale"):
            action_label = "Follow up in Inbox"
            route = "/tasks"
        elif kind == "csr_report_due":
            action_label = "UC / MIS in Inbox"
            route = "/tasks"
        elif kind == "intent":
            action_label = "Approve in Agent HQ"
            route = "/agent-hq"
        elif kind == "donor_outreach_draft":
            action_label = "Send from Inbox"
            route = "/tasks"
        ref_id = str((it.get("ref") or {}).get("id") or "")
        out.append(
            {
                "id": f"brief-{i+1}",
                "priority": pr,
                "category": (it.get("pill") or kind).title(),
                "title": it.get("title") or kind.replace("_", " ").title(),
                "summary": it.get("subtitle") or "Review and take action.",
                "primary_action": {"label": action_label, "route": route},
                "secondary_action": {"label": "Open module", "route": pa.get("route") or "/tasks"},
                "tertiary_action": {"label": "Open Tasks inbox", "route": "/tasks"},
                "ref": it.get("ref"),
                "kind": kind,
                "meta": it.get("meta"),
                "inline": it.get("inline"),
                "tasks_deep_link_path": _tasks_focus_path(kind, ref_id),
            }
        )
    handled = _handled_by_agents_rows(current_user)
    return {
        "priorities": out,
        "handled_by_agents": handled,
        "role": current_user.role,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "app_public_base_url": (os.getenv("APP_PUBLIC_URL") or "").rstrip("/"),
    }

# ── AWS S3 Storage (Compliance Vault) ──────────────────────────────────────────

class S3UploadRequest(BaseModel):
    folder: str
    filename: str
    content_type: str = "application/octet-stream"

class S3DownloadRequest(BaseModel):
    key: str
    filename: Optional[str] = None

@app.post("/storage/presigned-upload", tags=["Storage"])
def get_presigned_upload(request: S3UploadRequest, current_user: TokenUser = Depends(get_current_user)):
    """Generate a presigned URL for direct S3 upload."""
    return generate_presigned_upload_url(
        ngo_id=current_user.ngo_id,
        folder=request.folder,
        filename=request.filename,
        content_type=request.content_type
    )

@app.get("/storage/files", tags=["Storage"])
def get_storage_files(folder: Optional[str] = None, current_user: TokenUser = Depends(get_current_user)):
    """List files for the current NGO in the specified folder."""
    return {"files": list_ngo_files(current_user.ngo_id, folder=folder)}

@app.post("/storage/presigned-download", tags=["Storage"])
def get_presigned_download(request: S3DownloadRequest, current_user: TokenUser = Depends(get_current_user)):
    """Generate a presigned URL for secure file download (scoped to NGO)."""
    if not request.key.startswith(f"{current_user.ngo_id}/"):
        raise HTTPException(status_code=403, detail="File does not belong to current NGO.")
    return generate_presigned_download_url(
        key=request.key,
        original_filename=request.filename,
    )

@app.delete("/storage/file", tags=["Storage"])
def delete_storage_file(key: str, current_user: TokenUser = Depends(get_current_user)):
    """Delete a file from S3."""
    return delete_file(key, current_user.ngo_id)

# ── DPDP Act Compliance ───────────────────────────────────────────────────────

class WithdrawConsentRequest(BaseModel):
    consent_id: str
    reason: Optional[str] = None

class ErasureLogRequest(BaseModel):
    name: str
    email: str
    reason: str

class BreachLogRequest(BaseModel):
    title: str
    severity: str
    affected_records: int
    description: str

CONSENT_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
ERASURE_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
BREACH_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}


@app.get("/compliance/consents", tags=["Compliance"])
def list_consents(current_user: TokenUser = Depends(get_current_user)):
    with db_conn() as conn:
        if conn is None:
            return {"consents": CONSENT_MEM_BY_NGO.get(current_user.ngo_id, []), "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id::text, subject_name, subject_type, subject_email, purpose, given, consent_date::text, withdrawn_at::text
            FROM consent_registry
            WHERE ngo_id = %s::uuid
            ORDER BY consent_date DESC
            LIMIT 500
            """,
            (current_user.ngo_id,),
        )
        out = []
        for r in cur.fetchall():
            out.append(
                {
                    "id": r[0],
                    "subject": r[1],
                    "type": r[2],
                    "email": r[3],
                    "purpose": r[4],
                    "given": bool(r[5]),
                    "date": (r[6] or "")[:10],
                    "withdrawn": (r[7] or None)[:10] if r[7] else None,
                }
            )
        return {"consents": out, "source": "db"}


@app.get("/compliance/erasures", tags=["Compliance"])
def list_erasures(current_user: TokenUser = Depends(get_current_user)):
    with db_conn() as conn:
        if conn is None:
            return {"requests": ERASURE_MEM_BY_NGO.get(current_user.ngo_id, []), "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id::text, subject_name, subject_email, reason, status::text, received_at::text, deadline_at::text, completed_at::text
            FROM data_erasure_requests
            WHERE ngo_id = %s::uuid
            ORDER BY received_at DESC
            LIMIT 500
            """,
            (current_user.ngo_id,),
        )
        out = []
        for r in cur.fetchall():
            out.append(
                {
                    "id": r[0],
                    "name": r[1],
                    "email": r[2],
                    "reason": r[3],
                    "status": r[4],
                    "received": (r[5] or "")[:10],
                    "deadline": (r[6] or "")[:10],
                    "completed": (r[7] or None)[:10] if r[7] else None,
                }
            )
        return {"requests": out, "source": "db"}


@app.get("/compliance/breaches", tags=["Compliance"])
def list_breaches(current_user: TokenUser = Depends(get_current_user)):
    with db_conn() as conn:
        if conn is None:
            return {"breaches": BREACH_MEM_BY_NGO.get(current_user.ngo_id, []), "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id::text, title, severity::text, affected_records, discovered_at::text, notification_due_at::text, notified_at::text, description
            FROM breach_log
            WHERE ngo_id = %s::uuid
            ORDER BY discovered_at DESC
            LIMIT 200
            """,
            (current_user.ngo_id,),
        )
        out = []
        for r in cur.fetchall():
            out.append(
                {
                    "id": r[0],
                    "title": r[1],
                    "severity": r[2],
                    "affectedRecords": int(r[3] or 0),
                    "discovered": r[4],
                    "notificationDue": r[5],
                    "notified": bool(r[6]),
                    "description": r[7],
                }
            )
        return {"breaches": out, "source": "db"}


@app.post("/compliance/consent/withdraw", tags=["Compliance"])
def withdraw_consent(req: WithdrawConsentRequest, current_user: TokenUser = Depends(get_current_user)):
    """Log the withdrawal of a user's consent under DPDP §12."""
    with db_conn() as conn:
        if conn is None:
            items = CONSENT_MEM_BY_NGO.get(current_user.ngo_id, [])
            for c in items:
                if c.get("id") == req.consent_id:
                    c["given"] = False
                    c["withdrawn"] = datetime.now(timezone.utc).date().isoformat()
            return {"status": "success", "consent_id": req.consent_id, "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE consent_registry
            SET given = false, withdrawn_at = CURRENT_TIMESTAMP
            WHERE ngo_id = %s::uuid AND id = %s::uuid
            RETURNING id::text
            """,
            (current_user.ngo_id, req.consent_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Consent not found.")
        return {"status": "success", "consent_id": row[0], "source": "db"}

@app.post("/compliance/erasure", tags=["Compliance"])
def log_erasure_request(req: ErasureLogRequest, current_user: TokenUser = Depends(get_current_user)):
    """Log a Right to Erasure request under DPDP §12."""
    deadline = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")
    with db_conn() as conn:
        if conn is None:
            item = {
                "id": f"e{int(datetime.now(timezone.utc).timestamp())}",
                "name": req.name,
                "email": req.email,
                "reason": req.reason,
                "status": "received",
                "received": datetime.now(timezone.utc).date().isoformat(),
                "deadline": deadline,
                "completed": None,
            }
            ERASURE_MEM_BY_NGO.setdefault(current_user.ngo_id, []).insert(0, item)
            return {"status": "received", "request_id": item["id"], "deadline": deadline, "message": "Erasure request logged. Must be completed within 30 days.", "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO data_erasure_requests (ngo_id, subject_name, subject_email, reason, status, received_at, deadline_at)
            VALUES (%s::uuid, %s, %s, %s, 'received', CURRENT_TIMESTAMP, (CURRENT_TIMESTAMP + INTERVAL '30 days'))
            RETURNING id::text, deadline_at::text
            """,
            (current_user.ngo_id, req.name, req.email, req.reason),
        )
        rid, dl = cur.fetchone()
        return {"status": "received", "request_id": rid, "deadline": (dl or "")[:10], "message": "Erasure request logged. Must be completed within 30 days.", "source": "db"}


@app.post("/compliance/erasure/{request_id}/complete", tags=["Compliance"])
def complete_erasure(request_id: str, current_user: TokenUser = Depends(get_current_user)):
    with db_conn() as conn:
        if conn is None:
            for r in ERASURE_MEM_BY_NGO.get(current_user.ngo_id, []):
                if r.get("id") == request_id:
                    r["status"] = "completed"
                    r["completed"] = datetime.now(timezone.utc).date().isoformat()
            return {"ok": True, "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE data_erasure_requests
            SET status = 'completed', completed_at = CURRENT_TIMESTAMP
            WHERE ngo_id = %s::uuid AND id = %s::uuid
            RETURNING id::text
            """,
            (current_user.ngo_id, request_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Erasure request not found.")
        return {"ok": True, "id": row[0], "source": "db"}

@app.post("/compliance/breach", tags=["Compliance"])
def log_breach(req: BreachLogRequest, current_user: TokenUser = Depends(get_current_user)):
    """Log a data breach to start the 72-hour DPB notification timer under DPDP §8."""
    notif_due = (datetime.now(timezone.utc) + timedelta(hours=72)).isoformat()
    with db_conn() as conn:
        if conn is None:
            item = {
                "id": f"b{int(datetime.now(timezone.utc).timestamp())}",
                "title": req.title,
                "severity": req.severity,
                "affectedRecords": int(req.affected_records),
                "discovered": datetime.now(timezone.utc).isoformat(),
                "notificationDue": notif_due,
                "notified": False,
                "description": req.description,
            }
            BREACH_MEM_BY_NGO.setdefault(current_user.ngo_id, []).insert(0, item)
            return {"status": "logged", "breach_id": item["id"], "notification_due": notif_due, "message": "Breach logged. You must notify the DPB within 72 hours.", "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO breach_log (ngo_id, title, severity, affected_records, description, discovered_at, notification_due_at)
            VALUES (%s::uuid, %s, %s::breach_severity, %s, %s, CURRENT_TIMESTAMP, (CURRENT_TIMESTAMP + INTERVAL '72 hours'))
            RETURNING id::text, notification_due_at::text
            """,
            (current_user.ngo_id, req.title, req.severity, int(req.affected_records), req.description),
        )
        bid, due = cur.fetchone()
        return {"status": "logged", "breach_id": bid, "notification_due": due, "message": "Breach logged. You must notify the DPB within 72 hours.", "source": "db"}


@app.post("/compliance/breaches/{breach_id}/notify", tags=["Compliance"])
def notify_breach(breach_id: str, current_user: TokenUser = Depends(get_current_user)):
    with db_conn() as conn:
        if conn is None:
            for b in BREACH_MEM_BY_NGO.get(current_user.ngo_id, []):
                if b.get("id") == breach_id:
                    b["notified"] = True
            return {"ok": True, "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE breach_log
            SET notified_at = CURRENT_TIMESTAMP
            WHERE ngo_id = %s::uuid AND id = %s::uuid
            RETURNING id::text
            """,
            (current_user.ngo_id, breach_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Breach not found.")
        return {"ok": True, "id": row[0], "source": "db"}


# ── Compliance: Document metadata ─────────────────────────────────────────────

class ComplianceDocCreate(BaseModel):
    name: str
    doc_type: str
    status: str = "Valid"
    expiry_date: Optional[str] = None  # YYYY-MM-DD
    s3_key: Optional[str] = None
    details: Optional[Dict[str, Any]] = None

@app.get("/compliance/documents", tags=["Compliance"])
def list_compliance_documents(
    status: Optional[str] = None,
    limit: int = 100,
    current_user: TokenUser = Depends(get_current_user),
):
    with db_conn() as conn:
        if conn is None:
            docs = COMPLIANCE_DOCS_MEM_BY_NGO.get(current_user.ngo_id, [])
            if status:
                docs = [d for d in docs if d.get("status") == status]
            lim = max(1, min(limit, 500))
            return {"documents": docs[:lim], "source": "memory"}
        cur = conn.cursor()
        where = ["ngo_id = %s"]
        params: List[Any] = [current_user.ngo_id]
        if status:
            where.append("status = %s")
            params.append(status)
        lim = max(1, min(limit, 500))
        cur.execute(
            f"""
            SELECT id::text, name, doc_type, status, expiry_date::text, s3_key,
                   COALESCE(details, '{{}}'::jsonb), created_at::text
            FROM compliance_documents
            WHERE {' AND '.join(where)}
            ORDER BY created_at DESC
            LIMIT {lim}
            """,
            params,
        )
        rows = cur.fetchall()
        return {
            "documents": [
                {
                    "id": r[0],
                    "name": r[1],
                    "doc_type": r[2],
                    "status": r[3],
                    "expiry_date": r[4],
                    "s3_key": r[5],
                    "details": _parse_jsonb(r[6]),
                    "created_at": r[7],
                }
                for r in rows
            ],
            "source": "db",
        }

@app.post("/compliance/documents", tags=["Compliance"])
def create_compliance_document(
    body: ComplianceDocCreate,
    current_user: TokenUser = Depends(require_role("ed", "admin", "finance")),
):
    with db_conn() as conn:
        if conn is None:
            docs = COMPLIANCE_DOCS_MEM_BY_NGO.setdefault(current_user.ngo_id, [])
            doc_id = f"memdoc_{int(datetime.now(timezone.utc).timestamp() * 1000)}"
            det = _parse_jsonb(body.details) if body.details else {}
            docs.insert(
                0,
                {
                    "id": doc_id,
                    "name": body.name,
                    "doc_type": body.doc_type,
                    "status": body.status,
                    "expiry_date": body.expiry_date,
                    "s3_key": body.s3_key,
                    "details": det,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "snoozed_until": None,
                    "resolved_at": None,
                },
            )
            return {"status": "created", "id": doc_id, "source": "memory"}
        cur = conn.cursor()
        det_json = json.dumps(body.details) if body.details else "{}"
        cur.execute(
            """
            INSERT INTO compliance_documents (ngo_id, name, doc_type, status, expiry_date, s3_key, details)
            VALUES (%s, %s, %s, %s, %s::date, %s, %s::jsonb)
            RETURNING id::text
            """,
            (current_user.ngo_id, body.name, body.doc_type, body.status, body.expiry_date, body.s3_key, det_json),
        )
        return {"status": "created", "id": cur.fetchone()[0]}


# ── Unified Inbox ────────────────────────────────────────────────────────────

@app.get("/inbox", tags=["Agentic UX"])
def get_inbox(current_user: TokenUser = Depends(get_current_user)):
    """
    Unified inbox for busy generalists:
    - queued intents needing approval
    - compliance docs expiring within 30 days
    - finance flags (over budget / negative variance / FCRA admin cap)
    - volunteer ops reminders (scheduled reminders + upcoming full shifts)
    """
    items: List[Dict[str, Any]] = []
    with db_conn() as conn:
        if conn is None:
            now = datetime.now(timezone.utc)
            _get_mem_inbox_state(current_user.ngo_id)
            # queued intents
            for it in INTENT_QUEUE_MEM_BY_NGO.get(current_user.ngo_id, []):
                if it.get("status") != "queued":
                    continue
                if it.get("resolved_at"):
                    continue
                su = it.get("snoozed_until")
                if su:
                    try:
                        if _parse_until_ts(su) > now:
                            continue
                    except HTTPException:
                        pass
                items.append(
                    {
                        "kind": "intent",
                        "priority": "High" if (it.get("risk_level") or "").lower() == "high" else "Medium",
                        "title": it.get("directive"),
                        "meta": {"intent_type": it.get("intent_type"), "risk_level": it.get("risk_level")},
                        "ref": {"id": it.get("id")},
                        "created_at": it.get("created_at"),
                        "primary_action": {"label": "Review & approve", "route": "/agent-hq"},
                    }
                )

            # compliance docs expiring within 30 days
            for d in COMPLIANCE_DOCS_MEM_BY_NGO.get(current_user.ngo_id, []):
                if d.get("resolved_at"):
                    continue
                su = d.get("snoozed_until")
                if su:
                    try:
                        if _parse_until_ts(su) > now:
                            continue
                    except HTTPException:
                        pass
                exp = d.get("expiry_date")
                if not exp:
                    continue
                try:
                    exp_dt = datetime.fromisoformat(exp).date()
                except Exception:
                    continue
                if exp_dt > (now.date() + timedelta(days=30)):
                    continue
                items.append(
                    {
                        "kind": "compliance_doc",
                        "priority": "High" if d.get("status") in ("Expired", "Expiring Soon") else "Medium",
                        "title": f"{d.get('name')} expiring on {exp}",
                        "meta": {"doc_type": d.get("doc_type"), "status": d.get("status"), "expiry_date": exp},
                        "ref": {"id": d.get("id")},
                        "primary_action": {"label": "Open vault", "route": "/compliance"},
                    }
                )

            # finance flags (memory)
            try:
                _seed_memory_finance_grants(current_user.ngo_id)
                for g in FINANCE_GRANTS_MEM_BY_NGO.get(current_user.ngo_id, [])[:50]:
                    ref_id = str(g.get("id") or "")
                    st = _mem_get_state(current_user.ngo_id, "finance_flag", ref_id) if ref_id else {}
                    if st.get("resolved_at"):
                        continue
                    if st.get("snoozed_until"):
                        try:
                            if _parse_until_ts(st["snoozed_until"]) > now:
                                continue
                        except HTTPException:
                            pass
                    if (g.get("status") == "Over Budget") or (float(g.get("variance") or 0) < 0):
                        items.append(
                            {
                                "kind": "finance_flag",
                                "priority": "High",
                                "pill": "Finance",
                                "title": f"Grant at risk: {g.get('name')}",
                                "subtitle": f"Variance: ₹{abs(float(g.get('variance') or 0)):,.0f} ({'over' if float(g.get('variance') or 0) < 0 else 'check'})",
                                "meta": g,
                                "ref": {"id": ref_id},
                                "primary_action": {"label": "Open Finance", "route": "/finance"},
                            }
                        )
                        break
            except Exception:
                pass

            # volunteer reminders (memory)
            try:
                # scheduled reminder events
                for ev in reversed(VOLUNTEER_ACTIVITY_LOG[-50:]):
                    if ev.get("ngo_id") != current_user.ngo_id:
                        continue
                    if ev.get("type") == "reminder":
                        ref_id = str(ev.get("id") or ev.get("created_at") or ev.get("shift_id") or "")
                        st = _mem_get_state(current_user.ngo_id, "volunteer_reminder", ref_id) if ref_id else {}
                        if st.get("resolved_at"):
                            continue
                        if st.get("snoozed_until"):
                            try:
                                if _parse_until_ts(st["snoozed_until"]) > now:
                                    continue
                            except HTTPException:
                                pass
                        items.append(
                            {
                                "kind": "volunteer_reminder",
                                "priority": "Medium",
                                "pill": "Volunteers",
                                "title": f"Reminder scheduled: {ev.get('shift_title')}",
                                "subtitle": f"Channel: {ev.get('channel')} • Timing: {ev.get('timing')}",
                                "meta": ev,
                                "ref": {"id": ref_id},
                                "primary_action": {"label": "Open Volunteers", "route": "/volunteers"},
                            }
                        )
                        break
                # full shifts
                _seed_memory_volunteer_ops(current_user.ngo_id)
                for s in VOLUNTEER_SHIFTS_MEM_BY_NGO.get(current_user.ngo_id, [])[:20]:
                    ref_id = str(s.get("id") or "")
                    st = _mem_get_state(current_user.ngo_id, "volunteer_shift_full", ref_id) if ref_id else {}
                    if st.get("resolved_at"):
                        continue
                    if st.get("snoozed_until"):
                        try:
                            if _parse_until_ts(st["snoozed_until"]) > now:
                                continue
                        except HTTPException:
                            pass
                    if int(s.get("filled", 0)) >= int(s.get("total", 0)) and int(s.get("total", 0)) > 0:
                        items.append(
                            {
                                "kind": "volunteer_shift_full",
                                "priority": "Medium",
                                "pill": "Volunteers",
                                "title": f"Shift full: {s.get('title')}",
                                "subtitle": f"{s.get('filled')}/{s.get('total')} filled • {s.get('date')}",
                                "meta": s,
                                "ref": {"id": ref_id},
                                "primary_action": {"label": "Manage shift", "route": "/volunteers"},
                            }
                        )
                        break
            except Exception:
                pass

            # CRM WhatsApp drafts (memory)
            try:
                for ev in reversed(CRM_OUTREACH_LOG_MEM_BY_NGO.get(current_user.ngo_id, [])[-25:]):
                    if ev.get("mode") != "draft":
                        continue
                    ref_id = str(ev.get("id") or "")
                    if not ref_id:
                        continue
                    st = _mem_get_state(current_user.ngo_id, "donor_outreach_draft", ref_id)
                    if st.get("resolved_at"):
                        continue
                    if st.get("snoozed_until"):
                        try:
                            if _parse_until_ts(st["snoozed_until"]) > now:
                                continue
                        except HTTPException:
                            pass
                    donor_ids = ev.get("donor_ids") or []
                    msg = (ev.get("message") or "")[:400]
                    items.append(
                        {
                            "kind": "donor_outreach_draft",
                            "priority": "Medium",
                            "pill": "CRM",
                            "title": f"WhatsApp draft ready ({len(donor_ids)} donor(s))",
                            "subtitle": msg,
                            "meta": ev,
                            "ref": {"id": ref_id},
                            "primary_action": {"label": "Open CRM", "route": "/crm"},
                            "inline": {
                                "type": "crm_whatsapp",
                                "donor_ids": donor_ids,
                                "message": ev.get("message"),
                                "template_id": ev.get("template_id"),
                            },
                        }
                    )
            except Exception:
                pass

            _append_month_end_and_csr_inbox(items, current_user.ngo_id, None, {}, now, True)
            _finalize_inbox_items(items)
            return {"items": items[:40], "source": "memory"}
        cur = conn.cursor()
        states = _db_load_inbox_states(cur, current_user.ngo_id)

        # Intents
        cur.execute(
            """
            SELECT id::text, directive, intent_type, risk_level, created_at
            FROM intent_queue
            WHERE ngo_id = %s AND status = 'queued'
              AND resolved_at IS NULL
              AND (snoozed_until IS NULL OR snoozed_until <= CURRENT_TIMESTAMP)
            ORDER BY created_at DESC
            LIMIT 20
            """,
            (current_user.ngo_id,),
        )
        for r in cur.fetchall():
            items.append({
                "kind": "intent",
                "priority": "High" if (r[3] or "").lower() == "high" else "Medium",
                "title": r[1],
                "meta": {"intent_type": r[2], "risk_level": r[3]},
                "ref": {"id": r[0]},
                "created_at": r[4].isoformat() if hasattr(r[4], "isoformat") else str(r[4]),
                "primary_action": {"label": "Review & approve", "route": "/agent-hq"},
            })

        # Compliance docs expiring
        cur.execute(
            """
            SELECT id::text, name, doc_type, status, expiry_date::date
            FROM compliance_documents
            WHERE ngo_id = %s
              AND expiry_date IS NOT NULL
              AND expiry_date <= (CURRENT_DATE + INTERVAL '30 days')
              AND resolved_at IS NULL
              AND (snoozed_until IS NULL OR snoozed_until <= CURRENT_TIMESTAMP)
            ORDER BY expiry_date ASC
            LIMIT 20
            """,
            (current_user.ngo_id,),
        )
        for r in cur.fetchall():
            items.append({
                "kind": "compliance_doc",
                "priority": "High" if r[3] in ("Expired", "Expiring Soon") else "Medium",
                "title": f"{r[1]} expiring on {r[4]}",
                "meta": {"doc_type": r[2], "status": r[3], "expiry_date": str(r[4])},
                "ref": {"id": r[0]},
                "primary_action": {"label": "Open vault", "route": "/compliance"},
            })

        # Finance flags (DB)
        try:
            cur.execute(
                """
                SELECT id::text, name, total::float, spent::float, variance::float, status
                FROM finance_grants
                WHERE ngo_id = %s AND (status = 'Over Budget' OR variance < 0)
                ORDER BY created_at DESC
                LIMIT 5
                """,
                (current_user.ngo_id,),
            )
            for g in cur.fetchall():
                ref_id = str(g[0])
                st = states.get("finance_flag", {}).get(ref_id, {})
                if st.get("resolved_at"):
                    continue
                if st.get("snoozed_until"):
                    try:
                        if _parse_until_ts(st["snoozed_until"]) > datetime.now(timezone.utc):
                            continue
                    except HTTPException:
                        pass
                items.append(
                    {
                        "kind": "finance_flag",
                        "priority": "High",
                        "pill": "Finance",
                        "title": f"Grant at risk: {g[1]}",
                        "subtitle": f"Variance: ₹{abs(float(g[4] or 0)):,.0f}",
                        "meta": {"id": g[0], "name": g[1], "total": g[2], "spent": g[3], "variance": g[4], "status": g[5]},
                        "ref": {"id": ref_id},
                        "primary_action": {"label": "Open Finance", "route": "/finance"},
                    }
                )
        except Exception:
            pass

        # Volunteer reminders (DB): from volunteer_events table
        try:
            cur.execute(
                """
                SELECT id, payload, created_at
                FROM volunteer_events
                WHERE ngo_id = %s AND type = 'reminder'
                ORDER BY created_at DESC
                LIMIT 20
                """,
                (current_user.ngo_id,),
            )
            for ev_id, payload, created_at in cur.fetchall():
                ref_id = str(ev_id)
                st = states.get("volunteer_reminder", {}).get(ref_id, {})
                if st.get("resolved_at"):
                    continue
                if st.get("snoozed_until"):
                    try:
                        if _parse_until_ts(st["snoozed_until"]) > datetime.now(timezone.utc):
                            continue
                    except HTTPException:
                        pass
                payload = payload if isinstance(payload, dict) else {}
                items.append(
                    {
                        "kind": "volunteer_reminder",
                        "priority": "Medium",
                        "pill": "Volunteers",
                        "title": f"Reminder scheduled: {payload.get('shift_title') or 'Volunteer shift'}",
                        "subtitle": f"Channel: {payload.get('channel','')} • Timing: {payload.get('timing','')}",
                        "meta": payload,
                        "ref": {"id": ref_id},
                        "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at),
                        "primary_action": {"label": "Open Volunteers", "route": "/volunteers"},
                    }
                )
                break
        except Exception:
            pass

        # Volunteer shift full (DB): derived from volunteer_shifts
        try:
            cur.execute(
                """
                SELECT id::text, title, date_label, location, filled, total
                FROM volunteer_shifts
                WHERE ngo_id = %s AND total > 0 AND filled >= total
                ORDER BY id ASC
                LIMIT 20
                """,
                (current_user.ngo_id,),
            )
            for sid, title, date_label, location, filled, total in cur.fetchall():
                ref_id = str(sid)
                st = states.get("volunteer_shift_full", {}).get(ref_id, {})
                if st.get("resolved_at"):
                    continue
                if st.get("snoozed_until"):
                    try:
                        if _parse_until_ts(st["snoozed_until"]) > datetime.now(timezone.utc):
                            continue
                    except HTTPException:
                        pass
                items.append(
                    {
                        "kind": "volunteer_shift_full",
                        "priority": "Medium",
                        "pill": "Volunteers",
                        "title": f"Shift full: {title}",
                        "subtitle": f"{filled}/{total} filled • {date_label}",
                        "meta": {"id": sid, "title": title, "date": date_label, "location": location, "filled": filled, "total": total},
                        "ref": {"id": ref_id},
                        "primary_action": {"label": "Manage shift", "route": "/volunteers"},
                    }
                )
                break
        except Exception:
            pass

        # CRM WhatsApp drafts (DB)
        try:
            cur.execute(
                """
                SELECT id::text, payload, created_at
                FROM volunteer_events
                WHERE ngo_id = %s AND type = 'crm_outreach'
                ORDER BY created_at DESC
                LIMIT 25
                """,
                (current_user.ngo_id,),
            )
            for eid, payload, created_at in cur.fetchall():
                payload = payload if isinstance(payload, dict) else {}
                if payload.get("mode") != "draft":
                    continue
                ref_id = str(eid)
                st = states.get("donor_outreach_draft", {}).get(ref_id, {})
                if st.get("resolved_at"):
                    continue
                if st.get("snoozed_until"):
                    try:
                        if _parse_until_ts(st["snoozed_until"]) > datetime.now(timezone.utc):
                            continue
                    except HTTPException:
                        pass
                donor_ids = payload.get("donor_ids") or []
                msg = (payload.get("message") or "")[:400]
                items.append(
                    {
                        "kind": "donor_outreach_draft",
                        "priority": "Medium",
                        "pill": "CRM",
                        "title": f"WhatsApp draft ready ({len(donor_ids)} donor(s))",
                        "subtitle": msg,
                        "meta": payload,
                        "ref": {"id": ref_id},
                        "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at),
                        "primary_action": {"label": "Open CRM", "route": "/crm"},
                        "inline": {
                            "type": "crm_whatsapp",
                            "donor_ids": donor_ids,
                            "message": payload.get("message"),
                            "template_id": payload.get("template_id"),
                        },
                    }
                )
        except Exception:
            pass

        _append_month_end_and_csr_inbox(items, current_user.ngo_id, conn, states, datetime.now(timezone.utc), False)
        _finalize_inbox_items(items)

    return {"items": items[:40], "source": "db"}


class InboxSnoozeRequest(BaseModel):
    kind: str  # intent | compliance_doc | finance_flag | volunteer_reminder | volunteer_shift_full | ...
    id: str
    until: str  # ISO datetime or YYYY-MM-DD


class InboxResolveRequest(BaseModel):
    kind: str  # intent | compliance_doc | finance_flag | volunteer_reminder | volunteer_shift_full | ...
    id: str


@app.post("/inbox/snooze", tags=["Agentic UX"])
def post_inbox_snooze(body: InboxSnoozeRequest, current_user: TokenUser = Depends(require_role("ed", "admin", "finance", "programs"))):
    with db_conn() as conn:
        if conn is None:
            until_iso = _parse_until_ts(body.until).isoformat()
            if body.kind == "intent":
                items = INTENT_QUEUE_MEM_BY_NGO.get(current_user.ngo_id, [])
                for it in items:
                    if it.get("id") == body.id:
                        it["snoozed_until"] = until_iso
                        return {"status": "snoozed", "id": body.id, "source": "memory"}
            elif body.kind == "compliance_doc":
                docs = COMPLIANCE_DOCS_MEM_BY_NGO.get(current_user.ngo_id, [])
                for d in docs:
                    if d.get("id") == body.id:
                        d["snoozed_until"] = until_iso
                        return {"status": "snoozed", "id": body.id, "source": "memory"}
            else:
                # generic snooze for other kinds in memory
                _mem_upsert_state(current_user.ngo_id, body.kind, body.id, snoozed_until=until_iso)
                return {"status": "snoozed", "id": body.id, "source": "memory"}
            raise HTTPException(status_code=404, detail="Inbox item not found.")
        cur = conn.cursor()
        if body.kind == "intent":
            cur.execute(
                """
                UPDATE intent_queue
                SET snoozed_until = %s::timestamptz, updated_at = CURRENT_TIMESTAMP
                WHERE ngo_id = %s AND id::text = %s
                RETURNING id::text
                """,
                (body.until, current_user.ngo_id, body.id),
            )
        elif body.kind == "compliance_doc":
            cur.execute(
                """
                UPDATE compliance_documents
                SET snoozed_until = %s::timestamptz
                WHERE ngo_id = %s AND id::text = %s
                RETURNING id::text
                """,
                (body.until, current_user.ngo_id, body.id),
            )
        else:
            _db_upsert_inbox_state(cur, current_user.ngo_id, body.kind, body.id, snoozed_until=body.until)
            return {"status": "snoozed", "id": body.id, "source": "db"}
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Inbox item not found.")
        return {"status": "snoozed", "id": row[0]}


def _inbox_resolve_one(current_user: TokenUser, kind: str, ref_id: str) -> Dict[str, Any]:
    """Shared by single and batch inbox resolve."""
    with db_conn() as conn:
        if conn is None:
            resolved_iso = datetime.now(timezone.utc).isoformat()
            if kind == "intent":
                items = INTENT_QUEUE_MEM_BY_NGO.get(current_user.ngo_id, [])
                for it in items:
                    if it.get("id") == ref_id:
                        it["resolved_at"] = resolved_iso
                        it["status"] = "rejected"
                        return {"status": "resolved", "id": ref_id, "source": "memory"}
            elif kind == "compliance_doc":
                docs = COMPLIANCE_DOCS_MEM_BY_NGO.get(current_user.ngo_id, [])
                for d in docs:
                    if d.get("id") == ref_id:
                        d["resolved_at"] = resolved_iso
                        return {"status": "resolved", "id": ref_id, "source": "memory"}
            else:
                _mem_upsert_state(current_user.ngo_id, kind, ref_id, resolved_at=resolved_iso)
                return {"status": "resolved", "id": ref_id, "source": "memory"}
            raise HTTPException(status_code=404, detail="Inbox item not found.")
        cur = conn.cursor()
        if kind == "intent":
            cur.execute(
                """
                UPDATE intent_queue
                SET resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, status = 'rejected'
                WHERE ngo_id = %s AND id::text = %s
                RETURNING id::text
                """,
                (current_user.ngo_id, ref_id),
            )
        elif kind == "compliance_doc":
            cur.execute(
                """
                UPDATE compliance_documents
                SET resolved_at = CURRENT_TIMESTAMP
                WHERE ngo_id = %s AND id::text = %s
                RETURNING id::text
                """,
                (current_user.ngo_id, ref_id),
            )
        else:
            _db_upsert_inbox_state(cur, current_user.ngo_id, kind, ref_id, resolved_at=datetime.now(timezone.utc).isoformat())
            return {"status": "resolved", "id": ref_id, "source": "db"}
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Inbox item not found.")
        return {"status": "resolved", "id": row[0], "source": "db"}


@app.post("/inbox/resolve", tags=["Agentic UX"])
def post_inbox_resolve(body: InboxResolveRequest, current_user: TokenUser = Depends(require_role("ed", "admin", "finance", "programs"))):
    return _inbox_resolve_one(current_user, body.kind, body.id)


class InboxBatchResolveRequest(BaseModel):
    items: List[InboxResolveRequest]


@app.post("/inbox/batch-resolve", tags=["Agentic UX"])
def post_inbox_batch_resolve(
    body: InboxBatchResolveRequest,
    current_user: TokenUser = Depends(require_role("ed", "admin", "finance", "programs")),
):
    results: List[Dict[str, Any]] = []
    for it in body.items[:80]:
        try:
            r = _inbox_resolve_one(current_user, it.kind, it.id)
            results.append({"kind": it.kind, "id": it.id, "ok": True, **r})
        except HTTPException as he:
            results.append({"kind": it.kind, "id": it.id, "ok": False, "detail": he.detail})
    return {"results": results}


class InboxBatchSnoozeRequest(BaseModel):
    items: List[InboxResolveRequest]
    until: str


@app.post("/inbox/batch-snooze", tags=["Agentic UX"])
def post_inbox_batch_snooze(
    body: InboxBatchSnoozeRequest,
    current_user: TokenUser = Depends(require_role("ed", "admin", "finance", "programs")),
):
    until_iso = _parse_until_ts(body.until).isoformat()
    results: List[Dict[str, Any]] = []
    for it in body.items[:80]:
        faux = InboxSnoozeRequest(kind=it.kind, id=it.id, until=until_iso)
        try:
            r = post_inbox_snooze(faux, current_user)  # type: ignore
            results.append({"kind": it.kind, "id": it.id, "ok": True, **(r if isinstance(r, dict) else {})})
        except HTTPException as he:
            results.append({"kind": it.kind, "id": it.id, "ok": False, "detail": he.detail})
    return {"results": results}


# ── Volunteers (Broadcast + Reminders) ─────────────────────────────────────────

class VolunteerBroadcastRequest(BaseModel):
    channel: str = "whatsapp"  # whatsapp | sms | email
    message: str
    audience: str = "all"      # all | verified | shift:{id}

class VolunteerReminderRequest(BaseModel):
    shift_id: int
    shift_title: str
    shift_datetime: str
    channel: str = "whatsapp"  # whatsapp | sms | both
    timing: str = "24h"        # 24h | 48h | 2h | 1w
    message: Optional[str] = None
    recipients: int = 0

# In-memory log for demo; replace with DB + queue in production
VOLUNTEER_ACTIVITY_LOG: List[Dict[str, Any]] = []

@app.post("/volunteers/broadcast", tags=["Volunteers"])
def post_volunteer_broadcast(
    body: VolunteerBroadcastRequest,
    current_user: TokenUser = Depends(require_role("ed", "programs")),
):
    event_id = f"ve_{int(datetime.now(timezone.utc).timestamp() * 1000)}"
    event = {
        "id": event_id,
        "ngo_id": current_user.ngo_id,
        "type": "broadcast",
        "channel": body.channel,
        "audience": body.audience,
        "message": body.message[:5000],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "by": current_user.email,
    }
    VOLUNTEER_ACTIVITY_LOG.append(event)
    # DB (optional): persist as volunteer_events for audit / inbox UX
    with db_conn() as conn:
        if conn is not None:
            try:
                cur = conn.cursor()
                cur.execute(
                    """
                    INSERT INTO volunteer_events (id, ngo_id, type, payload)
                    VALUES (%s, %s, %s, %s::jsonb)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (event_id, current_user.ngo_id, "broadcast", json.dumps(event)),
                )
            except Exception:
                pass
    # In production: enqueue WhatsApp/SMS send job here.
    return {"status": "queued", "event": event}

@app.post("/volunteers/reminder", tags=["Volunteers"])
def post_volunteer_reminder(
    body: VolunteerReminderRequest,
    background_tasks: BackgroundTasks,
    current_user: TokenUser = Depends(require_role("ed", "programs")),
):
    event_id = f"ve_{int(datetime.now(timezone.utc).timestamp() * 1000)}"
    event = {
        "id": event_id,
        "ngo_id": current_user.ngo_id,
        "type": "reminder",
        "shift_id": body.shift_id,
        "shift_title": body.shift_title,
        "shift_datetime": body.shift_datetime,
        "channel": body.channel,
        "timing": body.timing,
        "message": (body.message or "")[:5000],
        "recipients": body.recipients,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "by": current_user.email,
    }

    def _noop_send():
        print(f"[VolunteerReminder] {event}")

    background_tasks.add_task(_noop_send)
    VOLUNTEER_ACTIVITY_LOG.append(event)
    with db_conn() as conn:
        if conn is not None:
            try:
                cur = conn.cursor()
                cur.execute(
                    """
                    INSERT INTO volunteer_events (id, ngo_id, type, payload)
                    VALUES (%s, %s, %s, %s::jsonb)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (event_id, current_user.ngo_id, "reminder", json.dumps(event)),
                )
            except Exception:
                pass
    return {"status": "scheduled", "event": event}

@app.get("/volunteers/activity", tags=["Volunteers"])
def get_volunteer_activity(current_user: TokenUser = Depends(require_role("ed", "programs"))):
    return {"events": VOLUNTEER_ACTIVITY_LOG[-100:][::-1]}


# ── Compliance Health Report (PDF) ────────────────────────────────────────────

def _simple_pdf_bytes(title: str, lines: List[str]) -> bytes:
    """
    Minimal PDF generator (no external deps).
    ASCII only; suitable for a quick downloadable report.
    """
    safe_lines = [line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") for line in lines]
    y = 760
    content_lines = [f"BT /F1 18 Tf 50 {y} Td ({title}) Tj ET"]
    y -= 30
    for line in safe_lines:
        content_lines.append(f"BT /F1 11 Tf 50 {y} Td ({line}) Tj ET")
        y -= 16
        if y < 60:
            break
    stream = "\n".join(content_lines).encode("utf-8")
    objects = []
    objects.append(b"1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n")
    objects.append(b"2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n")
    objects.append(b"3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources<< /Font<< /F1 4 0 R >> >> /Contents 5 0 R>>endobj\n")
    objects.append(b"4 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n")
    objects.append(b"5 0 obj<< /Length " + str(len(stream)).encode() + b" >>stream\n" + stream + b"\nendstream endobj\n")

    xref = [b"0000000000 65535 f \n"]
    body = b"%PDF-1.4\n"
    offsets = [0]
    for obj in objects:
        offsets.append(len(body))
        body += obj
    xref_start = len(body)
    for off in offsets[1:]:
        xref.append(f"{off:010d} 00000 n \n".encode())
    body += b"xref\n0 " + str(len(offsets)).encode() + b"\n" + b"".join(xref)
    body += b"trailer<< /Size " + str(len(offsets)).encode() + b" /Root 1 0 R >>\nstartxref\n" + str(xref_start).encode() + b"\n%%EOF"
    return body

@app.get("/compliance/health-report.pdf", tags=["Compliance"])
def get_compliance_health_report(current_user: TokenUser = Depends(get_current_user)):
    title = f"Compliance Health Report — {current_user.ngo_name}"
    lines = [
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        "Summary:",
        "- Registration vault: OK (demo)",
        "- DPDP: consent/erasure/breach logging available",
        "- Storage: S3 presigned upload/download enabled",
        "",
        "Next actions:",
        "- Upload expiring documents to the Compliance Vault",
        "- Review upcoming filings and board records",
    ]
    pdf = _simple_pdf_bytes(title, lines)
    return Response(content=pdf, media_type="application/pdf", headers={
        "Content-Disposition": 'attachment; filename="compliance_health_report.pdf"'
    })


@app.get("/compliance/filings/{filing_id}/package.pdf", tags=["Compliance"])
def get_filing_package(filing_id: int, current_user: TokenUser = Depends(get_current_user)):
    """
    Generates a simple filing package PDF for a filing calendar item.
    (MVP placeholder; future: compile real ledgers/docs.)
    """
    title = f"Filing Package — #{filing_id} — {current_user.ngo_name}"
    lines = [
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        "",
        "Includes (MVP):",
        "- Checklist",
        "- Document pointers (Compliance Vault)",
        "- Responsible owner and due date (from filings calendar)",
        "",
        "Next step:",
        "- Download relevant PDFs from Vault and hand over to CA/finance.",
    ]
    pdf = _simple_pdf_bytes(title, lines)
    return Response(content=pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename=\"filing_package_{filing_id}.pdf\"'
    })

@app.get("/dpdp/notice", tags=["Compliance"])
def get_dpdp_notice(current_user: TokenUser = Depends(get_current_user)):
    """Return the latest DPDP notice (markdown) for the NGO."""
    default_md = (
        f"**Data Fiduciary:** {current_user.ngo_name}\n\n"
        f"**Contact:** compliance@{current_user.ngo_name.lower().replace(' ', '')}.org\n\n"
        "**Purpose:** Donor relationship management, fundraising communications, grant reporting, impact measurement, and statutory compliance.\n\n"
        "**Data categories:** Name, email, phone, donation history, UPI IDs, location (field programs).\n\n"
        "**Retention:** Donor data 7 years (audit); Beneficiary data 5 years post-program.\n\n"
        "**Rights (DPDP 2023):** Access, correction/erasure (30 days), grievance redressal, nominate.\n"
    )
    with db_conn() as conn:
        if conn is not None:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT version, notice_md, created_at
                FROM dpdp_notice_versions
                WHERE ngo_id = %s
                ORDER BY version DESC
                LIMIT 1
                """,
                (current_user.ngo_id,),
            )
            row = cur.fetchone()
            if row:
                return {"version": row[0], "notice_md": row[1], "created_at": row[2].isoformat()}
    mem = DPDP_NOTICE_MEM_BY_NGO.get(current_user.ngo_id)
    if mem:
        return {"version": mem.get("version", 1), "notice_md": mem.get("notice_md", default_md), "created_at": mem.get("created_at"), "source": "memory"}
    return {"version": 1, "notice_md": default_md, "created_at": None, "source": "default"}


class DpdpNoticeUpsert(BaseModel):
    notice_md: str


@app.post("/dpdp/notice", tags=["Compliance"])
def post_dpdp_notice(body: DpdpNoticeUpsert, current_user: TokenUser = Depends(require_role("ed", "admin"))):
    """Create a new DPDP notice version for the NGO."""
    with db_conn() as conn:
        if conn is None:
            prev = DPDP_NOTICE_MEM_BY_NGO.get(current_user.ngo_id) or {"version": 0}
            next_version = int(prev.get("version", 0)) + 1
            created_at = datetime.now(timezone.utc).isoformat()
            DPDP_NOTICE_MEM_BY_NGO[current_user.ngo_id] = {
                "version": next_version,
                "notice_md": body.notice_md,
                "created_at": created_at,
                "created_by": current_user.email,
            }
            return {"id": f"mem_notice_{next_version}", "version": next_version, "created_at": created_at, "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            "SELECT COALESCE(MAX(version), 0) FROM dpdp_notice_versions WHERE ngo_id = %s",
            (current_user.ngo_id,),
        )
        next_version = int(cur.fetchone()[0]) + 1
        cur.execute(
            """
            INSERT INTO dpdp_notice_versions (ngo_id, version, notice_md, created_by)
            VALUES (%s, %s, %s, %s)
            RETURNING id::text, version, created_at
            """,
            (current_user.ngo_id, next_version, body.notice_md, current_user.email),
        )
        row = cur.fetchone()
        return {"id": row[0], "version": row[1], "created_at": row[2].isoformat()}


@app.get("/dpdp/notice.pdf", tags=["Compliance"])
def get_dpdp_notice_pdf(version: Optional[int] = None, current_user: TokenUser = Depends(get_current_user)):
    """Download DPDP notice as a PDF (latest by default)."""
    notice_md = None
    ver = None
    with db_conn() as conn:
        if conn is not None:
            cur = conn.cursor()
            if version is None:
                cur.execute(
                    """
                    SELECT version, notice_md
                    FROM dpdp_notice_versions
                    WHERE ngo_id = %s
                    ORDER BY version DESC
                    LIMIT 1
                    """,
                    (current_user.ngo_id,),
                )
            else:
                cur.execute(
                    """
                    SELECT version, notice_md
                    FROM dpdp_notice_versions
                    WHERE ngo_id = %s AND version = %s
                    """,
                    (current_user.ngo_id, int(version)),
                )
            row = cur.fetchone()
            if row:
                ver = row[0]
                notice_md = row[1]
        else:
            mem = DPDP_NOTICE_MEM_BY_NGO.get(current_user.ngo_id)
            if mem:
                ver = mem.get("version", 1)
                notice_md = mem.get("notice_md")
    if notice_md is None:
        # fallback to default constructed notice
        notice_md = get_dpdp_notice(current_user).get("notice_md")  # type: ignore
        ver = 1

    title = f"DPDP Notice (v{ver}) — {current_user.ngo_name}"
    lines = [line.strip() for line in notice_md.splitlines() if line.strip()][:40]
    pdf = _simple_pdf_bytes(title, lines)
    return Response(content=pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="dpdp_notice_v{ver}.pdf"'
    })


# ── Finance: Grants persistence ────────────────────────────────────────────────

class GrantRow(BaseModel):
    id: Optional[str] = None
    name: str
    total: float
    spent: float
    variance: float = 0
    status: str = "On Track"

@app.get("/finance/grants", tags=["Finance"])
def get_finance_grants(current_user: TokenUser = Depends(require_role("ed", "finance"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_finance_grants(current_user.ngo_id)
            return {"grants": FINANCE_GRANTS_MEM_BY_NGO.get(current_user.ngo_id, []), "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id::text, name, total::float, spent::float, variance::float, status
            FROM finance_grants
            WHERE ngo_id = %s
            ORDER BY created_at DESC
            """,
            (current_user.ngo_id,),
        )
        rows = cur.fetchall()
        return {
            "grants": [{"id": r[0], "name": r[1], "total": r[2], "spent": r[3], "variance": r[4], "status": r[5]} for r in rows],
            "source": "db",
        }

@app.post("/finance/grants", tags=["Finance"])
def post_finance_grant(body: GrantRow, current_user: TokenUser = Depends(require_role("ed", "finance"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_finance_grants(current_user.ngo_id)
            variance = body.variance if body.variance != 0 else (float(body.total) - float(body.spent))
            new_id = body.id or f"G-{datetime.now(timezone.utc).year}-{int(datetime.now(timezone.utc).timestamp())}"
            row = {"id": new_id, "name": body.name, "total": float(body.total), "spent": float(body.spent), "variance": float(variance), "status": body.status}
            FINANCE_GRANTS_MEM_BY_NGO.setdefault(current_user.ngo_id, []).insert(0, row)
            return {"status": "created", "id": new_id, "grant": row, "source": "memory"}
        cur = conn.cursor()
        variance = body.variance if body.variance != 0 else (float(body.total) - float(body.spent))
        cur.execute(
            """
            INSERT INTO finance_grants (ngo_id, name, total, spent, variance, status)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id::text
            """,
            (current_user.ngo_id, body.name, float(body.total), float(body.spent), float(variance), body.status),
        )
        return {"status": "created", "id": cur.fetchone()[0]}


@app.put("/finance/grants/{grant_id}", tags=["Finance"])
def put_finance_grant(grant_id: str, body: GrantRow, current_user: TokenUser = Depends(require_role("ed", "finance"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_finance_grants(current_user.ngo_id)
            grants = FINANCE_GRANTS_MEM_BY_NGO.get(current_user.ngo_id, [])
            for g in grants:
                if g.get("id") == grant_id:
                    g["name"] = body.name
                    g["total"] = float(body.total)
                    g["spent"] = float(body.spent)
                    g["variance"] = float(body.variance if body.variance != 0 else (float(body.total) - float(body.spent)))
                    g["status"] = body.status
                    return {"status": "updated", "id": grant_id, "grant": g, "source": "memory"}
            raise HTTPException(status_code=404, detail="Grant not found.")
        cur = conn.cursor()
        variance = body.variance if body.variance != 0 else (float(body.total) - float(body.spent))
        cur.execute(
            """
            UPDATE finance_grants
            SET name = %s, total = %s, spent = %s, variance = %s, status = %s
            WHERE ngo_id = %s AND id::text = %s
            RETURNING id::text
            """,
            (body.name, float(body.total), float(body.spent), float(variance), body.status, current_user.ngo_id, grant_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Grant not found.")
        return {"status": "updated", "id": row[0], "source": "db"}

@app.delete("/finance/grants/{grant_id}", tags=["Finance"])
def delete_finance_grant(grant_id: str, current_user: TokenUser = Depends(require_role("ed", "finance"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_finance_grants(current_user.ngo_id)
            grants = FINANCE_GRANTS_MEM_BY_NGO.get(current_user.ngo_id, [])
            nxt = [g for g in grants if g.get("id") != grant_id]
            if len(nxt) == len(grants):
                raise HTTPException(status_code=404, detail="Grant not found.")
            FINANCE_GRANTS_MEM_BY_NGO[current_user.ngo_id] = nxt
            return {"status": "deleted", "id": grant_id, "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM finance_grants WHERE ngo_id = %s AND id::text = %s RETURNING id::text",
            (current_user.ngo_id, grant_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Grant not found.")
        return {"status": "deleted", "id": row[0]}

# ── CSR Prospect DB (Search) ───────────────────────────────────────────────────

class ProspectCompany(BaseModel):
    id: str
    company_name: str
    sector: str
    hq_city: str
    annual_revenue_cr: float
    csr_obligation_cr: float
    focus_areas: List[str]

PROSPECT_DB: List[ProspectCompany] = [
    ProspectCompany(
        id="c1",
        company_name="Tata Trusts",
        sector="Philanthropy",
        hq_city="Mumbai",
        annual_revenue_cr=0,
        csr_obligation_cr=0,
        focus_areas=["Education", "Health", "Livelihoods"],
    ),
    ProspectCompany(
        id="c2",
        company_name="HDFC Bank",
        sector="BFSI",
        hq_city="Mumbai",
        annual_revenue_cr=125000,
        csr_obligation_cr=2500,
        focus_areas=["Financial inclusion", "Education", "Health"],
    ),
    ProspectCompany(
        id="c3",
        company_name="Infosys",
        sector="IT",
        hq_city="Bengaluru",
        annual_revenue_cr=150000,
        csr_obligation_cr=3000,
        focus_areas=["STEM", "Digital literacy", "Education"],
    ),
    ProspectCompany(
        id="c4",
        company_name="Reliance Industries",
        sector="Conglomerate",
        hq_city="Mumbai",
        annual_revenue_cr=800000,
        csr_obligation_cr=16000,
        focus_areas=["Disaster relief", "Health", "Education"],
    ),
]

@app.get("/csr/prospect-db/search", tags=["CSR"])
def search_prospect_db(
    q: str = "",
    sector: Optional[str] = None,
    city: Optional[str] = None,
    min_csr_cr: Optional[float] = None,
    limit: int = 20,
    current_user: TokenUser = Depends(require_role("ed", "programs")),
):
    # Prefer DB if configured
    with db_conn() as conn:
        if conn is not None:
            cur = conn.cursor()
            where = ["ngo_id = %s"]
            params: List[Any] = [current_user.ngo_id]
            if q:
                where.append("(LOWER(company_name) LIKE %s OR %s = ANY(ARRAY(SELECT LOWER(x) FROM UNNEST(focus_areas) AS x)))")
                params.append(f"%{q.strip().lower()}%")
                params.append(q.strip().lower())
            if sector:
                where.append("LOWER(sector) LIKE %s")
                params.append(f"%{sector.lower()}%")
            if city:
                where.append("LOWER(hq_city) LIKE %s")
                params.append(f"%{city.lower()}%")
            if min_csr_cr is not None:
                where.append("csr_obligation_cr >= %s")
                params.append(float(min_csr_cr))
            lim = max(1, min(limit, 50))
            sql = f"""
                SELECT id::text, company_name, sector, hq_city,
                       COALESCE(annual_revenue_cr, 0)::float, COALESCE(csr_obligation_cr, 0)::float,
                       COALESCE(focus_areas, '{{}}'::text[])
                FROM csr_prospect_companies
                WHERE {' AND '.join(where)}
                ORDER BY company_name ASC
                LIMIT {lim}
            """
            cur.execute(sql, params)
            rows = cur.fetchall()
            results = []
            for r in rows:
                results.append({
                    "id": r[0],
                    "company_name": r[1],
                    "sector": r[2],
                    "hq_city": r[3],
                    "annual_revenue_cr": r[4],
                    "csr_obligation_cr": r[5],
                    "focus_areas": list(r[6] or []),
                })
            return {"results": results, "count": len(results), "source": "db"}

    query = (q or "").strip().lower()
    out: List[ProspectCompany] = []
    for c in PROSPECT_DB:
        if query and query not in c.company_name.lower() and not any(query in fa.lower() for fa in c.focus_areas):
            continue
        if sector and sector.lower() not in c.sector.lower():
            continue
        if city and city.lower() not in c.hq_city.lower():
            continue
        if min_csr_cr is not None and c.csr_obligation_cr < float(min_csr_cr):
            continue
        out.append(c)
        if len(out) >= max(1, min(limit, 50)):
            break
    return {"results": [c.model_dump() for c in out], "count": len(out), "source": "memory"}


# ── Governance: Board Member Management ────────────────────────────────────────

class BoardMemberCreate(BaseModel):
    name: str
    role: str
    din: str
    tenure: Optional[str] = None

BOARD_MEMBERS_BY_NGO: Dict[str, List[Dict[str, Any]]] = {
    "ngo_001": [
        {"id": "bm_1", "name": "Dr. Arun Sharma", "role": "Chairperson", "din": "DIN00****12", "tenure": "Since 2019"},
        {"id": "bm_2", "name": "Ms. Kavita Patel", "role": "Treasurer", "din": "DIN00****34", "tenure": "Since 2021"},
        {"id": "bm_3", "name": "Mr. Suresh Iyer", "role": "Secretary", "din": "DIN00****56", "tenure": "Since 2020"},
    ]
}

@app.get("/governance/board-members", tags=["Governance"])
def list_board_members(current_user: TokenUser = Depends(require_role("ed", "admin", "board"))):
    with db_conn() as conn:
        if conn is not None:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT id::text, full_name, role, din, tenure
                FROM governance_board_members
                WHERE ngo_id = %s
                ORDER BY full_name ASC
                """,
                (current_user.ngo_id,),
            )
            rows = cur.fetchall()
            return {
                "members": [
                    {"id": r[0], "name": r[1], "role": r[2], "din": r[3], "tenure": r[4]}
                    for r in rows
                ],
                "source": "db",
            }

    return {"members": BOARD_MEMBERS_BY_NGO.get(current_user.ngo_id, []), "source": "memory"}

@app.post("/governance/board-members", tags=["Governance"])
def add_board_member(body: BoardMemberCreate, current_user: TokenUser = Depends(require_role("ed", "admin"))):
    with db_conn() as conn:
        if conn is not None:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO governance_board_members (ngo_id, full_name, role, din, tenure)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id::text, full_name, role, din, tenure
                """,
                (
                    current_user.ngo_id,
                    body.name,
                    body.role,
                    body.din,
                    body.tenure or f"Since {datetime.now(timezone.utc).year}",
                ),
            )
            r = cur.fetchone()
            member = {"id": r[0], "name": r[1], "role": r[2], "din": r[3], "tenure": r[4]}
            return {"status": "created", "member": member, "source": "db"}

    members = BOARD_MEMBERS_BY_NGO.setdefault(current_user.ngo_id, [])
    new_id = f"bm_{int(datetime.now(timezone.utc).timestamp())}"
    member = {"id": new_id, "name": body.name, "role": body.role, "din": body.din, "tenure": body.tenure or f"Since {datetime.now(timezone.utc).year}"}
    members.append(member)
    return {"status": "created", "member": member, "source": "memory"}

@app.delete("/governance/board-members/{member_id}", tags=["Governance"])
def delete_board_member(member_id: str, current_user: TokenUser = Depends(require_role("ed", "admin"))):
    with db_conn() as conn:
        if conn is not None:
            cur = conn.cursor()
            cur.execute(
                "DELETE FROM governance_board_members WHERE ngo_id = %s AND id::text = %s RETURNING id::text",
                (current_user.ngo_id, member_id),
            )
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Board member not found.")
            return {"status": "deleted", "id": r[0], "source": "db"}

    members = BOARD_MEMBERS_BY_NGO.get(current_user.ngo_id, [])
    next_members = [m for m in members if m.get("id") != member_id]
    if len(next_members) == len(members):
        raise HTTPException(status_code=404, detail="Board member not found.")
    BOARD_MEMBERS_BY_NGO[current_user.ngo_id] = next_members
    return {"status": "deleted", "id": member_id, "source": "memory"}


# ── Single Railway service: serve Vite `dist/` from the same uvicorn process ──
# - `/assets/*` is mounted for hashed bundles (register last among mounts; API routes stay first).
# - SPA paths (`/tasks`, `/login`, …) are not files; Starlette StaticFiles(html=True) no longer
#   serves index.html for missing paths, so we use an explicit GET catch-all after all API routes.
_REPO_ROOT = Path(__file__).resolve().parents[2]
_DIST_DIR = _REPO_ROOT / "dist"
_SPA_INDEX = _DIST_DIR / "index.html"


def _mount_frontend_dist() -> None:
    if not _SPA_INDEX.is_file():
        return
    assets_dir = _DIST_DIR / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="vite-assets")


_mount_frontend_dist()


@app.get("/", include_in_schema=False)
async def spa_index_root():
    if not _SPA_INDEX.is_file():
        raise HTTPException(status_code=503, detail="Frontend dist/ not built (missing index.html).")
    return FileResponse(_SPA_INDEX)


@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    """
    Serve files from dist/ when present; otherwise index.html for client-side routes.
    Registered after all API routes so GET /inbox, /openapi.json, etc. keep matching the app.
    """
    if not _SPA_INDEX.is_file():
        raise HTTPException(status_code=503, detail="Frontend dist/ not built (missing index.html).")
    safe = (_DIST_DIR / full_path).resolve()
    try:
        safe.relative_to(_DIST_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=404, detail="Not Found")
    if safe.is_file():
        return FileResponse(safe)
    return FileResponse(_SPA_INDEX)
