"""
Agent Orchestrator
Uses LangGraph to chain tasks between specialized agents.
Example: Transaction Failed -> Trigger Recovery Agent -> If Success -> Trigger Nurture Agent for Thank You
"""
from typing import Dict, Any, List
from langgraph.graph import StateGraph, END
from pydantic import BaseModel

class OrchestratorState(BaseModel):
    event_type: str
    data: Dict[str, Any]
    next_action: str = ""
    history: List[str] = []

def route_event(state: OrchestratorState):
    """Initial router node."""
    event = state.event_type
    if event == "payment.failed":
        return "recovery_agent"
    elif event == "donor.nurture.needed":
        return "nurture_agent"
    return END

def recovery_agent(state: OrchestratorState):
    """Handles failed payment recovery."""
    print(f"🤖 [Recovery Agent] Processing failed payment for {state.data.get('donor_name')}")
    # Logic to send WhatsApp nudge
    state.history.append("recovery_nudge_sent")
    return {"history": state.history, "next_action": "wait_for_retry"}

def nurture_agent(state: OrchestratorState):
    """Handles donor nurturing."""
    print(f"🤖 [Nurture Agent] Drafting impact update for {state.data.get('donor_name')}")
    state.history.append("nurture_draft_created")
    return {"history": state.history, "next_action": "ready_for_hitl"}

# Construct Graph
workflow = StateGraph(OrchestratorState)
workflow.add_node("recovery_agent", recovery_agent)
workflow.add_node("nurture_agent", nurture_agent)

workflow.set_entry_point("recovery_agent") # Simplified for now
workflow.add_edge("recovery_agent", END)
workflow.add_edge("nurture_agent", END)

orchestrator = workflow.compile()

def process_orchestration(event_type: str, data: Dict[str, Any]):
    initial_state = OrchestratorState(event_type=event_type, data=data)
    result = orchestrator.invoke(initial_state)
    return result
