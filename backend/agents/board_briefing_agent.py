"""
Board Briefing Agent — LangGraph State Machine + Daily Cron
Triggers: Runs every day at 6:00 AM IST via cron
Actions: Pull KPIs from all modules → LLM brief generation → Push to dashboard + WhatsApp
"""
from typing import TypedDict, List
from langgraph.graph import StateGraph, END
from langchain_core.messages import HumanMessage

from core.llm_factory import chat_openai
from datetime import date

class BoardBriefingState(TypedDict):
    ngo_id: str
    run_date: str
    fundraising_kpis: dict
    compliance_kpis: dict
    programs_kpis: dict
    csr_kpis: dict
    generated_brief: str
    delivery_channels: List[str]
    delivered: bool
    status: str

def pull_all_kpis(state: BoardBriefingState) -> BoardBriefingState:
    """Node 1: Pull KPIs from all modules (in production, queries Postgres)."""
    print("--- BOARD BRIEFING AGENT: Pulling KPIs from all modules ---")
    
    # In production, these are SELECT queries against the Postgres DB
    fundraising = {
        "total_raised_mtd": 750000,
        "new_donors_this_week": 12,
        "campaigns_active": 2,
        "top_campaign": "Digital Literacy for Rural Girls (62.5% funded)"
    }
    compliance = {
        "documents_expiring_soon": 1,
        "filing_deadlines_this_month": 2,
        "fcra_overhead_pct": 87.5,
        "fcra_warning": True
    }
    programs = {
        "beneficiaries_enrolled_mtd": 45,
        "field_visits_this_week": 23,
        "programs_active": 4
    }
    csr = {
        "pipeline_value_cr": 2.7,
        "proposals_signed_ytd": 2,
        "reports_overdue": 1
    }
    
    return {**state, "fundraising_kpis": fundraising, "compliance_kpis": compliance, "programs_kpis": programs, "csr_kpis": csr}

def generate_brief(state: BoardBriefingState) -> BoardBriefingState:
    """Node 2: Use LLM to generate a concise, executive-level morning brief."""
    print("--- BOARD BRIEFING AGENT: Generating LLM brief ---")
    
    fr = state["fundraising_kpis"]
    comp = state["compliance_kpis"]
    prog = state["programs_kpis"]
    csr = state["csr_kpis"]
    
    prompt = f"""
    You are the AI operating system for an Indian NGO. Write a concise executive morning brief 
    for the board of trustees. Today is {state['run_date']}.
    
    Data:
    - Fundraising: ₹{fr['total_raised_mtd']:,} raised this month, {fr['new_donors_this_week']} new donors this week.
    - Top Campaign: {fr['top_campaign']}
    - Programs: {prog['beneficiaries_enrolled_mtd']} beneficiaries enrolled this month, {prog['field_visits_this_week']} field visits this week.
    - CSR Pipeline: ₹{csr['pipeline_value_cr']}Cr total value, {csr['proposals_signed_ytd']} signed YTD.
    - Compliance Alert: {comp['documents_expiring_soon']} document expiring soon. FCRA overhead at {comp['fcra_overhead_pct']}%.
    
    Write in 3 short paragraphs (Fundraising Update, Programs & Impact, Compliance Alert).
    Use ₹ for currency. Be direct. No fluff. Max 120 words total.
    """
    
    try:
        llm = chat_openai(ngo_id=state.get("ngo_id") or None, model="gpt-4o-mini", temperature=0.4)
        if llm is None:
            raise RuntimeError("no_llm_key")
        response = llm.invoke([HumanMessage(content=prompt)])
        brief = response.content
    except Exception:
        brief = f"""**Morning Brief — {state['run_date']}**

**Fundraising:** ₹{fr['total_raised_mtd']:,} raised this month with {fr['new_donors_this_week']} new donors onboarded. {fr['top_campaign']}.

**Programs:** {prog['beneficiaries_enrolled_mtd']} new beneficiaries enrolled and {prog['field_visits_this_week']} field visits completed this week across {prog['programs_active']} active programs. CSR pipeline stands at ₹{csr['pipeline_value_cr']}Cr.

**⚠️ Compliance Alert:** FCRA admin overhead reached {comp['fcra_overhead_pct']}% of the legal 20% cap. CFO must restrict admin spending immediately. {comp['documents_expiring_soon']} registration document expiring within 90 days."""
    
    return {**state, "generated_brief": brief, "status": "brief_generated"}

def deliver_brief(state: BoardBriefingState) -> BoardBriefingState:
    """Node 3: Push brief to dashboard feed + WhatsApp group."""
    channels = state.get("delivery_channels", ["dashboard", "whatsapp"])
    
    for channel in channels:
        print(f"--- BOARD BRIEFING AGENT: Delivering to {channel} ---")
        # In production: 
        # dashboard → INSERT into agent_audit_log with brief as JSON
        # whatsapp  → Twilio API call to board WhatsApp group
    
    print(f"\n📋 GENERATED BRIEF:\n{state['generated_brief']}\n")
    return {**state, "delivered": True, "status": "delivered"}

# Build Graph
workflow = StateGraph(BoardBriefingState)
workflow.add_node("pull_kpis", pull_all_kpis)
workflow.add_node("generate_brief", generate_brief)
workflow.add_node("deliver", deliver_brief)
workflow.set_entry_point("pull_kpis")
workflow.add_edge("pull_kpis", "generate_brief")
workflow.add_edge("generate_brief", "deliver")
workflow.add_edge("deliver", END)
board_briefing_agent = workflow.compile()

if __name__ == "__main__":
    print("=== Board Briefing Agent — Daily Run ===")
    result = board_briefing_agent.invoke({
        "ngo_id": "",
        "run_date": str(date.today()),
        "delivery_channels": ["dashboard", "whatsapp"]
    })
    print(f"Status: {result['status']} | Delivered: {result['delivered']}")
