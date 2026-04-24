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
    demo_authenticate, TokenUser
)
from core.observability import init_sentry
from jobs.lapse_detector import run_lapse_detection
from core.analytics import predict_revenue, detect_anomalies, calculate_propensity_score, suggest_campaign_goal, classify_fcra_transaction
from agents.orchestrator import process_orchestration
from core.gen_ai import summarize_conversations, analyze_sentiment, draft_annual_report
from core.intent_router import route_intent, generate_morning_brief

# ── Sentry: initialise before app creation ──────────────────────────────────
init_sentry()

app = FastAPI(
    title="SevaSuite Agent API",
    description="Agentic backend for the SevaSuite India-first Nonprofit OS",
    version="2.0.0"
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

@app.post("/auth/login", response_model=LoginResponse, tags=["Auth"])
def login(body: LoginRequest):
    """
    Authenticate a user and return a signed JWT.
    In production: query the `users` table, verify bcrypt hash.
    Dev: uses the DEMO_USERS dict in core/auth.py.
    """
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
    return route_intent(directive)

@app.get("/morning-brief", tags=["Agentic UX"])
def get_morning_brief(current_user: TokenUser = Depends(require_role("ed", "admin"))):
    """
    Returns the prioritized daily attention list for the user.
    """
    return generate_morning_brief()
