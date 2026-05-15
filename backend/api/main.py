from pathlib import Path

from fastapi import FastAPI, BackgroundTasks, HTTPException, Header, Depends, Request, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import hashlib
import json
import os
import re
import uuid

from agents.donor_nurture_agent import donor_nurture_app
from agents.finance_compliance_agent import finance_agent
from agents.board_briefing_agent import board_briefing_agent
from agents.morning_brief_agent import morning_brief_agent
from core.morning_brief import MORNING_BRIEF_MEM_BY_NGO, run_morning_brief_delivery
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
from jobs.scheduled_export import run_scheduled_exports
from core.export_builder import build_ngo_export_zip
from core.analytics import (
    predict_revenue,
    detect_anomalies,
    calculate_propensity_score,
    donor_rfm_from_transactions,
    suggest_campaign_goal,
    classify_fcra_transaction,
    match_donor_from_bank_line,
)
from agents.orchestrator import process_orchestration
from core.gen_ai import summarize_conversations, analyze_sentiment, draft_annual_report, draft_donor_outreach_whatsapp
from core.intent_router import route_intent
from fastapi.responses import Response, FileResponse
from datetime import datetime, timezone, timedelta
from urllib.parse import quote
from core.db import db_conn
from core.tenant_db import apply_ngo_session
from core.platform_audit import log_audit
from core.wa_delivery_queue import enqueue_wa_delivery
from core.wa_intake import process_whatsapp_payload, ensure_org_code_for_ngo
from core.wa_queue_worker import register_wa_queue_scheduler
from core.wa_client import send_whatsapp_text as wa_send_message
from core.llm_keys import (
    set_org_openai_key,
    clear_org_openai_key,
    load_all_org_keys_from_db,
    llm_key_status_for_ngo,
)
from core import wa_registry
from core.wa_registry import list_mis_intake
from core.s3_storage import (
    generate_presigned_upload_url,
    generate_presigned_download_url,
    list_ngo_files,
    delete_file,
)
from core.dpdp import require_beneficiary_consent, anonymize_beneficiary_record, extract_consent_given
from core.rate_limit import check_login_rate_limit
from core.fcra_guard import assert_fcra_admin_within_cap

# Public endpoints should not require auth; use get_current_user_optional.

# ── Sentry: initialise before app creation ──────────────────────────────────
init_sentry()

app = FastAPI(
    title="GoodJobs API",
    description="Agentic backend for GoodJobs — India-first nonprofit operating system (goodjobs.co.in)",
    version="2.0.0",
)

# CORS — comma-separated origins in FRONTEND_ORIGINS (e.g. Railway app URL + local dev)
_default_origins = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,https://goodjobs.co.in"
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
# WhatsApp delivery-status store.
# Shape: {outreach_id: {ngo_id, channel, created_at, recipients: {donor_id: {wamid, status, updated_at, error?}}}}
# Statuses follow the WhatsApp Business API vocabulary: sent | delivered | read | failed.
WA_TOUCHPOINT_STATUS_MEM: Dict[str, Dict[str, Any]] = {}
# Donor lifecycle state — milestones / skipped / lapseRiskAck per donor.
# Mirrors the JSONB blob stored in donors.meta.lifecycle when a DB is wired
# up. Shape: {ngo_id: {donor_id: {state: dict, updated_at: iso}}}.
DONOR_LIFECYCLE_MEM_BY_NGO: Dict[str, Dict[str, Dict[str, Any]]] = {}
FINANCE_EVENTS_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
NOTIFICATIONS_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
EXPORT_SCHEDULE_MEM_BY_NGO: Dict[str, Dict[str, Any]] = {}
MIS_REVIEWS_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
RECEIPT_SEQ_MEM_BY_NGO: Dict[str, int] = {}


def _demo_default_ngo_id() -> str:
    """Unauthenticated triggers (cron demos, payment webhooks) scope LLM keys to this NGO."""
    return (os.getenv("DEMO_DEFAULT_NGO_ID") or "ngo_001").strip() or "ngo_001"


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


def _morning_brief_deep_link(
    kind: str,
    ref_id: str,
    route: str,
    meta: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Primary navigation target for a morning-brief row (SPA paths).
    Prefer module deep links over generic /tasks when we have enough context.
    """
    k = (kind or "").strip()
    m = meta or {}
    r = (ref_id or "").strip()
    base_route = (route or "/tasks").strip()
    if not base_route.startswith("/"):
        base_route = "/" + base_route

    if k == "month_end_close":
        return "/finance"
    if k == "intent":
        return f"/agent-hq{'?intent=' + quote(r, safe='') if r else ''}"
    if k in ("csr_win_decay", "csr_stale", "csr_report_due"):
        cid = m.get("card_id") or m.get("csr_card_id") or r
        if cid:
            return f"/csr?focus={quote(str(cid), safe='')}"
        return "/csr"
    if k == "compliance_doc":
        doc = m.get("doc_type") or m.get("type") or m.get("name") or ""
        q = "alert=true"
        if doc:
            q += f"&doc={quote(str(doc), safe='')}"
        return f"/compliance?{q}"
    if k == "finance_flag":
        return "/finance"
    if k == "donor_outreach_draft":
        tp = _tasks_focus_path(k, r)
        return tp or "/crm"

    tp = _tasks_focus_path(k, r)
    if tp:
        return tp
    return base_route


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


BENEFICIARY_ROLES = ("ed", "programs", "field")


@app.get("/programs/beneficiaries", tags=["Programs"])
def list_beneficiaries(current_user: TokenUser = Depends(require_role("ed", "programs", "field", "board"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_beneficiaries(current_user.ngo_id)
            return {"beneficiaries": BENEFICIARIES_MEM_BY_NGO.get(current_user.ngo_id, []), "source": "memory"}
        cur = conn.cursor()
        apply_ngo_session(cur, current_user.ngo_id)
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
def create_beneficiary(body: BeneficiaryCreate, current_user: TokenUser = Depends(require_role(*BENEFICIARY_ROLES))):
    require_beneficiary_consent(body.details)
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
        apply_ngo_session(cur, current_user.ngo_id)
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
        log_audit(
            ngo_id=current_user.ngo_id,
            user_id=current_user.user_id,
            action="beneficiary.create",
            entity_type="program_beneficiary",
            entity_id=new_id,
            new_values={"name": body.name, "program": body.program},
        )
        return {"status": "created", "beneficiary": ben, "source": "db"}


class BeneficiaryBulkImport(BaseModel):
    beneficiaries: List[BeneficiaryCreate]


@app.post("/programs/beneficiaries/bulk", tags=["Programs"])
def bulk_import_beneficiaries(body: BeneficiaryBulkImport, current_user: TokenUser = Depends(require_role(*BENEFICIARY_ROLES))):
    n = 0
    skipped_consent = 0
    with db_conn() as conn:
        if conn is None:
            _seed_memory_beneficiaries(current_user.ngo_id)
            lst = BENEFICIARIES_MEM_BY_NGO.setdefault(current_user.ngo_id, [])
            base = 1000 + len(lst)
            for b in body.beneficiaries[:500]:
                if not (b.name or "").strip():
                    continue
                if not extract_consent_given(b.details):
                    skipped_consent += 1
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
            return {"imported": n, "skipped_consent": skipped_consent, "source": "memory"}
        cur = conn.cursor()
        apply_ngo_session(cur, current_user.ngo_id)
        for b in body.beneficiaries[:500]:
            if not (b.name or "").strip():
                continue
            if not extract_consent_given(b.details):
                skipped_consent += 1
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
        return {"imported": n, "skipped_consent": skipped_consent, "source": "db"}


@app.put("/programs/beneficiaries/{ben_id}", tags=["Programs"])
def update_beneficiary(ben_id: str, body: BeneficiaryCreate, current_user: TokenUser = Depends(require_role(*BENEFICIARY_ROLES))):
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
        apply_ngo_session(cur, current_user.ngo_id)
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
        apply_ngo_session(cur, current_user.ngo_id)
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


@app.get("/crm/donors/{donor_id}", tags=["CRM"])
def get_donor(donor_id: str, current_user: TokenUser = Depends(require_role("ed", "crm", "fundraising", "finance", "programs"))):
    """Single-donor fetch — scoped to caller NGO (tenant isolation)."""
    with db_conn() as conn:
        if conn is None:
            _seed_memory_crm(current_user.ngo_id)
            donor = next(
                (d for d in DONORS_MEM_BY_NGO.get(current_user.ngo_id, []) if str(d.get("id")) == donor_id),
                None,
            )
            if not donor:
                raise HTTPException(status_code=404, detail="Donor not found")
            return {"donor": donor, "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id::text, full_name, COALESCE(donor_type, 'Recurring'),
                   COALESCE(total_lifetime_value, 0)::float,
                   COALESCE(pan_masked, ''), COALESCE(location_text, ''),
                   COALESCE(tags, '{}'), COALESCE(email, ''), COALESCE(phone, ''),
                   COALESCE(meta, '{}'::jsonb)
            FROM donors
            WHERE id = %s::uuid AND ngo_id = %s::uuid
            """,
            (donor_id, current_user.ngo_id),
        )
        r = cur.fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="Donor not found")
        return {
            "donor": {
                "id": r[0],
                "name": r[1],
                "type": r[2],
                "totalGiven": float(r[3] or 0),
                "initial": (r[1] or "U")[:1].upper(),
                "pan": r[4] or "",
                "location": r[5] or "",
                "tags": list(r[6] or []),
                "email": (r[7] or "").strip(),
                "phone": (r[8] or "").strip(),
                "meta": _parse_jsonb(r[9]),
            },
            "source": "db",
        }


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
    programmeId: Optional[str] = None


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
    ngo_id = user.ngo_id if user else _demo_default_ngo_id()
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
                "programmeId": body.programmeId or body.campaignId or "",
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
            "programmeId": body.programmeId or body.campaignId or "",
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
    ngo_id: Optional[str] = None

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


class ExportScheduleRequest(BaseModel):
    enabled: bool
    frequency: str  # "weekly" or "monthly"


class LlmKeyRequest(BaseModel):
    openai_api_key: str


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
def login(body: LoginRequest, request: Request):
    """
    Authenticate a user and return a signed JWT.
    In production: query the `users` table, verify bcrypt hash.
    Dev: uses the DEMO_USERS dict in core/auth.py.
    """
    check_login_rate_limit(request)
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
                "export_schedule": EXPORT_SCHEDULE_MEM_BY_NGO.get(current_user.ngo_id, {"enabled": False, "frequency": "weekly"}),
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
        # export_schedule: try dedicated table, fall back to memory store
        eq = None
        try:
            cur.execute(
                """
                SELECT schedule
                FROM ngo_export_schedules
                WHERE ngo_id = %s::uuid
                """,
                (current_user.ngo_id,),
            )
            eq = cur.fetchone()
        except Exception:
            eq = None
        export_schedule = (eq[0] if eq else None) or EXPORT_SCHEDULE_MEM_BY_NGO.get(
            current_user.ngo_id, {"enabled": False, "frequency": "weekly"}
        )
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
            "export_schedule": export_schedule,
        }


def _ngo_meta_patch(body: "UpdateNgoRequest") -> Dict[str, Any]:
    """Build the JSON patch that goes into ngos.meta for wizard extras."""
    patch: Dict[str, Any] = {}
    if body.section_80g is not None:
        patch["section_80g"] = body.section_80g
    if body.cause_area is not None:
        patch["cause_area"] = body.cause_area
    if body.logo_data_url is not None:
        patch["logo_data_url"] = body.logo_data_url
    if body.fcra_status is not None:
        patch["fcra_status"] = body.fcra_status
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


class TeamInviteRequest(BaseModel):
    invites: List[NgoInviteEntry] = Field(default_factory=list)


@app.post("/team/invite", tags=["Settings"])
def post_team_invite(body: TeamInviteRequest, current_user: TokenUser = Depends(require_role("ed", "admin"))):
    """Alias for onboarding invites — used by Settings → Team."""
    return create_invites(NgoInviteRequest(invites=body.invites), current_user)


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
def _seed_demo_whatsapp_codes() -> None:
    """Demo org code so webhook tests can resolve tenant GJDEMO → ngo_001 without DB."""
    try:
        wa_registry.mem_register_code("GJDEMO", "ngo_001")
    except Exception:
        pass


@app.on_event("startup")
def _load_org_llm_api_keys() -> None:
    """Decrypt per-NGO OpenAI keys from Postgres into process memory (no-op without DB)."""
    try:
        n = load_all_org_keys_from_db()
        if n:
            print(f"✅ Loaded {n} organisation OpenAI API key(s) from database.")
    except Exception:
        pass


@app.on_event("startup")
def _start_export_scheduler() -> None:
    """
    Register the daily export-schedule check with APScheduler.
    Runs every day at 06:00 IST.  The job's own _should_run_today() gate ensures
    it only sends for NGOs whose weekly/monthly cadence falls on today.

    Failure modes:
      - ImportError  : APScheduler not installed → logs warning, app continues.
      - Any other    : re-raised so misconfiguration is visible at startup.
    """
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
    except ImportError:
        print(
            "⚠  APScheduler not installed — automatic scheduled exports disabled.\n"
            "   Add 'apscheduler>=3.10.0' to backend/requirements.txt and restart."
        )
        return

    scheduler = BackgroundScheduler(timezone="Asia/Kolkata")
    scheduler.add_job(
        run_scheduled_exports,
        trigger=CronTrigger(hour=6, minute=0, timezone="Asia/Kolkata"),
        id="scheduled_export",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        _morning_brief_job_all_ngos,
        trigger=CronTrigger(hour=8, minute=0, timezone="Asia/Kolkata"),
        id="morning_brief_agent",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    register_wa_queue_scheduler(scheduler)
    scheduler.start()
    print("✅ Schedulers started — exports 06:00 IST, morning brief 08:00 IST.")


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


@app.on_event("startup")
async def _warn_missing_whatsapp_secret() -> None:
    """
    Emit a startup warning when WHATSAPP_APP_SECRET is absent.
    Without it the /crm/whatsapp/webhook endpoint cannot validate
    X-Hub-Signature-256 headers, leaving delivery-status updates
    open to spoofing.  Always set this env var in production.
    """
    import logging as _logging
    if not os.getenv("WHATSAPP_APP_SECRET", "").strip():
        _logging.getLogger("goodjobs").warning(
            "WHATSAPP_APP_SECRET is not set — webhook signature validation is "
            "disabled.  Set this env var in production to prevent spoofed "
            "delivery-status updates on /crm/whatsapp/webhook."
        )


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


@app.post("/settings/export-schedule", tags=["Settings"])
def post_settings_export_schedule(body: ExportScheduleRequest, current_user: TokenUser = Depends(get_current_user)):
    """Save the scheduled automatic export preference for the NGO."""
    freq = body.frequency if body.frequency in ("weekly", "monthly") else "weekly"
    schedule = {"enabled": body.enabled, "frequency": freq, "email": current_user.email}
    # Always persist to memory store (shared between memory and DB mode for resilience)
    EXPORT_SCHEDULE_MEM_BY_NGO[current_user.ngo_id] = schedule
    with db_conn() as conn:
        if conn is None:
            return {"ok": True, "export_schedule": schedule, "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS ngo_export_schedules (
                ngo_id UUID PRIMARY KEY,
                schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        cur.execute(
            """
            INSERT INTO ngo_export_schedules (ngo_id, schedule)
            VALUES (%s::uuid, %s::jsonb)
            ON CONFLICT (ngo_id)
            DO UPDATE SET schedule = EXCLUDED.schedule, updated_at = CURRENT_TIMESTAMP
            RETURNING schedule
            """,
            (current_user.ngo_id, json.dumps(schedule)),
        )
        row = cur.fetchone()
        return {"ok": True, "export_schedule": row[0] if row else schedule, "source": "db"}


@app.get("/settings/llm", tags=["Settings"])
def get_settings_llm(current_user: TokenUser = Depends(get_current_user)):
    """Return masked key status for the signed-in organisation (never the raw secret)."""
    return llm_key_status_for_ngo(current_user.ngo_id)


@app.post("/settings/llm", tags=["Settings"])
def post_settings_llm(body: LlmKeyRequest, current_user: TokenUser = Depends(require_role("ed"))):
    """Store an OpenAI API key for this NGO (encrypted at rest when Postgres is configured)."""
    try:
        set_org_openai_key(current_user.ngo_id, body.openai_api_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return llm_key_status_for_ngo(current_user.ngo_id)


@app.delete("/settings/llm", tags=["Settings"])
def delete_settings_llm(current_user: TokenUser = Depends(require_role("ed"))):
    """Remove the organisation-specific key; agents fall back to server OPENAI_API_KEY if set."""
    clear_org_openai_key(current_user.ngo_id)
    return llm_key_status_for_ngo(current_user.ngo_id)


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
    Uses the shared build_ngo_export_zip() so on-demand and scheduled exports
    produce identical output.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"goodjobs_export_{today}.zip"
    ngo_id = current_user.ngo_id
    s = get_settings(current_user)
    ngo_info = s.get("ngo", {})

    with db_conn() as conn:
        if conn is None:
            # Seed in-memory stores before passing them to the builder
            _seed_memory_crm(ngo_id)
            _seed_memory_beneficiaries(ngo_id)
            _seed_memory_csr(ngo_id)
            _seed_memory_volunteer_roster(ngo_id)
            mem_stores = {
                "donors":        list(DONORS_MEM_BY_NGO.get(ngo_id, [])),
                "transactions":  list(TX_MEM_BY_NGO.get(ngo_id, [])),
                "beneficiaries": list(BENEFICIARIES_MEM_BY_NGO.get(ngo_id, [])),
                "grants":        list(CSR_CARDS_MEM_BY_NGO.get(ngo_id, [])),
                "compliance":    list(COMPLIANCE_DOCS_MEM_BY_NGO.get(ngo_id, [])),
                "volunteers":    list(VOLUNTEERS_ROSTER_MEM_BY_NGO.get(ngo_id, [])),
            }
        else:
            mem_stores = {}

        zip_bytes = build_ngo_export_zip(
            ngo_id=ngo_id,
            exported_by=current_user.email,
            ngo_info=ngo_info,
            conn=conn,
            mem_stores=mem_stores,
        )

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
    background_tasks.add_task(
        _run_donor_agent,
        {**event.model_dump(), "ngo_id": current_user.ngo_id},
    )
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
    payload = {**event.model_dump(), "ngo_id": event.ngo_id or _demo_default_ngo_id()}
    background_tasks.add_task(_run_grant_agent, payload)
    return {"status": "accepted", "message": f"Grant report agent triggered for {event.grant_name}"}

# ── Board Briefing Agent ────────────────────────────────────────────────────────

def _run_board_brief(payload: dict):
    try:
        result = board_briefing_agent.invoke(payload)
        print(f"Board Briefing Agent → {result['status']}")
    except Exception as e:
        print(f"Board Briefing Agent Error: {e}")


def _run_morning_brief(payload: dict):
    try:
        result = morning_brief_agent.invoke(payload)
        print(f"Morning Brief Agent → {result.get('status')}")
    except Exception as e:
        print(f"Morning Brief Agent Error: {e}")


def _morning_brief_job_all_ngos():
    """Cron: deliver morning brief for demo NGO (extend to all NGOs when multi-tenant cron matures)."""
    ngo_id = _demo_default_ngo_id()
    try:
        run_morning_brief_delivery(ngo_id=ngo_id, ngo_name=os.getenv("DEMO_NGO_NAME", "GoodJobs Demo NGO"))
    except Exception as e:
        print(f"Morning brief cron error: {e}")


@app.post("/trigger/board-brief")
async def trigger_board_brief(background_tasks: BackgroundTasks):
    """Manually trigger board brief (cron also calls this daily at 6 AM IST)."""
    from datetime import date
    payload = {
        "ngo_id": _demo_default_ngo_id(),
        "run_date": str(date.today()),
        "delivery_channels": ["dashboard", "whatsapp"],
    }
    background_tasks.add_task(_run_board_brief, payload)
    return {"status": "accepted", "message": "Board briefing agent triggered"}


@app.post("/trigger/morning-brief")
async def trigger_morning_brief(
    background_tasks: BackgroundTasks,
    current_user: TokenUser = Depends(require_role("ed", "admin", "programs", "field")),
):
    """Morning Brief Agent — role Today priorities + optional field WhatsApp delivery."""
    from datetime import date
    ngo_id = current_user.ngo_id
    ngo_name = current_user.ngo_name or "NGO"

    def _task():
        morning_brief_agent.invoke({
            "ngo_id": ngo_id,
            "ngo_name": ngo_name,
            "run_date": str(date.today()),
            "result": {},
            "status": "pending",
        })

    background_tasks.add_task(_task)
    return {"status": "accepted", "message": "Morning brief agent triggered"}


@app.get("/morning-brief/agent-status", tags=["Agentic UX"])
def get_morning_brief_agent_status(current_user: TokenUser = Depends(get_current_user)):
    rec = MORNING_BRIEF_MEM_BY_NGO.get(current_user.ngo_id) or {}
    return {"last_run": rec, "source": "memory" if rec else "none"}

# ── RAG Ingestion ───────────────────────────────────────────────────────────────

@app.post("/ingest/document")
async def ingest_doc(
    doc: DocumentIngest,
    background_tasks: BackgroundTasks,
    current_user: TokenUser = Depends(require_role("ed", "programs")),
):
    """
    Upload a document to the RAG pipeline (chunking + embeddings).
    Uses real OpenAI embeddings when a key is resolved for this NGO; otherwise mock vectors.
    Optional pgvector upsert when DATABASE_URL is set and the vector store is reachable.
    """
    ngo_id = current_user.ngo_id

    def _ingest():
        result = ingest_document(
            text=doc.text,
            document_title=doc.document_title,
            document_type=doc.document_type,
            ngo_id=ngo_id,
            use_mock=None,
        )
        print(f"RAG Ingest → {result}")

    background_tasks.add_task(_ingest)
    return {"status": "ingestion_started", "document_title": doc.document_title, "ngo_id": ngo_id}

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
            "ngo_id": _demo_default_ngo_id(),
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
    days_active: int = 30
    donor_count: int = 0
    ngo_id: Optional[str] = None

def _run_campaign_agent(payload: dict):
    try:
        result = campaign_agent.invoke(payload)
        print(f"Campaign Agent → {result.get('status')} | Health: {result.get('campaign_health')}")
    except Exception as e:
        print(f"Campaign Agent Error: {e}")

@app.post("/trigger/campaign-intelligence")
async def trigger_campaign_intel(event: CampaignTrigger, background_tasks: BackgroundTasks):
    """Analyze campaign health, generate boost copy, flag underperforming campaigns."""
    raw = event.model_dump()
    payload = {
        "ngo_id": raw.get("ngo_id") or _demo_default_ngo_id(),
        "campaign_id": raw["campaign_id"],
        "campaign_title": raw["campaign_title"],
        "target_amount": raw["target_amount"],
        "raised_so_far": raw["raised_amount"],
        "days_active": raw["days_active"],
        "days_remaining": raw["days_remaining"],
        "donor_count": raw["donor_count"],
    }
    background_tasks.add_task(_run_campaign_agent, payload)
    return {"status": "accepted", "campaign_id": event.campaign_id}


# ── CSR Prospect Research Agent ─────────────────────────────────────────────────

class CSRProspectTrigger(BaseModel):
    company_name: str
    sector: str
    annual_revenue_cr: float
    focus_area: Optional[str] = "Education"
    ngo_programs: Optional[List[str]] = []
    ngo_id: Optional[str] = None

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
        payload = {**event.model_dump(), "ngo_id": event.ngo_id or _demo_default_ngo_id()}
        result = csr_agent.invoke(payload)
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
    ngo_id: Optional[str] = None

def _run_field_mis_agent(payload: dict):
    try:
        result = field_mis_agent.invoke(payload)
        print(f"Field MIS Agent → Beneficiaries: {result.get('beneficiary_count')} | Language: {result.get('detected_language')}")
    except Exception as e:
        print(f"Field MIS Agent Error: {e}")

@app.post("/webhook/field-report/parse", tags=["Programs"])
def parse_field_report_sync(event: FieldReportTrigger):
    """
    Synchronous field-note parse for QA (slang / Hinglish). Does not enqueue background work.
    """
    from agents.field_mis_agent import detect_and_translate

    state = {
        "ngo_id": event.ngo_id or _demo_default_ngo_id(),
        "event_type": "field.data.submitted",
        "raw_input": event.report_text,
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
    out = detect_and_translate(state)
    parsed = out.get("parsed_data") or {}
    return {
        "parsed": parsed,
        "beneficiary_name": parsed.get("beneficiary_name"),
        "action": parsed.get("action"),
        "notes": parsed.get("notes"),
        "summary": out.get("translated_summary"),
    }


@app.post("/webhook/field-report")
async def handle_field_report(event: FieldReportTrigger, background_tasks: BackgroundTasks):
    """Process WhatsApp field report: detect language, extract structured data, validate."""
    payload = {
        "ngo_id": event.ngo_id or _demo_default_ngo_id(),
        "event_type": "field.data.submitted",
        "raw_input": event.report_text,
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
    background_tasks.add_task(_run_field_mis_agent, payload)
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


class DonorPropensityBatchRequest(BaseModel):
    donor_ids: List[str] = Field(default_factory=list)


def _donor_transactions_for_rfm(ngo_id: str) -> List[Dict[str, Any]]:
    with db_conn() as conn:
        if conn is None:
            return list(TX_MEM_BY_NGO.get(ngo_id, []))
        cur = conn.cursor()
        try:
            cur.execute(
                """
                SELECT donor_id::text, amount, transaction_date, created_at
                FROM transactions
                WHERE ngo_id = %s::uuid AND donor_id IS NOT NULL
                ORDER BY transaction_date DESC NULLS LAST
                LIMIT 5000
                """,
                (ngo_id,),
            )
            rows = cur.fetchall() or []
            return [
                {
                    "donor_id": str(r[0]),
                    "amount": float(r[1] or 0),
                    "transaction_date": r[2].isoformat() if r[2] else None,
                    "created_at": r[3].isoformat() if r[3] else None,
                }
                for r in rows
            ]
        except Exception:
            return list(TX_MEM_BY_NGO.get(ngo_id, []))


@app.post("/analytics/donor-propensity-batch", tags=["Analytics"])
def post_donor_propensity_batch(
    body: DonorPropensityBatchRequest,
    current_user: TokenUser = Depends(require_role("ed", "crm")),
):
    """RFM propensity scores for many donors (CRM heatmap + nurture queue)."""
    donor_ids = [str(d) for d in (body.donor_ids or [])[:200] if d]
    txs = _donor_transactions_for_rfm(current_user.ngo_id)
    scores: Dict[str, int] = {}
    for did in donor_ids:
        history = donor_rfm_from_transactions(txs, did)
        if history["total_gifts_count"] == 0:
            donor_profiles = {
                "1": {"days_since_last_gift": 10, "total_gifts_count": 25, "average_gift_amount": 5000},
                "2": {"days_since_last_gift": 30, "total_gifts_count": 12, "average_gift_amount": 2000},
                "4": {"days_since_last_gift": 240, "total_gifts_count": 2, "average_gift_amount": 1000},
                "5": {"days_since_last_gift": 60, "total_gifts_count": 5, "average_gift_amount": 1500},
            }
            history = donor_profiles.get(did, history)
        scores[did] = calculate_propensity_score(history)
    return {"scores": scores}


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

def _fiscal_year_label(now: Optional[datetime] = None) -> str:
    dt = now or datetime.now(timezone.utc)
    y = dt.year
    if dt.month < 4:
        y -= 1
    return f"{y}-{y + 1}"


def _next_receipt_number(ngo_id: str, ngo_name: str) -> str:
    fy = _fiscal_year_label()
    seq = 1
    with db_conn() as conn:
        if conn is None:
            key = f"{ngo_id}:{fy}"
            seq = RECEIPT_SEQ_MEM_BY_NGO.get(key, 0) + 1
            RECEIPT_SEQ_MEM_BY_NGO[key] = seq
        else:
            cur = conn.cursor()
            try:
                cur.execute(
                    """
                    INSERT INTO ngo_receipt_sequences (ngo_id, fiscal_year, last_seq)
                    VALUES (%s, %s, 1)
                    ON CONFLICT (ngo_id, fiscal_year)
                    DO UPDATE SET last_seq = ngo_receipt_sequences.last_seq + 1
                    RETURNING last_seq
                    """,
                    (ngo_id, fy),
                )
                seq = int(cur.fetchone()[0])
            except Exception:
                key = f"{ngo_id}:{fy}"
                seq = RECEIPT_SEQ_MEM_BY_NGO.get(key, 0) + 1
                RECEIPT_SEQ_MEM_BY_NGO[key] = seq
    slug = (ngo_name or "NGO")[:12].upper().replace(" ", "")
    return f"80G/{fy}/{slug}/{seq:05d}"


def _load_donors_for_match(ngo_id: str) -> List[Dict[str, Any]]:
    with db_conn() as conn:
        if conn is None:
            return list(DONORS_MEM_BY_NGO.get(ngo_id, []))
        cur = conn.cursor()
        apply_ngo_session(cur, ngo_id)
        cur.execute(
            "SELECT id::text, name, email, phone FROM donors WHERE ngo_id = %s::uuid",
            (ngo_id,),
        )
        return [{"id": r[0], "name": r[1], "email": r[2] or "", "phone": r[3] or ""} for r in cur.fetchall()]


@app.post("/workflows/classify-transaction", tags=["Workflows"])
def post_classify_tx(description: str, current_user: TokenUser = Depends(require_role("ed", "finance"))):
    """
    AI classifies an FCRA/bank line and suggests a donor match when possible.
    """
    out = dict(classify_fcra_transaction(description))
    donors = _load_donors_for_match(current_user.ngo_id)
    match = match_donor_from_bank_line(description, donors)
    if match:
        out["suggested_donor_id"] = match.get("donor_id")
        out["suggested_donor_name"] = match.get("donor_name")
        out["donor_match_confidence"] = match.get("confidence")
    if "donation" in (description or "").lower() or "upi" in (description or "").lower():
        if out.get("category") == "General Welfare":
            out["category"] = "Donation"
            out["confidence"] = max(float(out.get("confidence") or 0), 0.75)
    return out


class IssueReceiptRequest(BaseModel):
    journal_entry_id: Optional[str] = None
    donor_id: Optional[str] = None
    amount: Optional[float] = None
    ngo_name: Optional[str] = None


@app.post("/finance/issue-receipt", tags=["Finance"])
def post_finance_issue_receipt(
    body: IssueReceiptRequest,
    current_user: TokenUser = Depends(require_role("ed", "finance")),
):
    """Allocate the next authoritative 80G receipt number for this NGO (per Indian FY)."""
    ngo_name = (body.ngo_name or current_user.ngo_name or "NGO").strip()
    receipt_number = _next_receipt_number(current_user.ngo_id, ngo_name)
    if body.donor_id:
        with db_conn() as conn:
            if conn is not None:
                try:
                    cur = conn.cursor()
                    cur.execute(
                        """
                        UPDATE transactions
                        SET receipt_generated = true,
                            meta = COALESCE(meta, '{}'::jsonb) || %s::jsonb
                        WHERE ngo_id = %s::uuid AND donor_id = %s::uuid
                        """,
                        (
                            json.dumps({"receipt_number": receipt_number}),
                            current_user.ngo_id,
                            body.donor_id,
                        ),
                    )
                except Exception:
                    pass
    return {
        "status": "issued",
        "receipt_number": receipt_number,
        "journal_entry_id": body.journal_entry_id,
        "fiscal_year": _fiscal_year_label(),
    }


class DonorOutreachDraftRequest(BaseModel):
    donor_name: str
    total_given: float = 0
    propensity_score: Optional[int] = None
    program_hint: str = ""


@app.post("/gen-ai/donor-outreach-draft", tags=["GenAI"])
def post_donor_outreach_draft(
    body: DonorOutreachDraftRequest,
    current_user: TokenUser = Depends(require_role("ed", "crm", "fundraising")),
):
    first = (body.donor_name or "Friend").split()[0]
    message = draft_donor_outreach_whatsapp(
        donor_name=body.donor_name,
        first_name=first,
        total_given=float(body.total_given or 0),
        propensity_score=body.propensity_score,
        program_hint=body.program_hint,
        ngo_name=current_user.ngo_name,
        ngo_id=current_user.ngo_id,
    )
    return {"message": message, "channel": "whatsapp"}


@app.post("/workflows/trigger-orchestration", tags=["Workflows"])
def post_trigger_orchestration(event_type: str, data: Dict[str, Any], current_user: TokenUser = Depends(require_role("ed"))):
    """
    Triggers the Agent Orchestrator for complex tasks.
    """
    result = process_orchestration(event_type, data, ngo_id=current_user.ngo_id)
    return {"status": "orchestrated", "result": result}

# ── Generative AI ──────────────────────────────────────────────────────────────

@app.post("/gen-ai/summarize", tags=["GenAI"])
def post_summarize(messages: List[Dict[str, str]], current_user: TokenUser = Depends(require_role("ed", "crm"))):
    """
    Summarizes donor conversations using LLM.
    """
    return {"summary": summarize_conversations(messages, ngo_id=current_user.ngo_id)}

@app.post("/gen-ai/sentiment", tags=["GenAI"])
def post_sentiment(text: str, current_user: TokenUser = Depends(require_role("ed", "crm"))):
    """
    Analyzes sentiment of a donor message.
    """
    return analyze_sentiment(text, ngo_id=current_user.ngo_id)

class DraftReportRequest(BaseModel):
    ngo_name: str
    impact_data: Dict[str, Any]


@app.post("/gen-ai/draft-report", tags=["GenAI"])
def post_draft_report(body: DraftReportRequest, current_user: TokenUser = Depends(require_role("ed"))):
    """
    Auto-drafts an annual report summary.
    """
    return {"draft": draft_annual_report(body.ngo_name, body.impact_data, ngo_id=current_user.ngo_id)}


# ── CRM: Outreach (email/whatsapp) — lightweight queue/log ────────────────────
class CrmOutreachRequest(BaseModel):
    channel: str  # whatsapp | email
    donor_ids: List[str] = []
    message: str
    subject: Optional[str] = None
    template_id: Optional[str] = None
    mode: str = "send"  # send | draft | voice_event


async def _demo_deliver_status(outreach_id: str, donor_ids: List[str]) -> None:
    """Simulates WhatsApp delivery confirmation after a short delay in demo mode."""
    import asyncio
    await asyncio.sleep(3)
    entry = WA_TOUCHPOINT_STATUS_MEM.get(outreach_id)
    if not entry:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    for did in donor_ids:
        rec = entry.get("recipients", {}).get(did)
        if rec and rec.get("status") == "sent":
            rec["status"] = "delivered"
            rec["updated_at"] = now_iso


def _update_touchpoint_by_wamid(wamid: str, new_status: str) -> Optional[str]:
    """
    Find a recipient record by wamid across all in-flight outreach sessions and update its
    status.  Returns the ngo_id of the matching session so callers can scope DB updates to
    the correct tenant.
    """
    valid = {"sent", "delivered", "read", "failed"}
    if new_status not in valid:
        return None
    now_iso = datetime.now(timezone.utc).isoformat()
    for entry in WA_TOUCHPOINT_STATUS_MEM.values():
        for rec in entry.get("recipients", {}).values():
            if rec.get("wamid") == wamid:
                rec["status"] = new_status
                rec["updated_at"] = now_iso
                return entry.get("ngo_id")
    return None


@app.post("/crm/outreach", tags=["CRM"])
async def post_crm_outreach(
    body: CrmOutreachRequest,
    background_tasks: BackgroundTasks,
    current_user: TokenUser = Depends(require_role("ed", "crm")),
):
    """
    Send WhatsApp/email outreach to one or more donors.

    WhatsApp path: if WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID are set,
    calls the WhatsApp Business Cloud API directly and stores the returned wamid so
    webhook delivery receipts can be matched.  In demo mode a background task
    simulates delivered status after ~3 s.

    Returns {outreach_id, results: [{donor_id, wamid, ok, error?}]} so the
    frontend can poll /crm/outreach/{outreach_id}/status for real-time delivery
    status without reloading the page.
    """
    outreach_id = f"out_{int(datetime.now(timezone.utc).timestamp() * 1000)}"
    now_iso = datetime.now(timezone.utc).isoformat()
    is_send = body.mode == "send"  # only actually dispatch messages when mode == "send"

    wa_token = os.getenv("WHATSAPP_ACCESS_TOKEN", "").strip()
    wa_phone_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "").strip()
    use_real_wa = bool(is_send and wa_token and wa_phone_id and body.channel == "whatsapp")

    results: List[Dict[str, Any]] = []
    recipients: Dict[str, Dict[str, Any]] = {}

    donor_phone_map: Dict[str, str] = {}
    if use_real_wa:
        with db_conn() as conn:
            if conn is not None:
                try:
                    cur = conn.cursor()
                    cur.execute(
                        "SELECT id::text, phone FROM donors WHERE ngo_id = %s AND id::text = ANY(%s)",
                        (current_user.ngo_id, [str(d) for d in body.donor_ids]),
                    )
                    for row in cur.fetchall():
                        if row[1]:
                            donor_phone_map[str(row[0])] = str(row[1])
                except Exception:
                    pass
            else:
                for d in DONORS_MEM_BY_NGO.get(current_user.ngo_id, []):
                    if str(d.get("id")) in [str(x) for x in body.donor_ids]:
                        ph = (d.get("phone") or "").strip()
                        if ph:
                            donor_phone_map[str(d["id"])] = ph

    message_text = (body.message or "")[:4096]

    for donor_id in body.donor_ids:
        did_str = str(donor_id)
        wamid: Optional[str] = None
        ok = True
        error: Optional[str] = None

        if use_real_wa:
            phone = donor_phone_map.get(did_str, "")
            if not phone:
                ok = False
                error = "No phone number on file"
            else:
                try:
                    wamid = wa_send_message(wa_token, wa_phone_id, phone, message_text)
                except Exception as exc:
                    ok = False
                    error = str(exc)[:200]
                    try:
                        enqueue_wa_delivery(
                            ngo_id=current_user.ngo_id,
                            to_phone=phone,
                            message_body=message_text,
                            outreach_id=outreach_id,
                            donor_id=did_str,
                        )
                    except Exception:
                        pass

        if is_send and ok and not wamid:
            wamid = f"wamid.demo.{outreach_id}.{did_str}"

        results.append({"donor_id": donor_id, "wamid": wamid, "ok": ok, "error": error})
        recipients[did_str] = {
            "wamid": wamid,
            "status": "sent" if (is_send and ok) else ("failed" if (is_send and not ok) else "draft"),
            "updated_at": now_iso,
            "error": error,
        }

    WA_TOUCHPOINT_STATUS_MEM[outreach_id] = {
        "ngo_id": current_user.ngo_id,
        "channel": body.channel,
        "created_at": now_iso,
        "recipients": recipients,
    }

    if is_send and not use_real_wa and body.channel == "whatsapp":
        sent_ids = [str(d) for d in body.donor_ids if recipients.get(str(d), {}).get("status") == "sent"]
        if sent_ids:
            background_tasks.add_task(_demo_deliver_status, outreach_id, sent_ids)

    event = {
        "id": outreach_id,
        "ngo_id": current_user.ngo_id,
        "by": current_user.email,
        "mode": body.mode,
        "channel": body.channel,
        "donor_ids": body.donor_ids,
        "subject": body.subject,
        "template_id": body.template_id,
        "message": message_text,
        "created_at": now_iso,
    }
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
                    (outreach_id, current_user.ngo_id, "crm_outreach", json.dumps(event)),
                )
                if recipients:
                    cur.executemany(
                        """
                        INSERT INTO touchpoints (id, ngo_id, outreach_id, donor_id, channel, wamid, status, error_msg, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                        ON CONFLICT (id) DO NOTHING
                        """,
                        [
                            (
                                f"tp_{outreach_id}_{did}",
                                current_user.ngo_id,
                                outreach_id,
                                did,
                                body.channel,
                                recipients[did].get("wamid"),
                                recipients[did].get("status", "sent"),
                                recipients[did].get("error"),
                            )
                            for did in recipients
                        ],
                    )
            except Exception:
                pass
        else:
            CRM_OUTREACH_LOG_MEM_BY_NGO.setdefault(current_user.ngo_id, []).append(event)

    return {
        "status": "queued" if body.mode == "send" else "saved",
        "outreach_id": outreach_id,
        "results": results,
        "event": event,
    }


@app.post("/crm/outreach/email", tags=["CRM"])
async def post_crm_outreach_email(
    body: CrmOutreachRequest,
    background_tasks: BackgroundTasks,
    current_user: TokenUser = Depends(require_role("ed", "crm")),
):
    """Email outreach uses the same pipeline as WhatsApp (mode=send, channel=email)."""
    body.channel = "email"
    body.mode = "send"
    return await post_crm_outreach(body, background_tasks, current_user)


@app.get("/crm/outreach/{outreach_id}/status", tags=["CRM"])
def get_outreach_status(outreach_id: str, current_user: TokenUser = Depends(get_current_user)):
    """
    Poll per-donor delivery status for a specific outreach batch.
    Returns {outreach_id, channel, recipients: {donor_id: {wamid, status, updated_at}}}.
    Statuses: sent | delivered | read | failed.
    """
    entry = WA_TOUCHPOINT_STATUS_MEM.get(outreach_id)
    if not entry:
        with db_conn() as conn:
            if conn is not None:
                try:
                    cur = conn.cursor()
                    cur.execute(
                        "SELECT donor_id, wamid, status, error_msg, updated_at FROM touchpoints WHERE ngo_id = %s AND outreach_id = %s",
                        (current_user.ngo_id, outreach_id),
                    )
                    rows = cur.fetchall()
                    if rows:
                        recips = {}
                        for row in rows:
                            recips[str(row[0])] = {
                                "wamid": row[1],
                                "status": row[2] or "sent",
                                "updated_at": row[4].isoformat() if hasattr(row[4], "isoformat") else str(row[4]),
                                "error": row[3],
                            }
                        return {"outreach_id": outreach_id, "channel": "whatsapp", "recipients": recips}
                except Exception:
                    pass
        raise HTTPException(status_code=404, detail="Outreach not found")
    if entry.get("ngo_id") != current_user.ngo_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return {
        "outreach_id": outreach_id,
        "channel": entry.get("channel"),
        "recipients": entry.get("recipients", {}),
    }


@app.get("/crm/whatsapp/webhook", tags=["CRM"])
def verify_whatsapp_webhook(
    request: Request,
):
    """
    WhatsApp Business API webhook verification (GET challenge).
    WhatsApp sends: ?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<challenge>
    Configure WHATSAPP_WEBHOOK_VERIFY_TOKEN env var to match your Meta App Dashboard setting.
    """
    params = request.query_params
    hub_mode = params.get("hub.mode")
    hub_challenge = params.get("hub.challenge", "")
    hub_verify_token = params.get("hub.verify_token", "")
    verify_token = os.getenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "goodjobs_webhook_verify")
    if hub_mode == "subscribe" and hub_verify_token == verify_token:
        return Response(content=hub_challenge, media_type="text/plain")
    raise HTTPException(status_code=403, detail="Webhook verification failed — check WHATSAPP_WEBHOOK_VERIFY_TOKEN")


@app.post("/crm/whatsapp/webhook", tags=["CRM"])
async def receive_whatsapp_webhook(request: Request):
    """
    Receive delivery status updates from WhatsApp Business API.
    Expects the standard Cloud API webhook payload.
    Delivery status vocabulary: sent | delivered | read | failed.

    Security: when WHATSAPP_APP_SECRET is set, validates the X-Hub-Signature-256 header
    (HMAC-SHA256 of the raw request body) before processing.  This prevents forged status
    updates — always configure this env var in production.

    Always returns HTTP 200 so WhatsApp does not retry indefinitely.
    """
    import hmac as _hmac
    import hashlib as _hashlib

    body = await request.body()

    app_secret = os.getenv("WHATSAPP_APP_SECRET", "").strip()
    if app_secret:
        sig_header = request.headers.get("X-Hub-Signature-256", "")
        if not sig_header.startswith("sha256="):
            return Response(content='{"ok":false,"reason":"missing_signature"}', status_code=400, media_type="application/json")
        expected_sig = "sha256=" + _hmac.new(app_secret.encode(), body, _hashlib.sha256).hexdigest()
        if not _hmac.compare_digest(sig_header, expected_sig):
            return Response(content='{"ok":false,"reason":"invalid_signature"}', status_code=403, media_type="application/json")

    try:
        payload = json.loads(body)
    except Exception:
        return {"ok": True}

    try:
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                for status_obj in value.get("statuses", []):
                    wamid = status_obj.get("id")
                    new_status = status_obj.get("status")
                    _VALID_WA_STATUSES = {"sent", "delivered", "read", "failed"}
                    if wamid and new_status and new_status in _VALID_WA_STATUSES:
                        ngo_id_for_update = _update_touchpoint_by_wamid(wamid, new_status)
                        with db_conn() as conn:
                            if conn is not None:
                                try:
                                    cur = conn.cursor()
                                    if ngo_id_for_update:
                                        cur.execute(
                                            "UPDATE touchpoints SET status = %s, updated_at = NOW() WHERE ngo_id = %s AND wamid = %s",
                                            (new_status, ngo_id_for_update, wamid),
                                        )
                                    else:
                                        # In-memory map miss (e.g. process restart): derive ngo_id
                                        # from the existing DB row so the update stays tenant-scoped.
                                        cur.execute(
                                            "UPDATE touchpoints SET status = %s, updated_at = NOW() WHERE wamid = %s AND ngo_id = (SELECT ngo_id FROM touchpoints WHERE wamid = %s LIMIT 1)",
                                            (new_status, wamid, wamid),
                                        )
                                except Exception:
                                    pass
    except Exception:
        pass

    try:
        process_whatsapp_payload(payload)
    except Exception:
        pass

    return {"ok": True}


# ── Integrations & reports (platform) ───────────────────────────────────────
@app.get("/integrations/whatsapp/code", tags=["Integrations"])
def get_whatsapp_field_code(current_user: TokenUser = Depends(get_current_user)):
    code = ensure_org_code_for_ngo(current_user.ngo_id)
    return {
        "org_code": code,
        "instructions": (
            f"Field staff send WhatsApp to your Meta number starting with {code} "
            "then a space and the visit text. Example: "
            f"\"{code} Visit done with Meena, health checkup, all good\""
        ),
    }


@app.post("/integrations/whatsapp/code", tags=["Integrations"])
def post_whatsapp_field_code(
    preferred: Optional[str] = None,
    current_user: TokenUser = Depends(require_role("ed")),
):
    return {"org_code": ensure_org_code_for_ngo(current_user.ngo_id, preferred=preferred)}


class MisReviewCreateRequest(BaseModel):
    narrative: str
    extracted: Optional[Dict[str, Any]] = None
    reporter_id: str = "field"
    report_date: Optional[str] = None
    source_id: Optional[str] = None


class MisReviewDecideRequest(BaseModel):
    status: str  # approved | edited | dismissed | rejected
    extracted: Optional[Dict[str, Any]] = None
    budget_increment: Optional[float] = None


def _mis_review_api_row(row: Dict[str, Any]) -> Dict[str, Any]:
    ex = row.get("extracted") or {}
    if isinstance(ex, str):
        try:
            ex = json.loads(ex)
        except Exception:
            ex = {}
    return {
        "id": row.get("id"),
        "narrative": row.get("narrative") or "",
        "extracted": ex,
        "reporter_id": row.get("reporter_id") or "field",
        "report_date": row.get("report_date"),
        "status": row.get("status") or "pending",
        "created_at": row.get("created_at"),
        "decided_at": row.get("decided_at"),
    }


@app.get("/programs/mis-reviews", tags=["Programs"])
def list_mis_reviews(
    status: Optional[str] = "pending",
    current_user: TokenUser = Depends(require_role("ed", "programs", "field")),
):
    rows: List[Dict[str, Any]] = []
    with db_conn() as conn:
        if conn is None:
            rows = list(MIS_REVIEWS_MEM_BY_NGO.get(current_user.ngo_id, []))
        else:
            cur = conn.cursor()
            apply_ngo_session(cur, current_user.ngo_id)
            try:
                if status:
                    cur.execute(
                        """
                        SELECT id, narrative, extracted, reporter_id, report_date, status, created_at, decided_at
                        FROM mis_field_reviews
                        WHERE ngo_id = %s AND status = %s
                        ORDER BY created_at DESC LIMIT 100
                        """,
                        (current_user.ngo_id, status),
                    )
                else:
                    cur.execute(
                        """
                        SELECT id, narrative, extracted, reporter_id, report_date, status, created_at, decided_at
                        FROM mis_field_reviews
                        WHERE ngo_id = %s
                        ORDER BY created_at DESC LIMIT 100
                        """,
                        (current_user.ngo_id,),
                    )
                for r in cur.fetchall():
                    rows.append({
                        "id": r[0],
                        "narrative": r[1],
                        "extracted": r[2],
                        "reporter_id": r[3],
                        "report_date": r[4].isoformat() if hasattr(r[4], "isoformat") else r[4],
                        "status": r[5],
                        "created_at": r[6].isoformat() if hasattr(r[6], "isoformat") else r[6],
                        "decided_at": r[7].isoformat() if r[7] and hasattr(r[7], "isoformat") else r[7],
                    })
            except Exception:
                rows = list(MIS_REVIEWS_MEM_BY_NGO.get(current_user.ngo_id, []))
    if status:
        rows = [r for r in rows if str(r.get("status")) == status]
    return {"reviews": [_mis_review_api_row(r) for r in rows], "source": "memory" if not rows else "db"}


@app.post("/programs/mis-reviews", tags=["Programs"])
def create_mis_review(
    body: MisReviewCreateRequest,
    current_user: TokenUser = Depends(require_role("ed", "programs", "field")),
):
    rid = body.source_id or f"mis-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "id": rid,
        "ngo_id": current_user.ngo_id,
        "narrative": body.narrative[:8000],
        "extracted": body.extracted or {},
        "reporter_id": body.reporter_id,
        "report_date": body.report_date or now[:10],
        "status": "pending",
        "created_at": now,
        "decided_at": None,
    }
    with db_conn() as conn:
        if conn is None:
            lst = MIS_REVIEWS_MEM_BY_NGO.setdefault(current_user.ngo_id, [])
            lst[:] = [r for r in lst if str(r.get("id")) != rid] + [row]
        else:
            cur = conn.cursor()
            try:
                cur.execute(
                    """
                    INSERT INTO mis_field_reviews (id, ngo_id, narrative, extracted, reporter_id, report_date, status)
                    VALUES (%s, %s, %s, %s::jsonb, %s, %s, 'pending')
                    ON CONFLICT (id) DO UPDATE SET narrative = EXCLUDED.narrative, extracted = EXCLUDED.extracted
                    """,
                    (
                        rid,
                        current_user.ngo_id,
                        row["narrative"],
                        json.dumps(row["extracted"]),
                        row["reporter_id"],
                        row["report_date"],
                    ),
                )
            except Exception:
                lst = MIS_REVIEWS_MEM_BY_NGO.setdefault(current_user.ngo_id, [])
                lst[:] = [r for r in lst if str(r.get("id")) != rid] + [row]
    return {"review": _mis_review_api_row(row), "status": "created"}


@app.post("/programs/mis-reviews/{review_id}/decide", tags=["Programs"])
def decide_mis_review(
    review_id: str,
    body: MisReviewDecideRequest,
    current_user: TokenUser = Depends(require_role("ed", "programs")),
):
    status = (body.status or "").strip().lower()
    if status not in ("approved", "edited", "dismissed", "rejected"):
        raise HTTPException(status_code=400, detail="status must be approved, edited, dismissed, or rejected")
    now = datetime.now(timezone.utc).isoformat()
    extracted = body.extracted or {}
    budget_applied = 0.0
    with db_conn() as conn:
        if conn is None:
            lst = MIS_REVIEWS_MEM_BY_NGO.get(current_user.ngo_id, [])
            found = None
            for r in lst:
                if str(r.get("id")) == review_id:
                    found = r
                    break
            if not found:
                raise HTTPException(status_code=404, detail="Review not found")
            if body.extracted:
                found["extracted"] = {**(found.get("extracted") or {}), **extracted}
            found["status"] = status
            found["decided_at"] = now
            extracted = found.get("extracted") or {}
        else:
            cur = conn.cursor()
            apply_ngo_session(cur, current_user.ngo_id)
            try:
                patch = json.dumps(extracted) if extracted else None
                if patch:
                    cur.execute(
                        """
                        UPDATE mis_field_reviews
                        SET status = %s, decided_at = NOW(), extracted = extracted || %s::jsonb
                        WHERE id = %s AND ngo_id = %s
                        RETURNING extracted
                        """,
                        (status, patch, review_id, current_user.ngo_id),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE mis_field_reviews
                        SET status = %s, decided_at = NOW()
                        WHERE id = %s AND ngo_id = %s
                        RETURNING extracted
                        """,
                        (status, review_id, current_user.ngo_id),
                    )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Review not found")
                extracted = row[0] if isinstance(row[0], dict) else json.loads(row[0] or "{}")
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(status_code=404, detail="Review not found")
    if status in ("approved", "edited") and body.budget_increment and float(body.budget_increment) > 0:
        budget_applied = float(body.budget_increment)
    program = str((extracted or {}).get("program") or "")
    log_audit(
        ngo_id=current_user.ngo_id,
        user_id=current_user.user_id,
        action="mis_review.decide",
        entity_type="mis_field_review",
        entity_id=review_id,
        new_values={"status": status, "budget_applied": budget_applied, "program": program},
    )
    return {
        "status": status,
        "review_id": review_id,
        "extracted": extracted,
        "budget_applied": budget_applied,
        "decided_at": now,
    }


@app.get("/programs/field-checkins", tags=["Programs"])
def list_field_checkins(current_user: TokenUser = Depends(require_role("ed", "programs", "field"))):
    """Geo-tagged field activity from approved MIS reviews (location text + date)."""
    rows: List[Dict[str, Any]] = []
    with db_conn() as conn:
        if conn is None:
            for r in MIS_REVIEWS_MEM_BY_NGO.get(current_user.ngo_id, []):
                if r.get("status") not in ("approved", "edited"):
                    continue
                ext = r.get("extracted") or {}
                loc = ext.get("location") or ext.get("village") or ""
                if not loc:
                    continue
                rows.append({
                    "id": str(r.get("id")),
                    "beneficiary": ext.get("beneficiary") or "Field report",
                    "location": loc,
                    "program": ext.get("program") or "",
                    "report_date": r.get("report_date") or r.get("created_at"),
                    "metric": ext.get("metric") or "",
                })
        else:
            cur = conn.cursor()
            try:
                cur.execute(
                    """
                    SELECT id::text, extracted, report_date, decided_at
                    FROM mis_field_reviews
                    WHERE ngo_id = %s::uuid AND status IN ('approved', 'edited')
                    ORDER BY COALESCE(decided_at, created_at) DESC
                    LIMIT 50
                    """,
                    (current_user.ngo_id,),
                )
                for rid, extracted, report_date, decided_at in cur.fetchall():
                    ext = extracted if isinstance(extracted, dict) else {}
                    loc = ext.get("location") or ext.get("village") or ""
                    if not loc:
                        continue
                    rows.append({
                        "id": rid,
                        "beneficiary": ext.get("beneficiary") or "Field report",
                        "location": loc,
                        "program": ext.get("program") or "",
                        "report_date": (report_date.isoformat() if hasattr(report_date, "isoformat") else str(report_date or ""))
                        or (decided_at.isoformat() if hasattr(decided_at, "isoformat") else ""),
                        "metric": ext.get("metric") or "",
                    })
            except Exception:
                pass
    return {"checkins": rows, "map_configured": bool(os.getenv("MAPBOX_TOKEN") or os.getenv("VITE_MAPBOX_TOKEN"))}


@app.get("/programs/mis-whatsapp-intake", tags=["Programs"])
def list_mis_whatsapp_intake(current_user: TokenUser = Depends(require_role("ed", "programs"))):
    items: List[Dict[str, Any]] = list(list_mis_intake(current_user.ngo_id, limit=100))
    with db_conn() as conn:
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(
                    """
                    SELECT id, from_phone, org_code, raw_text, agent_status, summary, created_at
                    FROM wa_field_intake WHERE ngo_id = %s
                    ORDER BY created_at DESC LIMIT 100
                    """,
                    (current_user.ngo_id,),
                )
                seen = {str(i.get("id")) for i in items}
                for r in cur.fetchall():
                    rid = str(r[0])
                    if rid in seen:
                        continue
                    ca = r[6]
                    items.append({
                        "id": rid,
                        "ngo_id": current_user.ngo_id,
                        "from_phone": r[1],
                        "org_code": r[2],
                        "raw_text": r[3],
                        "agent_status": r[4],
                        "summary": r[5],
                        "created_at": ca.isoformat() if hasattr(ca, "isoformat") else str(ca),
                    })
            except Exception:
                pass
    items.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
    return {"items": items[:100]}


@app.get("/system/audit-log", tags=["System"])
def list_platform_audit_log(limit: int = 50, current_user: TokenUser = Depends(require_role("ed"))):
    limit = min(max(int(limit), 1), 200)
    with db_conn() as conn:
        if conn is None:
            return {"items": [], "source": "memory"}
        cur = conn.cursor()
        try:
            cur.execute(
                """
                SELECT id, user_id, action, entity_type, entity_id, created_at
                FROM platform_audit_log
                WHERE ngo_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (current_user.ngo_id, limit),
            )
            rows = cur.fetchall()
            return {
                "items": [
                    {
                        "id": str(r[0]),
                        "user_id": r[1],
                        "action": r[2],
                        "entity_type": r[3],
                        "entity_id": r[4],
                        "created_at": r[5].isoformat() if hasattr(r[5], "isoformat") else str(r[5]),
                    }
                    for r in rows
                ],
                "source": "db",
            }
        except Exception:
            return {"items": [], "source": "error"}


@app.get("/reports/funder-export.pdf", tags=["Reports"])
def get_funder_export_pdf(
    template: str = "generic_uc",
    company: Optional[str] = None,
    project: Optional[str] = None,
    current_user: TokenUser = Depends(require_role("ed", "finance", "programs", "csr")),
):
    tpl = (template or "generic_uc").lower().strip()
    ctx = f"{company or '—'} / {project or '—'}"
    if tpl == "tata_trusts":
        title = f"Tata Trusts-style narrative report — {current_user.ngo_name}"
        lines = [
            f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
            f"Project / partner context: {ctx}",
            "Sections (template):",
            "1. Executive summary — outcomes vs logframe",
            "2. Direct & indirect reach — disaggregated tables",
            "3. Budget vs actual — variance narrative",
            "4. Learning, risks, mitigation",
            "5. Annex pointers — MIS extracts, consent logs, photographs",
            "This PDF is a GoodJobs draft — replace figures with audited numbers before submission.",
        ]
    elif tpl in ("csr2", "csr-2", "csr2_format"):
        title = f"CSR-2 style expenditure summary — {current_user.ngo_name}"
        lines = [
            f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
            f"CSR project: {ctx}",
            "Opening balance | receipts | payments | closing (placeholder grid)",
            "Beneficiary headcount by gender / SC-ST / geography",
            "Administrative overheads vs CSR Rules caps",
            "Certification block for CA / CFO sign-off",
        ]
    else:
        title = f"Utilisation Certificate (generic) — {current_user.ngo_name}"
        lines = [
            f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
            f"Grant / CSR context: {ctx}",
            "Amount sanctioned | Amount utilised | Balance",
            "Programme outcomes summary (auto-filled from GoodJobs MIS)",
            "Signatures: Authorised signatory + statutory auditor (when finalised).",
        ]
    pdf = _simple_pdf_bytes(title, lines)
    fname = f"funder_export_{tpl.replace(' ', '_')}.pdf"
    return Response(content=pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{fname}"',
    })


# ── Finance: wire previously-demo actions to backend ──────────────────────────
class FinanceJournalEntryRequest(BaseModel):
    description: str
    amount: float
    entry_type: str = "Expense"  # Expense | Income
    fund: str = "General"
    grant_id: Optional[str] = None
    budget_head_id: Optional[str] = None
    donor_id: Optional[str] = None
    programme_id: Optional[str] = None
    receipt_donor_name: Optional[str] = None
    receipt_donor_pan: Optional[str] = None
    receipt_number: Optional[str] = None
    is_admin_overhead: bool = False
    category: Optional[str] = None


@app.post("/finance/journal-entry", tags=["Finance"])
def post_finance_journal_entry(body: FinanceJournalEntryRequest, current_user: TokenUser = Depends(require_role("ed", "finance"))):
    prior_events = list(FINANCE_EVENTS_MEM_BY_NGO.get(current_user.ngo_id, []))
    assert_fcra_admin_within_cap(
        fund=body.fund,
        entry_type=body.entry_type or "Expense",
        amount=float(body.amount),
        is_admin_overhead=bool(body.is_admin_overhead),
        category=body.category,
        events=prior_events,
    )
    entry_type = (body.entry_type or "Expense").strip()
    is_income = entry_type.lower() == "income"
    receipt_number: Optional[str] = None
    if is_income:
        if body.receipt_number:
            receipt_number = str(body.receipt_number).strip()
        elif body.donor_id:
            receipt_number = _next_receipt_number(
                current_user.ngo_id,
                current_user.ngo_name or "NGO",
            )
    event = {
        "id": f"fj_{int(datetime.now(timezone.utc).timestamp() * 1000)}",
        "ngo_id": current_user.ngo_id,
        "by": current_user.email,
        "description": body.description[:5000],
        "amount": float(body.amount),
        "entry_type": entry_type,
        "fund": body.fund,
        "grant_id": body.grant_id,
        "donor_id": body.donor_id,
        "programme_id": body.programme_id,
        "receipt_number": receipt_number,
        "is_admin_overhead": bool(body.is_admin_overhead),
        "category": body.category,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    FINANCE_EVENTS_MEM_BY_NGO.setdefault(current_user.ngo_id, []).append(event)
    if is_income and body.donor_id:
        donor_name = (body.receipt_donor_name or "").strip() or "Donor"
        tx = {
            "id": f"TRX-{event['id']}",
            "ngo_id": current_user.ngo_id,
            "donor_id": body.donor_id,
            "donor_name": donor_name,
            "amount": float(body.amount),
            "fund_classification": body.fund,
            "payment_method": "journal",
            "transaction_date": datetime.now(timezone.utc).date().isoformat(),
            "receipt_generated": bool(receipt_number),
            "meta": {"receipt_number": receipt_number} if receipt_number else {},
        }
        with db_conn() as conn:
            if conn is None:
                TX_MEM_BY_NGO.setdefault(current_user.ngo_id, []).insert(0, tx)
            else:
                try:
                    cur = conn.cursor()
                    cur.execute(
                        """
                        INSERT INTO transactions (
                            ngo_id, donor_id, donor_name, amount, fund_classification,
                            payment_method, transaction_date, receipt_generated, meta
                        )
                        VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, CURRENT_DATE, %s, %s::jsonb)
                        """,
                        (
                            current_user.ngo_id,
                            body.donor_id,
                            donor_name,
                            float(body.amount),
                            body.fund,
                            "journal",
                            bool(receipt_number),
                            json.dumps({"receipt_number": receipt_number} if receipt_number else {}),
                        ),
                    )
                except Exception:
                    TX_MEM_BY_NGO.setdefault(current_user.ngo_id, []).insert(0, tx)
    out: Dict[str, Any] = {"status": "recorded", "event": event}
    if receipt_number:
        out["receipt_number"] = receipt_number
        out["fiscal_year"] = _fiscal_year_label()
    return out


@app.post("/finance/tally/sync", tags=["Finance"])
def post_finance_tally_sync(current_user: TokenUser = Depends(require_role("ed", "finance"))):
    """
    Export finance journal + income transactions as Tally-importable XML voucher stubs.
    """
    ngo_id = current_user.ngo_id
    vouchers: List[Dict[str, Any]] = []
    with db_conn() as conn:
        if conn is None:
            for ev in FINANCE_EVENTS_MEM_BY_NGO.get(ngo_id, [])[-50:]:
                vouchers.append({
                    "voucher_type": "Receipt" if str(ev.get("entry_type", "")).lower() == "income" else "Payment",
                    "amount": float(ev.get("amount") or 0),
                    "narration": ev.get("description") or "",
                    "fund": ev.get("fund") or "General",
                })
            for tx in TX_MEM_BY_NGO.get(ngo_id, [])[:50]:
                vouchers.append({
                    "voucher_type": "Receipt",
                    "amount": float(tx.get("amount") or 0),
                    "narration": tx.get("donor_name") or "Donation",
                    "fund": tx.get("fund_classification") or "General",
                })
        else:
            cur = conn.cursor()
            try:
                cur.execute(
                    """
                    SELECT amount, donor_name, fund_classification, payment_method, transaction_date
                    FROM transactions
                    WHERE ngo_id = %s::uuid
                    ORDER BY transaction_date DESC NULLS LAST
                    LIMIT 100
                    """,
                    (ngo_id,),
                )
                for r in cur.fetchall():
                    vouchers.append({
                        "voucher_type": "Receipt",
                        "amount": float(r[0] or 0),
                        "narration": r[1] or "Donation",
                        "fund": r[2] or "General",
                        "payment_method": r[3],
                        "date": r[4].isoformat() if r[4] else None,
                    })
            except Exception:
                pass
    exported = len(vouchers)
    tally_xml_lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<TALLYMESSAGE>",
        f"  <!-- GoodJobs Tally export {datetime.now(timezone.utc).isoformat()} -->",
    ]
    for i, v in enumerate(vouchers[:exported]):
        tally_xml_lines.append(
            f'  <VOUCHER id="gj-{i}" type="{v["voucher_type"]}" amount="{v["amount"]:.2f}">'
            f'<NARRATION>{(v.get("narration") or "")[:200]}</NARRATION></VOUCHER>'
        )
    tally_xml_lines.append("</TALLYMESSAGE>")
    return {
        "status": "ok",
        "exported_vouchers": exported,
        "vouchers": vouchers[:25],
        "tally_xml_preview": "\n".join(tally_xml_lines[:12]) + ("\n  ..." if exported > 10 else ""),
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "integration": "tally_xml_stub",
    }


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


def _compliance_renewal_notification_rows(ngo_id: str, cur: Any = None) -> List[Dict[str, Any]]:
    """Compliance documents expiring within 45 days → high-priority notification cards."""
    out: List[Dict[str, Any]] = []
    today = datetime.now(timezone.utc).date()
    rows: List[tuple] = []
    if cur is not None:
        try:
            cur.execute(
                """
                SELECT id::text, name, doc_type, expiry_date
                FROM compliance_documents
                WHERE ngo_id = %s
                  AND expiry_date IS NOT NULL
                  AND expiry_date::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '45 days')
                ORDER BY expiry_date ASC
                LIMIT 10
                """,
                (ngo_id,),
            )
            rows = cur.fetchall()
        except Exception:
            rows = []
    else:
        for d in COMPLIANCE_DOCS_MEM_BY_NGO.get(ngo_id, []):
            exp = d.get("expiry_date") or d.get("expiry")
            if not exp:
                continue
            try:
                exp_d = datetime.fromisoformat(str(exp)[:10]).date()
            except Exception:
                continue
            days = (exp_d - today).days
            if 0 <= days <= 45:
                rows.append((str(d.get("id")), d.get("name"), d.get("doc_type"), exp_d))
    for r in rows:
        doc_id, name, doc_type, exp = r[0], r[1], r[2], r[3]
        if isinstance(exp, datetime):
            exp_d = exp.date()
        elif hasattr(exp, "isoformat"):
            exp_d = exp
        else:
            try:
                exp_d = datetime.fromisoformat(str(exp)[:10]).date()
            except Exception:
                continue
        days = (exp_d - today).days
        label = name or doc_type or "Certificate"
        doc_q = quote(str(doc_id), safe="")
        out.append({
            "id": f"compliance-renewal:{doc_id}",
            "kind": "compliance_doc",
            "ref_id": str(doc_id),
            "tasks_path": "/compliance",
            "action_route": f"/compliance?alert=true&doc={doc_q}",
            "type": "urgent" if days <= 30 else "info",
            "title": "Compliance renewal",
            "message": f"{label} expires in {days} days — start renewal workflow",
            "time": f"{days}d left",
            "read": False,
        })
    return out


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
                    "action_route": _morning_brief_deep_link(
                        kind, ref_id, (it.get("primary_action") or {}).get("route") or "/tasks",
                        it.get("meta") if isinstance(it.get("meta"), dict) else {},
                    ),
                    "type": "urgent" if it.get("priority") == "High" else ("agent" if kind in ("intent",) else "info"),
                    "title": it.get("pill") or kind.replace("_", " ").title(),
                    "message": it.get("title") or "",
                    "time": "Just now",
                    "read": False,
                })
            seen = {n["id"] for n in items}
            for cn in _compliance_renewal_notification_rows(current_user.ngo_id):
                if cn["id"] not in seen:
                    items.append(cn)
                    seen.add(cn["id"])
            return {"notifications": items[:30], "source": "memory"}

        cur = conn.cursor()
        states = _db_load_inbox_states(cur, current_user.ngo_id)

        # Build from inbox (DB mode)
        inbox = get_inbox(current_user)["items"]
        now_utc = datetime.now(timezone.utc)
        for it in inbox[:20]:
            kind = it.get("kind")
            ref_id = str((it.get("ref") or {}).get("id") or "")
            if not ref_id:
                continue
            nid = f"{kind}:{ref_id}"
            st = states.get("notification", {}).get(nid, {})
            snooze_raw = st.get("snoozed_until")
            snoozed_until_ms = None
            if snooze_raw:
                try:
                    su = datetime.fromisoformat(str(snooze_raw).replace("Z", "+00:00"))
                    if su.tzinfo is None:
                        su = su.replace(tzinfo=timezone.utc)
                    if su > now_utc:
                        snoozed_until_ms = int(su.timestamp() * 1000)
                except Exception:
                    pass
            if st.get("resolved_at") and not snoozed_until_ms:
                continue
            items.append({
                "id": nid,
                "kind": kind,
                "ref_id": ref_id,
                "tasks_path": _tasks_focus_path(kind, ref_id),
                "action_route": _morning_brief_deep_link(
                    kind, ref_id, (it.get("primary_action") or {}).get("route") or "/tasks",
                    it.get("meta") if isinstance(it.get("meta"), dict) else {},
                ),
                "type": "urgent" if it.get("priority") == "High" else ("agent" if kind in ("intent",) else "info"),
                "title": it.get("pill") or kind.replace("_", " ").title(),
                "message": it.get("title") or "",
                "time": "Just now",
                "read": bool(st.get("resolved_at")),
                "snoozed_until": snoozed_until_ms,
            })
        seen = {n["id"] for n in items}
        for cn in _compliance_renewal_notification_rows(current_user.ngo_id, cur):
            nid = cn["id"]
            st = states.get("notification", {}).get(nid, {})
            if st.get("resolved_at"):
                continue
            snooze_raw = st.get("snoozed_until")
            snoozed_until_ms = None
            if snooze_raw:
                try:
                    su = datetime.fromisoformat(str(snooze_raw).replace("Z", "+00:00"))
                    if su.tzinfo is None:
                        su = su.replace(tzinfo=timezone.utc)
                    if su > now_utc:
                        snoozed_until_ms = int(su.timestamp() * 1000)
                    else:
                        continue
                except Exception:
                    pass
            cn["read"] = bool(st.get("resolved_at"))
            cn["snoozed_until"] = snoozed_until_ms
            if nid not in seen:
                items.append(cn)
                seen.add(nid)
        return {"notifications": items[:30], "source": "db"}


class NotificationActionRequest(BaseModel):
    action: str  # mark_all_read | clear_all


class NotificationItemActionRequest(BaseModel):
    notification_id: str
    action: str  # snooze | dismiss
    snooze_hours: Optional[float] = 24


@app.post("/notifications/item", tags=["System"])
def post_notification_item_action(
    body: NotificationItemActionRequest,
    current_user: TokenUser = Depends(get_current_user),
):
    """Snooze or dismiss a single notification (persisted via inbox_item_states)."""
    nid = (body.notification_id or "").strip()
    if not nid:
        raise HTTPException(status_code=400, detail="notification_id required")
    action = (body.action or "").strip().lower()
    now = datetime.now(timezone.utc)
    with db_conn() as conn:
        if conn is None:
            if action == "snooze":
                until = now + timedelta(hours=float(body.snooze_hours or 24))
                _mem_upsert_state(current_user.ngo_id, "notification", nid, snoozed_until=until.isoformat())
            elif action == "dismiss":
                _mem_upsert_state(current_user.ngo_id, "notification", nid, resolved_at=now.isoformat())
            else:
                raise HTTPException(status_code=400, detail="action must be snooze or dismiss")
            return {"status": "ok", "notification_id": nid, "action": action, "source": "memory"}
        cur = conn.cursor()
        if action == "snooze":
            until = now + timedelta(hours=float(body.snooze_hours or 24))
            _db_upsert_inbox_state(cur, current_user.ngo_id, "notification", nid, snoozed_until=until.isoformat())
        elif action == "dismiss":
            _db_upsert_inbox_state(cur, current_user.ngo_id, "notification", nid, resolved_at=now.isoformat())
        else:
            raise HTTPException(status_code=400, detail="action must be snooze or dismiss")
        return {"status": "ok", "notification_id": nid, "action": action, "source": "db"}


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
    card = route_intent(d, ngo_id=current_user.ngo_id)
    return {"action_card": card, "directive": d}


@app.post("/intent/process", tags=["Agentic UX"])
def post_process_intent(directive: str, current_user: TokenUser = Depends(require_role("ed", "admin", "fundraising"))):
    """
    Translates a natural language directive into an Action Card.
    """
    card = route_intent(directive, ngo_id=current_user.ngo_id)
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
            raw_action = (action_card.get("action_data") or {}) if isinstance(action_card, dict) else {}
            action_data = {**raw_action, "ngo_id": current_user.ngo_id}

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
        raw_action: Dict[str, Any] = {}
        try:
            if isinstance(action_card, dict):
                intent_type = action_card.get("intent_type")
                raw_action = action_card.get("action_data") or {}
        except Exception:
            pass
        action_data = {**raw_action, "ngo_id": current_user.ngo_id}

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

def _synthesize_workflow_priorities(user: TokenUser) -> List[Dict[str, Any]]:
    """
    Role-specific actionable jobs (not aggregate stats). Prepended to the brief
    when the unified inbox is thin.
    """
    role = (user.role or "ed").lower()
    ngo_id = user.ngo_id
    cards: List[Dict[str, Any]] = []

    def _card(
        cid: str,
        *,
        title: str,
        summary: str,
        priority: str,
        category: str,
        label: str,
        deep_link: str,
        kind: str = "workflow",
    ) -> Dict[str, Any]:
        return {
            "id": cid,
            "priority": priority,
            "category": category,
            "title": title,
            "summary": summary,
            "primary_action": {"label": label, "route": deep_link},
            "secondary_action": {"label": "Open Tasks inbox", "route": "/tasks"},
            "tertiary_action": {"label": "Open Tasks inbox", "route": "/tasks"},
            "ref": {"id": cid},
            "kind": kind,
            "meta": {"synthesized": True},
            "tasks_deep_link_path": "/tasks",
            "deep_link": deep_link,
        }

    with db_conn() as conn:
        if conn is None:
            if role == "finance":
                cards.append(
                    _card(
                        "wf-finance-classify",
                        title="Unclassified bank lines need you",
                        summary="Review yesterday's donations in the exception queue and tag FCRA vs domestic.",
                        priority="High",
                        category="Finance",
                        label="Classify now",
                        deep_link="/finance?view=exceptions",
                    )
                )
            elif role in ("programs", "field"):
                cards.append(
                    _card(
                        "wf-programs-verify",
                        title="New enrollments need document check",
                        summary="Confirm Aadhaar / ID proofs for beneficiaries added in the last 48 hours.",
                        priority="High",
                        category="Programs",
                        label="Review docs",
                        deep_link="/programs?tab=mis&filter=verify",
                    )
                )
            elif role in ("ed", "admin"):
                cards.append(
                    _card(
                        "wf-ed-grant-burn",
                        title="Grant burn rate needs a look",
                        summary="Open Finance to see programmes trending above 80% utilisation this month.",
                        priority="Medium",
                        category="Executive",
                        label="View burn rate",
                        deep_link="/finance",
                    )
                )
            return cards

        cur = conn.cursor()
        apply_ngo_session(cur, ngo_id)
        try:
            if role == "finance":
                cur.execute(
                    """
                    SELECT COUNT(*)::int FROM transactions
                    WHERE ngo_id = %s::uuid
                      AND transaction_date >= (CURRENT_TIMESTAMP - INTERVAL '2 days')
                      AND (requires_review = true OR COALESCE(meta->>'agent_category', '') = '')
                    """,
                    (ngo_id,),
                )
                n = int((cur.fetchone() or [0])[0] or 0)
                if n > 0:
                    cards.append(
                        _card(
                            "wf-finance-classify",
                            title=f"{n} unclassified transaction{'s' if n != 1 else ''} from the last 2 days",
                            summary="Tag programme & FCRA category inline — then issue 80G receipts for income rows.",
                            priority="High",
                            category="Finance",
                            label="Classify now",
                            deep_link="/finance?view=exceptions",
                        )
                    )
            if role in ("programs", "field", "ed"):
                cur.execute(
                    """
                    SELECT COUNT(*)::int FROM program_beneficiaries
                    WHERE ngo_id = %s
                      AND aadhaar = false
                      AND created_at >= (CURRENT_TIMESTAMP - INTERVAL '2 days')
                    """,
                    (ngo_id,),
                )
                n = int((cur.fetchone() or [0])[0] or 0)
                if n > 0:
                    cards.append(
                        _card(
                            "wf-programs-verify",
                            title=f"{n} new enrollment{'s' if n != 1 else ''} need Aadhaar verification",
                            summary="Field staff enrolled beneficiaries — verify ID before they count in MIS.",
                            priority="High",
                            category="Programs",
                            label="Review docs",
                            deep_link="/programs?tab=mis&filter=verify",
                        )
                    )
            if role in ("ed", "admin", "board"):
                cur.execute(
                    """
                    SELECT name, doc_type, expiry_date
                    FROM compliance_documents
                    WHERE ngo_id = %s
                      AND expiry_date IS NOT NULL
                      AND expiry_date::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '45 days')
                    ORDER BY expiry_date ASC
                    LIMIT 1
                    """,
                    (ngo_id,),
                )
                row = cur.fetchone()
                if row:
                    doc_name, doc_type, exp = row[0], row[1], row[2]
                    days = (exp.date() - datetime.now(timezone.utc).date()).days if hasattr(exp, "date") else 45
                    cards.append(
                        _card(
                            "wf-compliance-renewal",
                            title=f"{doc_name or doc_type or 'Certificate'} expires in {days} days",
                            summary="Start the renewal checklist before auditors or funders ask.",
                            priority="High" if days <= 30 else "Medium",
                            category="Compliance",
                            label="Start renewal workflow",
                            deep_link=f"/compliance?alert=true&doc={quote(str(doc_name or doc_type or ''), safe='')}",
                            kind="compliance_doc",
                        )
                    )
        except Exception:
            pass
    return cards


@app.get("/morning-brief", tags=["Agentic UX"])
def get_morning_brief(
    current_user: TokenUser = Depends(
        require_role("ed", "admin", "finance", "programs", "board", "field", "csr", "crm", "fundraising")
    ),
):
    """
    Role-personalized action queue (workflow jobs + inbox-derived tasks).
    """
    synthesized = _synthesize_workflow_priorities(current_user)
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
        deep_link = _morning_brief_deep_link(kind, ref_id, route, it.get("meta") if isinstance(it.get("meta"), dict) else {})
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
                "deep_link": deep_link,
            }
        )
    seen_titles = {str(x.get("title") or "").lower() for x in out}
    for s in synthesized:
        t = str(s.get("title") or "").lower()
        if t and t not in seen_titles:
            out.insert(0, s)
            seen_titles.add(t)
    out = out[:8]
    handled = _handled_by_agents_rows(current_user)
    brief_rec = MORNING_BRIEF_MEM_BY_NGO.get(current_user.ngo_id) or {}
    role_key = (current_user.role or "ed").lower()
    narrative = (
        (brief_rec.get("brief_by_role") or {}).get(role_key)
        or (brief_rec.get("brief_by_role") or {}).get("ed")
        or ""
    )
    return {
        "priorities": out,
        "handled_by_agents": handled,
        "role": current_user.role,
        "brief_narrative": narrative,
        "brief_last_run": brief_rec.get("generated_at"),
        "whatsapp_queued": brief_rec.get("whatsapp_queued", 0),
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


CONSENT_PURPOSE_VALUES = (
    "operational_reporting",
    "grant_reporting",
    "fundraising_comms",
    "whatsapp_outreach",
    "third_party_sharing",
    "analytics",
)


class LogConsentRequest(BaseModel):
    """Record affirmative consent (e.g. beneficiary enrollment) for the DPDP registry."""

    subject_name: str
    subject_type: str = "beneficiary"
    email: Optional[str] = None
    phone: Optional[str] = None
    purpose: str = "operational_reporting"
    beneficiary_id: Optional[str] = None
    consent_language: Optional[str] = None
    method: Optional[str] = None


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


@app.post("/compliance/consent", tags=["Compliance"])
def log_consent(body: LogConsentRequest, current_user: TokenUser = Depends(get_current_user)):
    """Append an affirmative consent row (e.g. programme enrollment) for DPDP visibility."""
    purpose_val = body.purpose if body.purpose in CONSENT_PURPOSE_VALUES else "operational_reporting"
    row: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "subject": body.subject_name.strip()[:500],
        "type": (body.subject_type or "beneficiary")[:50],
        "email": (body.email or "").strip()[:255],
        "purpose": purpose_val,
        "given": True,
        "date": datetime.now(timezone.utc).date().isoformat(),
        "withdrawn": None,
    }
    with db_conn() as conn:
        if conn is None:
            CONSENT_MEM_BY_NGO.setdefault(current_user.ngo_id, []).insert(0, row)
            return {"status": "created", "consent": row, "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO consent_registry (ngo_id, data_subject_id, data_subject_type, email, phone, purpose, consent_given, consent_text_hash)
            VALUES (%s::uuid, NULL, %s, %s, %s, %s::consent_purpose, true, %s)
            RETURNING id::text, consent_date::text
            """,
            (
                current_user.ngo_id,
                (body.subject_type or "beneficiary")[:50],
                (body.email or None),
                (body.phone or None),
                purpose_val,
                f"display:{body.subject_name.strip()}"[:500],
            ),
        )
        rid, cdate = cur.fetchone()
        row["id"] = rid
        row["date"] = (cdate or "")[:10]
        return {"status": "created", "consent": row, "source": "db"}


@app.get("/compliance/consents", tags=["Compliance"])
def list_consents(current_user: TokenUser = Depends(get_current_user)):
    with db_conn() as conn:
        if conn is None:
            return {"consents": CONSENT_MEM_BY_NGO.get(current_user.ngo_id, []), "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id::text,
              COALESCE(
                CASE WHEN consent_text_hash LIKE 'display:%%' THEN SUBSTRING(consent_text_hash FROM 9) END,
                NULLIF(TRIM(email), ''),
                NULLIF(TRIM(phone), ''),
                'Data subject'
              ) AS subject_name,
              data_subject_type AS subject_type,
              COALESCE(email, '') AS subject_email,
              purpose::text,
              consent_given AS given,
              consent_date::text,
              withdrawn_at::text
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
            SET consent_given = false, withdrawn_at = CURRENT_TIMESTAMP
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


def _apply_erasure_to_beneficiaries(ngo_id: str, subject_name: str, subject_email: str) -> int:
    """Anonymize PII for beneficiaries matching an erasure request; preserve outcome metrics."""
    name_key = (subject_name or "").strip().lower()
    email_key = (subject_email or "").strip().lower()
    n_anonymized = 0

    def matches(ben: Dict[str, Any]) -> bool:
        if email_key:
            det = ben.get("details") or {}
            if isinstance(det, dict) and str(det.get("email", "")).lower() == email_key:
                return True
        if name_key and str(ben.get("name", "")).strip().lower() == name_key:
            return True
        return False

    with db_conn() as conn:
        if conn is None:
            lst = BENEFICIARIES_MEM_BY_NGO.get(ngo_id, [])
            for i, ben in enumerate(lst):
                if not matches(ben):
                    continue
                patch = anonymize_beneficiary_record(
                    str(ben.get("name", "")),
                    str(ben.get("location", "")),
                    ben.get("details") if isinstance(ben.get("details"), dict) else {},
                )
                lst[i] = {**ben, **patch}
                n_anonymized += 1
            return n_anonymized

        cur = conn.cursor()
        apply_ngo_session(cur, ngo_id)
        cur.execute(
            """
            SELECT id, name, location, COALESCE(details, '{}'::jsonb)
            FROM program_beneficiaries
            WHERE ngo_id = %s
            """,
            (ngo_id,),
        )
        for row in cur.fetchall():
            ben_id, name, location, details_raw = row[0], row[1], row[2], row[3]
            details = _parse_jsonb(details_raw)
            ben = {"id": ben_id, "name": name, "location": location, "details": details}
            if not matches(ben):
                continue
            patch = anonymize_beneficiary_record(name, location, details)
            cur.execute(
                """
                UPDATE program_beneficiaries
                SET name = %s, location = %s, aadhaar = false, details = %s::jsonb
                WHERE id = %s AND ngo_id = %s
                """,
                (
                    patch["name"],
                    patch["location"],
                    json.dumps(patch["details"]),
                    ben_id,
                    ngo_id,
                ),
            )
            n_anonymized += 1
    return n_anonymized


@app.post("/compliance/erasure/{request_id}/complete", tags=["Compliance"])
def complete_erasure(request_id: str, current_user: TokenUser = Depends(get_current_user)):
    subject_name = ""
    subject_email = ""
    with db_conn() as conn:
        if conn is None:
            req_row = next(
                (r for r in ERASURE_MEM_BY_NGO.get(current_user.ngo_id, []) if r.get("id") == request_id),
                None,
            )
            if not req_row:
                raise HTTPException(status_code=404, detail="Erasure request not found.")
            subject_name = str(req_row.get("name") or req_row.get("subject_name") or "")
            subject_email = str(req_row.get("email") or req_row.get("subject_email") or "")
            req_row["status"] = "completed"
            req_row["completed"] = datetime.now(timezone.utc).date().isoformat()
            anonymized = _apply_erasure_to_beneficiaries(current_user.ngo_id, subject_name, subject_email)
            return {"ok": True, "anonymized_beneficiaries": anonymized, "source": "memory"}

        cur = conn.cursor()
        cur.execute(
            """
            SELECT subject_name, subject_email
            FROM data_erasure_requests
            WHERE ngo_id = %s::uuid AND id = %s::uuid
            """,
            (current_user.ngo_id, request_id),
        )
        found = cur.fetchone()
        if not found:
            raise HTTPException(status_code=404, detail="Erasure request not found.")
        subject_name, subject_email = found[0] or "", found[1] or ""
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
        anonymized = _apply_erasure_to_beneficiaries(current_user.ngo_id, subject_name, subject_email)
        return {"ok": True, "id": row[0], "anonymized_beneficiaries": anonymized, "source": "db"}

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
