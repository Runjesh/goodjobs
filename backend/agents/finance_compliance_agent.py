"""
Finance & Compliance Agent — LangGraph State Machine
Triggers: compliance.deadline.approaching | transaction.classified | month.end.close
Actions: FCRA rule validation, overhead tracking, filing deadline alerts, suspicious tx flagging
"""
from typing import TypedDict, Literal, List
from langgraph.graph import StateGraph, END
from datetime import date, timedelta

class FinanceAgentState(TypedDict):
    event_type: str
    transaction_id: str
    amount: float
    fund_type: str               # General | FCRA | CSR | Restricted
    source_country: str          # 'IN' or foreign
    total_fcra_budget: float
    admin_spent_fcra: float
    filing_deadlines: List[dict]
    classification_result: str
    fcra_violation: bool
    overhead_breach: bool
    requires_cfo_approval: bool
    alert_message: str
    status: str

def classify_transaction(state: FinanceAgentState) -> FinanceAgentState:
    """Node 1: Classify incoming transaction and check FCRA rules."""
    print(f"--- FINANCE AGENT: Classifying transaction {state['transaction_id']} ---")
    
    is_foreign = state.get("source_country", "IN") != "IN"
    fund = state.get("fund_type", "General")
    
    # FCRA Rule: Foreign money MUST go to FCRA fund and SBI Main Branch
    fcra_violation = is_foreign and fund != "FCRA"
    
    return {
        **state,
        "fcra_violation": fcra_violation,
        "classification_result": f"{'FCRA' if is_foreign else fund} fund — {'VIOLATION DETECTED' if fcra_violation else 'Compliant'}",
        "status": "classified"
    }

def check_overhead_cap(state: FinanceAgentState) -> FinanceAgentState:
    """Node 2: Check if admin overhead is approaching the 20% FCRA cap."""
    fcra_budget = state.get("total_fcra_budget", 4000000)
    admin_spent = state.get("admin_spent_fcra", 0)
    
    cap = fcra_budget * 0.20
    pct = (admin_spent / cap) * 100 if cap > 0 else 0
    breach = pct >= 85  # Warn at 85% of the cap
    
    alert = ""
    if breach:
        alert = f"⚠️ FCRA Admin Overhead at {pct:.1f}% of legal cap. ₹{(cap - admin_spent):,.0f} remaining. Restrict admin expenses."
    
    return {**state, "overhead_breach": breach, "alert_message": alert, "status": "overhead_checked"}

def check_filing_deadlines(state: FinanceAgentState) -> FinanceAgentState:
    """Node 3: Scan filing calendar for approaching deadlines."""
    today = date.today()
    deadlines = state.get("filing_deadlines", [])
    
    upcoming = []
    for filing in deadlines:
        due = date.fromisoformat(filing["due_date"])
        days_left = (due - today).days
        if 0 <= days_left <= 30:
            upcoming.append(f"⏰ {filing['name']} due in {days_left} days ({filing['due_date']})")
    
    if upcoming:
        existing = state.get("alert_message", "")
        alert = existing + "\n" + "\n".join(upcoming)
        return {**state, "alert_message": alert.strip()}
    
    return state

def route_on_violation(state: FinanceAgentState) -> Literal["escalate_to_cfo", "log_and_continue"]:
    if state.get("fcra_violation") or state.get("overhead_breach"):
        return "escalate_to_cfo"
    return "log_and_continue"

def escalate_to_cfo(state: FinanceAgentState) -> FinanceAgentState:
    """HITL Gate: Push to Agent HQ for CFO approval."""
    print(f"--- HITL GATE: Escalating to CFO | {state.get('alert_message', 'Compliance issue detected')} ---")
    return {**state, "requires_cfo_approval": True, "status": "pending_cfo_approval"}

def log_and_continue(state: FinanceAgentState) -> FinanceAgentState:
    """Autonomous: Log to audit trail and continue."""
    print(f"--- FINANCE AGENT: Transaction {state['transaction_id']} logged. {state['classification_result']} ---")
    return {**state, "requires_cfo_approval": False, "status": "auto_logged"}

# Build Graph
workflow = StateGraph(FinanceAgentState)
workflow.add_node("classify", classify_transaction)
workflow.add_node("check_overhead", check_overhead_cap)
workflow.add_node("check_deadlines", check_filing_deadlines)
workflow.add_node("escalate_to_cfo", escalate_to_cfo)
workflow.add_node("log_and_continue", log_and_continue)

workflow.set_entry_point("classify")
workflow.add_edge("classify", "check_overhead")
workflow.add_edge("check_overhead", "check_deadlines")
workflow.add_conditional_edges("check_deadlines", route_on_violation)
workflow.add_edge("escalate_to_cfo", END)
workflow.add_edge("log_and_continue", END)

finance_agent = workflow.compile()

if __name__ == "__main__":
    print("\n=== Test 1: Domestic Transaction (Should auto-log) ===")
    r1 = finance_agent.invoke({
        "event_type": "transaction.classified",
        "transaction_id": "TRX-2001",
        "amount": 50000,
        "fund_type": "CSR",
        "source_country": "IN",
        "total_fcra_budget": 4000000,
        "admin_spent_fcra": 600000,
        "filing_deadlines": [{"name": "FCRA Annual Return", "due_date": "2026-12-31"}]
    })
    print(f"Status: {r1['status']} | Needs CFO: {r1['requires_cfo_approval']}")

    print("\n=== Test 2: Foreign Transaction Misrouted (Should escalate to CFO) ===")
    r2 = finance_agent.invoke({
        "event_type": "transaction.classified",
        "transaction_id": "TRX-2002",
        "amount": 200000,
        "fund_type": "General",
        "source_country": "UK",
        "total_fcra_budget": 4000000,
        "admin_spent_fcra": 750000,
        "filing_deadlines": [{"name": "TDS Return Q3", "due_date": str(date.today() + timedelta(days=10))}]
    })
    print(f"Status: {r2['status']} | Alert: {r2['alert_message']}")
