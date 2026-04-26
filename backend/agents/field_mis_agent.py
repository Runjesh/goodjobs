"""
Field MIS Agent — LangGraph State Machine
Triggers: beneficiary.absent | field.data.submitted | whatsapp.message.parsed
Actions: data validation → duplicate detection → translation (regional→English) → dashboard aggregation → alert
"""
from typing import TypedDict, List, Literal, Optional
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage
import re

class FieldMISState(TypedDict):
    event_type: str
    raw_input: str                   # Raw WhatsApp message or form submission
    source_language: str             # 'hindi' | 'marathi' | 'tamil' | 'english'
    parsed_data: dict                # Structured data extracted from raw input
    beneficiary_id: Optional[str]
    is_duplicate: bool
    validation_errors: List[str]
    translated_summary: str
    dashboard_update: dict
    alert_required: bool
    status: str

def detect_and_translate(state: FieldMISState) -> FieldMISState:
    """Node 1: Detect language and translate regional input to English structured data."""
    raw = state["raw_input"]
    lang = state.get("source_language", "english")
    
    print(f"--- FIELD MIS AGENT: Processing '{raw[:60]}...' (lang: {lang}) ---")
    
    # Language detection heuristics (production: use langdetect library)
    if any(c in raw for c in "अआइईउऊएऐओऔकखगघ"):
        lang = "hindi"
    elif any(c in raw for c in "அஆஇஈஉஊகங"):
        lang = "tamil"
    
    try:
        llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
        prompt = f"""
        Extract structured data from this field worker report (language: {lang}).
        Input: "{raw}"
        
        Return JSON with keys: action, beneficiary_name, program, location, count, amount, notes
        If a field is not mentioned, use null. Return ONLY valid JSON.
        """
        response = llm.invoke([HumanMessage(content=prompt)])
        import json
        parsed = json.loads(response.content.strip().strip("```json").strip("```"))
    except Exception:
        # Fallback: simple keyword extraction for common patterns
        parsed = {
            "action": "field_visit",
            "beneficiary_name": None,
            "program": "General",
            "location": "Unknown",
            "count": None,
            "amount": None,
            "notes": raw
        }
        # Extract amount pattern like ₹5000 or Rs 5000
        amount_match = re.search(r'[₹Rs\.]+\s*(\d+)', raw)
        if amount_match:
            parsed["amount"] = int(amount_match.group(1))
    
    summary = f"Field report ({lang}): {parsed.get('action', 'activity')} at {parsed.get('location', 'unknown location')}"
    if parsed.get("count"):
        summary += f" — {parsed['count']} beneficiaries"
    if parsed.get("amount"):
        summary += f" — ₹{parsed['amount']:,}"
    
    return {**state, "source_language": lang, "parsed_data": parsed, "translated_summary": summary}

def validate_data(state: FieldMISState) -> FieldMISState:
    """Node 2: Check for data quality issues and duplicates."""
    errors = []
    parsed = state["parsed_data"]
    
    if not parsed.get("location") or parsed["location"] == "Unknown":
        errors.append("Location missing — geo-tag required for FCRA compliance")
    if parsed.get("amount") and parsed["amount"] > 100000:
        errors.append(f"Large amount ₹{parsed['amount']:,} — verify with transaction log")
    
    # Duplicate check (in production: query DB for same beneficiary + date)
    is_duplicate = False  # Simplified
    
    return {**state, "validation_errors": errors, "is_duplicate": is_duplicate}

def route_on_validation(state: FieldMISState) -> Literal["aggregate_to_dashboard", "flag_for_review"]:
    if state["is_duplicate"] or len(state["validation_errors"]) > 1:
        return "flag_for_review"
    return "aggregate_to_dashboard"

def aggregate_to_dashboard(state: FieldMISState) -> FieldMISState:
    """Node 3: Build dashboard update payload and persist to DB."""
    parsed = state["parsed_data"]
    
    update = {
        "type": "field_activity",
        "summary": state["translated_summary"],
        "location": parsed.get("location"),
        "program": parsed.get("program"),
        "beneficiaries_count": parsed.get("count", 0),
        "amount": parsed.get("amount", 0),
        "validated": len(state["validation_errors"]) == 0
    }
    
    # In production: INSERT INTO field_activities and UPDATE program_kpis
    print(f"--- FIELD MIS AGENT: Aggregated → {update['summary']} ---")
    if state["validation_errors"]:
        print(f"  Warnings: {state['validation_errors']}")
    
    return {**state, "dashboard_update": update, "alert_required": bool(state["validation_errors"]), "status": "aggregated"}

def flag_for_review(state: FieldMISState) -> FieldMISState:
    """Flag duplicate or invalid entry for supervisor review."""
    print("--- FIELD MIS AGENT: Flagged for supervisor review —")
    print(f"  Errors: {state['validation_errors']}")
    return {**state, "alert_required": True, "status": "flagged"}

workflow = StateGraph(FieldMISState)
workflow.add_node("translate", detect_and_translate)
workflow.add_node("validate", validate_data)
workflow.add_node("aggregate_to_dashboard", aggregate_to_dashboard)
workflow.add_node("flag_for_review", flag_for_review)
workflow.set_entry_point("translate")
workflow.add_edge("translate", "validate")
workflow.add_conditional_edges("validate", route_on_validation)
workflow.add_edge("aggregate_to_dashboard", END)
workflow.add_edge("flag_for_review", END)
field_mis_agent = workflow.compile()

if __name__ == "__main__":
    print("=== Test 1: English field report ===")
    r1 = field_mis_agent.invoke({
        "event_type": "whatsapp.message.parsed",
        "raw_input": "Received ₹5000 from Ravi Kumar for Health Camp. 45 patients attended at Pune Main Hall.",
        "source_language": "english",
    })
    print(f"Status: {r1['status']} | Summary: {r1['translated_summary']}")
    
    print("\n=== Test 2: Hindi field report ===")
    r2 = field_mis_agent.invoke({
        "event_type": "whatsapp.message.parsed",
        "raw_input": "आज नाशिक में 30 महिलाओं ने सिलाई प्रशिक्षण में भाग लिया",
        "source_language": "hindi",
    })
    print(f"Status: {r2['status']} | Summary: {r2['translated_summary']}")
