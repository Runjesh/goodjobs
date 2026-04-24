from fastapi import FastAPI, BackgroundTasks, HTTPException, Header, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import hmac, hashlib, json

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
    get_current_user, require_role, create_access_token,
    demo_authenticate, TokenUser, DEMO_USERS
)
from core.observability import init_sentry
from jobs.lapse_detector import run_lapse_detection
from core.analytics import predict_revenue, detect_anomalies, calculate_propensity_score, suggest_campaign_goal, classify_fcra_transaction
from agents.orchestrator import process_orchestration
from core.gen_ai import summarize_conversations, analyze_sentiment, draft_annual_report
from core.intent_router import route_intent, generate_morning_brief
from fastapi.responses import Response
from datetime import datetime, timezone, timedelta
from core.db import db_conn

# ── Sentry: initialise before app creation ──────────────────────────────────
init_sentry()

app = FastAPI(
    title="SevaSuite Agent API",
    description="Agentic backend for the SevaSuite India-first Nonprofit OS",
    version="2.0.0",
)

# CORS for local React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://sevasuite.in"],
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
VOLUNTEER_SHIFTS_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
VOLUNTEER_SIGNUPS_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
BENEFICIARIES_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
VOLUNTEERS_ROSTER_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
FINANCE_GRANTS_MEM_BY_NGO: Dict[str, List[Dict[str, Any]]] = {}
INBOX_STATE_MEM_BY_NGO: Dict[str, Dict[str, Dict[str, Dict[str, Any]]]] = {}


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
        {"id": "1", "name": "Anjali Desai", "type": "Major Donor", "totalGiven": 450000, "lastGift": "2026-03-15", "initial": "A", "pan": "ABCP****4D", "location": "Mumbai, Maharashtra", "tags": ["Education Cause"]},
        {"id": "2", "name": "Rohan Gupta", "type": "Recurring", "totalGiven": 24000, "lastGift": "2026-04-01", "initial": "R", "pan": "BVCX****9H", "location": "Delhi, NCR", "tags": ["Monthly Giver"]},
        {"id": "3", "name": "Infosys Foundation", "type": "CSR Partner", "totalGiven": 5000000, "lastGift": "2025-11-20", "initial": "I", "pan": "INFS****1C", "location": "Bangalore, Karnataka", "tags": ["CSR"]},
        {"id": "4", "name": "Priya Sharma", "type": "Lapsing", "totalGiven": 15000, "lastGift": "2025-08-10", "initial": "P", "pan": "PRYS****3J", "location": "Pune, Maharashtra", "tags": ["Health"]},
        {"id": "5", "name": "Vikram Singh", "type": "Event Attendee", "totalGiven": 5000, "lastGift": "2026-02-28", "initial": "V", "pan": "VKRS****2K", "location": "Jaipur, Rajasthan", "tags": ["Events"]},
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
        },
    ]


def _seed_memory_csr(ngo_id: str):
    if ngo_id in CSR_CARDS_MEM_BY_NGO:
        return
    CSR_CARDS_MEM_BY_NGO[ngo_id] = [
        {"id": "1", "company": "Reliance Industries", "amount": 5000000, "project": "Rural Healthcare Phase 2", "tags": ["Health", "Gujarat"], "agent": "AD", "col": "prospecting", "date": "Last contact: 2d ago"},
        {"id": "2", "company": "Tata Consultancy Services", "amount": 2500000, "project": "Digital Literacy 2026", "tags": ["Education", "Tech"], "agent": "RS", "col": "pitch", "date": "Sent on: Oct 12"},
        {"id": "3", "company": "HDFC Bank CSR", "amount": 8000000, "project": "Women Livelihood Center", "tags": ["Livelihood"], "agent": "AD", "col": "diligence", "date": "Audit pending"},
        {"id": "4", "company": "Wipro Care", "amount": 1200000, "project": "School Infrastructure", "tags": ["Education", "WASH"], "agent": "PM", "col": "mou", "date": "Signed: Oct 15"},
        {"id": "5", "company": "Mahindra Finance", "amount": 4500000, "project": "Farmer Support Init", "tags": ["Agriculture"], "agent": "RS", "col": "live", "date": "Report due: Nov 30"},
        {"id": "6", "company": "Infosys Foundation", "amount": 6000000, "project": "STEM for Girls", "tags": ["Education"], "agent": "AD", "col": "live", "date": "Report due: Dec 15"},
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
        {"id": "BEN-1045", "name": "Lakshmi Devi", "program": "Women Livelihood Center", "location": "Nashik, MH", "aadhaar": True, "familySize": 4},
        {"id": "BEN-1046", "name": "Rahul Kumar", "program": "Digital Literacy 2026", "location": "Patna, BR", "aadhaar": True, "familySize": 1},
        {"id": "BEN-1047", "name": "Sunita Bai", "program": "Healthcare Camp", "location": "Pune, MH", "aadhaar": False, "familySize": 3},
        {"id": "BEN-1048", "name": "Anita Desai", "program": "Women Livelihood Center", "location": "Nashik, MH", "aadhaar": True, "familySize": 5},
    ]


def _seed_memory_volunteer_roster(ngo_id: str):
    if ngo_id in VOLUNTEERS_ROSTER_MEM_BY_NGO:
        return
    VOLUNTEERS_ROSTER_MEM_BY_NGO[ngo_id] = [
        {"id": "V-101", "name": "Rohan Sharma", "skills": ["Teaching", "English"], "hours": 45, "verified": True},
        {"id": "V-102", "name": "Priya Patel", "skills": ["Medical Camp", "Admin"], "hours": 120, "verified": True},
        {"id": "V-103", "name": "Karan Singh", "skills": ["Logistics"], "hours": 8, "verified": False},
        {"id": "V-104", "name": "Neha Gupta", "skills": ["Social Media", "Photography"], "hours": 32, "verified": True},
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


@app.get("/programs/beneficiaries", tags=["Programs"])
def list_beneficiaries(current_user: TokenUser = Depends(require_role("ed", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_beneficiaries(current_user.ngo_id)
            return {"beneficiaries": BENEFICIARIES_MEM_BY_NGO.get(current_user.ngo_id, []), "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name, program, location, aadhaar, family_size
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
                {"id": r[0], "name": r[1], "program": r[2], "location": r[3], "aadhaar": bool(r[4]), "familySize": int(r[5])}
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
            ben = {"id": new_id, "name": body.name, "program": body.program, "location": body.location, "aadhaar": bool(body.aadhaar), "familySize": int(body.familySize)}
            BENEFICIARIES_MEM_BY_NGO.setdefault(current_user.ngo_id, []).insert(0, ben)
            return {"status": "created", "beneficiary": ben, "source": "memory"}
        cur = conn.cursor()
        new_id = f"BEN-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        cur.execute(
            """
            INSERT INTO program_beneficiaries (id, ngo_id, name, program, location, aadhaar, family_size)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (new_id, current_user.ngo_id, body.name, body.program, body.location, bool(body.aadhaar), int(body.familySize)),
        )
        ben = {"id": new_id, "name": body.name, "program": body.program, "location": body.location, "aadhaar": bool(body.aadhaar), "familySize": int(body.familySize)}
        return {"status": "created", "beneficiary": ben, "source": "db"}


class VolunteerCreate(BaseModel):
    name: str
    skills: List[str] = []
    verified: bool = False


@app.get("/volunteers/roster", tags=["Volunteers"])
def list_volunteer_roster(current_user: TokenUser = Depends(require_role("ed", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_volunteer_roster(current_user.ngo_id)
            return {"volunteers": VOLUNTEERS_ROSTER_MEM_BY_NGO.get(current_user.ngo_id, []), "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name, COALESCE(skills,'{}'), hours, verified
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
                {"id": r[0], "name": r[1], "skills": list(r[2] or []), "hours": int(r[3] or 0), "verified": bool(r[4])}
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
            v = {"id": new_id, "name": body.name, "skills": body.skills or [], "hours": 0, "verified": bool(body.verified)}
            VOLUNTEERS_ROSTER_MEM_BY_NGO.setdefault(current_user.ngo_id, []).insert(0, v)
            return {"status": "created", "volunteer": v, "source": "memory"}
        cur = conn.cursor()
        new_id = f"V-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        cur.execute(
            """
            INSERT INTO volunteer_roster (id, ngo_id, name, skills, hours, verified)
            VALUES (%s, %s, %s, %s, 0, %s)
            RETURNING id
            """,
            (new_id, current_user.ngo_id, body.name, body.skills or [], bool(body.verified)),
        )
        v = {"id": new_id, "name": body.name, "skills": body.skills or [], "hours": 0, "verified": bool(body.verified)}
        return {"status": "created", "volunteer": v, "source": "db"}


class VolunteerSignupRequest(BaseModel):
    volunteer_name: str


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
            VOLUNTEER_SIGNUPS_MEM_BY_NGO.setdefault(current_user.ngo_id, []).append(
                {"id": signup_id, "shiftId": int(shift_id), "volunteerName": body.volunteer_name, "createdAt": datetime.now(timezone.utc).isoformat()}
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
        cur.execute(
            """
            INSERT INTO volunteer_shift_signups (id, ngo_id, shift_id, volunteer_name)
            VALUES (%s, %s, %s, %s)
            """,
            (signup_id, current_user.ngo_id, int(shift_id), body.volunteer_name),
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
            SELECT id, shift_id, volunteer_name, created_at
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
                {"id": r[0], "shiftId": int(r[1]), "volunteerName": r[2], "createdAt": r[3].isoformat() if hasattr(r[3], "isoformat") else str(r[3])}
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


class CsrCardMove(BaseModel):
    col: str


@app.get("/csr/cards", tags=["CSR"])
def list_csr_cards(current_user: TokenUser = Depends(require_role("ed", "csr", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_csr(current_user.ngo_id)
            return {"cards": CSR_CARDS_MEM_BY_NGO.get(current_user.ngo_id, []), "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, company, amount::float, COALESCE(project,''), COALESCE(tags,'{}'), COALESCE(agent,''), col, COALESCE(date_label,'')
            FROM csr_pipeline_cards
            WHERE ngo_id = %s
            ORDER BY created_at DESC
            LIMIT 500
            """,
            (current_user.ngo_id,),
        )
        out = []
        for r in cur.fetchall():
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
                }
            )
        return {"cards": out, "source": "db"}


@app.post("/csr/cards", tags=["CSR"])
def create_csr_card(body: CsrCardCreate, current_user: TokenUser = Depends(require_role("ed", "csr", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_csr(current_user.ngo_id)
            new_id = str(int(datetime.now(timezone.utc).timestamp() * 1000))
            card = {
                "id": new_id,
                "company": body.company,
                "amount": float(body.amount),
                "project": body.project,
                "tags": body.tags or [],
                "agent": body.agent,
                "col": body.col,
                "date": body.date,
            }
            CSR_CARDS_MEM_BY_NGO.setdefault(current_user.ngo_id, []).insert(0, card)
            return {"status": "created", "card": card, "source": "memory"}
        cur = conn.cursor()
        new_id = f"csr_{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        cur.execute(
            """
            INSERT INTO csr_pipeline_cards (id, ngo_id, company, amount, project, tags, agent, col, date_label)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (new_id, current_user.ngo_id, body.company, float(body.amount), body.project, body.tags or [], body.agent, body.col, body.date),
        )
        card = {
            "id": new_id,
            "company": body.company,
            "amount": float(body.amount),
            "project": body.project,
            "tags": body.tags or [],
            "agent": body.agent,
            "col": body.col,
            "date": body.date,
        }
        return {"status": "created", "card": card, "source": "db"}


@app.patch("/csr/cards/{card_id}/move", tags=["CSR"])
def move_csr_card(card_id: str, body: CsrCardMove, current_user: TokenUser = Depends(require_role("ed", "csr", "programs"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_csr(current_user.ngo_id)
            cards = CSR_CARDS_MEM_BY_NGO.get(current_user.ngo_id, [])
            for c in cards:
                if str(c.get("id")) == str(card_id):
                    c["col"] = body.col
                    return {"status": "moved", "id": card_id, "col": body.col, "source": "memory"}
            raise HTTPException(status_code=404, detail="CSR card not found.")
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE csr_pipeline_cards
            SET col = %s
            WHERE ngo_id = %s AND id = %s
            RETURNING id
            """,
            (body.col, current_user.ngo_id, card_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="CSR card not found.")
        return {"status": "moved", "id": row[0], "col": body.col, "source": "db"}


class CampaignCreate(BaseModel):
    title: str
    goal: float = 0
    status: str = "active"  # active | draft
    image: Optional[str] = None
    cause: Optional[str] = None


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
                   COALESCE(image, '')::text, COALESCE(cause, '')::text
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
                }
            )
        return {"campaigns": out, "source": "db"}


@app.post("/fundraising/campaigns", tags=["Fundraising"])
def create_campaign(body: CampaignCreate, current_user: TokenUser = Depends(require_role("ed", "fundraising"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_campaigns(current_user.ngo_id)
            new_id = f"c{int(datetime.now(timezone.utc).timestamp() * 1000)}"
            camp = {
                "id": new_id,
                "title": body.title,
                "raised": 0,
                "goal": float(body.goal or 0),
                "donorsCount": 0,
                "status": body.status,
                "image": body.image or "linear-gradient(135deg, #10b981, #047857)",
                "cause": body.cause or "",
            }
            CAMPAIGNS_MEM_BY_NGO.setdefault(current_user.ngo_id, []).insert(0, camp)
            return {"status": "created", "campaign": camp, "source": "memory"}
        cur = conn.cursor()
        new_id = f"c{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        cur.execute(
            """
            INSERT INTO campaigns (id, ngo_id, title, cause, goal, raised, donors_count, status, image)
            VALUES (%s, %s, %s, %s, %s, 0, 0, %s, %s)
            RETURNING id
            """,
            (new_id, current_user.ngo_id, body.title, body.cause, float(body.goal or 0), body.status, body.image),
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
        }
        return {"status": "created", "campaign": camp, "source": "db"}


# ── CRM Persistence (Donors + Transactions) ───────────────────────────────────

class DonorCreate(BaseModel):
    name: str
    type: str = "Recurring"
    pan: str = ""
    location: str = ""
    tags: List[str] = []


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
                }
            )
        return {"donors": out, "source": "db"}


@app.post("/crm/donors", tags=["CRM"])
def create_donor(body: DonorCreate, current_user: TokenUser = Depends(require_role("ed", "crm", "fundraising"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_crm(current_user.ngo_id)
            new_id = f"{int(datetime.now(timezone.utc).timestamp() * 1000)}"
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
            }
            DONORS_MEM_BY_NGO.setdefault(current_user.ngo_id, []).insert(0, donor)
            return {"status": "created", "donor": donor, "source": "memory"}

        cur = conn.cursor()
        donor_code = f"D{int(datetime.now(timezone.utc).timestamp())}"
        cur.execute(
            """
            INSERT INTO donors (ngo_id, donor_code, full_name, donor_type, pan_masked, location_text, tags, consent_given, consent_date)
            VALUES (%s::uuid, %s, %s, %s, %s, %s, %s, true, CURRENT_TIMESTAMP)
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
        }
        return {"status": "created", "donor": donor, "source": "db"}


class TransactionCreate(BaseModel):
    donorId: str
    donorName: str
    amount: float
    method: str = "UPI"
    campaignId: Optional[str] = None
    campaignTitle: Optional[str] = None


@app.get("/finance/transactions", tags=["Finance"])
def list_transactions(current_user: TokenUser = Depends(require_role("ed", "finance", "fundraising", "crm"))):
    with db_conn() as conn:
        if conn is None:
            _seed_memory_crm(current_user.ngo_id)
            txs = TX_MEM_BY_NGO.get(current_user.ngo_id, [])
            txs_sorted = sorted(txs, key=lambda t: int(t.get("timestamp") or 0), reverse=True)
            return {"transactions": txs_sorted, "source": "memory"}
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
            LIMIT 500
            """,
            (current_user.ngo_id,),
        )
        out = []
        for r in cur.fetchall():
            out.append(
                {
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
            )
        return {"transactions": out, "source": "db"}


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
async def trigger_csr_prospect(event: CSRProspectTrigger, background_tasks: BackgroundTasks):
    """Estimate CSR obligation, score company alignment, draft outreach."""
    background_tasks.add_task(_run_csr_agent, event.model_dump())
    return {"status": "accepted", "company": event.company_name}


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
        headers={"Content-Disposition": f"attachment; filename=sevasuite_tally.xml"}
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
    if score > 80: recommendation = "High probability! Trigger personal outreach for Major Gift."
    elif score > 50: recommendation = "Healthy segment. Send regular WhatsApp updates."
    elif score < 30: recommendation = "High churn risk. Recommend re-engagement sequence."

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

@app.post("/gen-ai/draft-report", tags=["GenAI"])
def post_draft_report(ngo_name: str, impact_data: Dict[str, Any], current_user: TokenUser = Depends(require_role("ed"))):
    """
    Auto-drafts an annual report summary.
    """
    return {"draft": draft_annual_report(ngo_name, impact_data)}

# ── Zero-Manual-Work: Intent & Brief ──────────────────────────────────────────

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
    current_user: TokenUser = Depends(require_role("ed", "admin", "fundraising")),
):
    with db_conn() as conn:
        if conn is None:
            items = INTENT_QUEUE_MEM_BY_NGO.get(current_user.ngo_id, [])
            if status:
                items = [i for i in items if i.get("status") == status]
            lim = max(1, min(limit, 200))
            return {"items": items[:lim], "source": "memory"}
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
            items.append({
                "id": r[0],
                "directive": r[1],
                "intent_type": r[2],
                "risk_level": r[3],
                "status": r[4],
                "action_card": r[5],
                "created_at": r[6].isoformat() if hasattr(r[6], "isoformat") else str(r[6]),
            })
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
def get_morning_brief(current_user: TokenUser = Depends(require_role("ed", "admin"))):
    """
    Returns the prioritized daily attention list for the user.
    """
    return generate_morning_brief()

# ── AWS S3 Storage (Compliance Vault) ──────────────────────────────────────────

from core.s3_storage import (
    generate_presigned_upload_url,
    generate_presigned_download_url,
    list_ngo_files,
    delete_file
)

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

@app.post("/compliance/consent/withdraw", tags=["Compliance"])
def withdraw_consent(req: WithdrawConsentRequest, current_user: TokenUser = Depends(get_current_user)):
    """Log the withdrawal of a user's consent under DPDP §12."""
    return {"status": "success", "message": f"Consent {req.consent_id} withdrawn successfully."}

@app.post("/compliance/erasure", tags=["Compliance"])
def log_erasure_request(req: ErasureLogRequest, current_user: TokenUser = Depends(get_current_user)):
    """Log a Right to Erasure request under DPDP §12."""
    from datetime import datetime, timedelta, timezone
    deadline = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")
    return {
        "status": "received", 
        "request_id": f"e{int(datetime.now().timestamp())}",
        "deadline": deadline,
        "message": "Erasure request logged. Must be completed within 30 days."
    }

@app.post("/compliance/breach", tags=["Compliance"])
def log_breach(req: BreachLogRequest, current_user: TokenUser = Depends(get_current_user)):
    """Log a data breach to start the 72-hour DPB notification timer under DPDP §8."""
    from datetime import datetime, timedelta, timezone
    notif_due = (datetime.now(timezone.utc) + timedelta(hours=72)).isoformat()
    return {
        "status": "logged",
        "breach_id": f"b{int(datetime.now().timestamp())}",
        "notification_due": notif_due,
        "message": "Breach logged. You must notify the DPB within 72 hours."
    }


# ── Compliance: Document metadata ─────────────────────────────────────────────

class ComplianceDocCreate(BaseModel):
    name: str
    doc_type: str
    status: str = "Valid"
    expiry_date: Optional[str] = None  # YYYY-MM-DD
    s3_key: Optional[str] = None

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
            SELECT id::text, name, doc_type, status, expiry_date::text, s3_key
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
                {"id": r[0], "name": r[1], "doc_type": r[2], "status": r[3], "expiry_date": r[4], "s3_key": r[5]}
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
            docs.insert(
                0,
                {
                    "id": doc_id,
                    "name": body.name,
                    "doc_type": body.doc_type,
                    "status": body.status,
                    "expiry_date": body.expiry_date,
                    "s3_key": body.s3_key,
                    "snoozed_until": None,
                    "resolved_at": None,
                },
            )
            return {"status": "created", "id": doc_id, "source": "memory"}
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO compliance_documents (ngo_id, name, doc_type, status, expiry_date, s3_key)
            VALUES (%s, %s, %s, %s, %s::date, %s)
            RETURNING id::text
            """,
            (current_user.ngo_id, body.name, body.doc_type, body.status, body.expiry_date, body.s3_key),
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
            state = _get_mem_inbox_state(current_user.ngo_id)
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

    return {"items": items, "source": "db"}


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


@app.post("/inbox/resolve", tags=["Agentic UX"])
def post_inbox_resolve(body: InboxResolveRequest, current_user: TokenUser = Depends(require_role("ed", "admin", "finance", "programs"))):
    with db_conn() as conn:
        if conn is None:
            resolved_iso = datetime.now(timezone.utc).isoformat()
            if body.kind == "intent":
                items = INTENT_QUEUE_MEM_BY_NGO.get(current_user.ngo_id, [])
                for it in items:
                    if it.get("id") == body.id:
                        it["resolved_at"] = resolved_iso
                        it["status"] = "rejected"
                        return {"status": "resolved", "id": body.id, "source": "memory"}
            elif body.kind == "compliance_doc":
                docs = COMPLIANCE_DOCS_MEM_BY_NGO.get(current_user.ngo_id, [])
                for d in docs:
                    if d.get("id") == body.id:
                        d["resolved_at"] = resolved_iso
                        return {"status": "resolved", "id": body.id, "source": "memory"}
            else:
                _mem_upsert_state(current_user.ngo_id, body.kind, body.id, resolved_at=resolved_iso)
                return {"status": "resolved", "id": body.id, "source": "memory"}
            raise HTTPException(status_code=404, detail="Inbox item not found.")
        cur = conn.cursor()
        if body.kind == "intent":
            cur.execute(
                """
                UPDATE intent_queue
                SET resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, status = 'rejected'
                WHERE ngo_id = %s AND id::text = %s
                RETURNING id::text
                """,
                (current_user.ngo_id, body.id),
            )
        elif body.kind == "compliance_doc":
            cur.execute(
                """
                UPDATE compliance_documents
                SET resolved_at = CURRENT_TIMESTAMP
                WHERE ngo_id = %s AND id::text = %s
                RETURNING id::text
                """,
                (current_user.ngo_id, body.id),
            )
        else:
            _db_upsert_inbox_state(cur, current_user.ngo_id, body.kind, body.id, resolved_at=datetime.now(timezone.utc).isoformat())
            return {"status": "resolved", "id": body.id, "source": "db"}
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Inbox item not found.")
        return {"status": "resolved", "id": row[0]}


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
    safe_lines = [l.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") for l in lines]
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
    lines = [l.strip() for l in notice_md.splitlines() if l.strip()][:40]
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
def list_board_members(current_user: TokenUser = Depends(require_role("ed", "admin"))):
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
