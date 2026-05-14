"""
Agent Orchestrator
Chains lightweight workflow steps and delegates to LangGraph agents when needed.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, TypedDict

from langgraph.graph import END, StateGraph

from agents.donor_nurture_agent import donor_nurture_app


class OrchestratorState(TypedDict, total=False):
    event_type: str
    data: Dict[str, Any]
    next_action: str
    history: List[str]
    nurture_result: Dict[str, Any]
    nurture_error: str


def _dispatch(_state: OrchestratorState) -> OrchestratorState:
    return {}


def route_from_dispatch(state: OrchestratorState) -> str:
    event = (state.get("event_type") or "").strip()
    if event == "payment.failed":
        return "recovery_agent"
    if event in ("donor.nurture.needed", "donation_received", "outreach"):
        return "nurture_agent"
    return END


def recovery_agent(state: OrchestratorState) -> OrchestratorState:
    """Handles failed payment recovery (placeholder — integrate WA / CRM)."""
    data = state.get("data") or {}
    print(f"🤖 [Recovery Agent] Processing failed payment for {data.get('donor_name')}")
    hist = list(state.get("history") or [])
    hist.append("recovery_nudge_sent")
    return {**state, "history": hist, "next_action": "wait_for_retry"}


def nurture_agent(state: OrchestratorState) -> OrchestratorState:
    """Runs Donor Nurture LangGraph when event asks for nurture / thank-you."""
    data = dict(state.get("data") or {})
    ngo_id = str(data.get("ngo_id") or "").strip()

    payload = {
        "ngo_id": ngo_id,
        "event_type": str(data.get("event_type") or "donation_received"),
        "donor_id": str(data.get("donor_id") or "unknown"),
        "donor_name": str(data.get("donor_name") or "Supporter"),
        "donation_amount": float(data.get("donation_amount") or 0),
        "preferred_language": str(data.get("preferred_language") or "English"),
        "is_major_donor": False,
        "drafted_message": "",
        "requires_human_approval": False,
        "status": "",
        "error": "",
    }

    hist = list(state.get("history") or [])
    try:
        out = donor_nurture_app.invoke(payload)
        hist.append(f"nurture_agent:{out.get('status', 'unknown')}")
        return {
            **state,
            "history": hist,
            "next_action": str(out.get("status", "done")),
            "nurture_result": dict(out) if isinstance(out, dict) else {"result": out},
        }
    except Exception as exc:
        hist.append("nurture_agent:error")
        return {**state, "history": hist, "next_action": "error", "nurture_error": str(exc)}


workflow = StateGraph(OrchestratorState)
workflow.add_node("dispatch", _dispatch)
workflow.add_node("recovery_agent", recovery_agent)
workflow.add_node("nurture_agent", nurture_agent)
workflow.set_entry_point("dispatch")
workflow.add_conditional_edges("dispatch", route_from_dispatch)
workflow.add_edge("recovery_agent", END)
workflow.add_edge("nurture_agent", END)

orchestrator = workflow.compile()


def process_orchestration(
    event_type: str,
    data: Dict[str, Any],
    *,
    ngo_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Run orchestration graph. When ``ngo_id`` is provided it is merged into ``data``
    so downstream agents resolve the correct OpenAI key.
    """
    d = dict(data or {})
    if ngo_id:
        d["ngo_id"] = ngo_id

    initial: OrchestratorState = {
        "event_type": event_type,
        "data": d,
        "next_action": "",
        "history": [],
    }
    result = orchestrator.invoke(initial)
    if isinstance(result, dict):
        return result
    return dict(result)
