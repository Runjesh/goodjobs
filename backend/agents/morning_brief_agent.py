"""
Morning Brief Agent — daily 8 AM IST role-based Today content + field WhatsApp.
"""
from typing import TypedDict

from langgraph.graph import StateGraph, END

from core.morning_brief import run_morning_brief_delivery


class MorningBriefState(TypedDict):
    ngo_id: str
    ngo_name: str
    run_date: str
    result: dict
    status: str


def deliver_node(state: MorningBriefState) -> MorningBriefState:
    result = run_morning_brief_delivery(
        ngo_id=state["ngo_id"],
        ngo_name=state.get("ngo_name") or "NGO",
    )
    return {**state, "result": result, "status": result.get("status", "delivered")}


workflow = StateGraph(MorningBriefState)
workflow.add_node("deliver", deliver_node)
workflow.set_entry_point("deliver")
workflow.add_edge("deliver", END)
morning_brief_agent = workflow.compile()
