from typing import TypedDict, Literal
from langchain_core.messages import HumanMessage
from langgraph.graph import StateGraph, END

from core.llm_factory import chat_openai

# Define the Agent State
class DonorAgentState(TypedDict):
    ngo_id: str
    event_type: str
    donor_id: str
    donor_name: str
    donation_amount: float
    preferred_language: str
    is_major_donor: bool
    drafted_message: str
    requires_human_approval: bool
    status: str
    error: str

# 1. State Initializer & Triage Node
def triage_donation(state: DonorAgentState) -> DonorAgentState:
    """Evaluates the donation and sets flags (e.g., major donor HITL)."""
    print(f"--- TRIAGE: Processing donation from {state['donor_name']} ---")
    
    amount = state.get("donation_amount", 0)
    # Business Rule: > ₹1,00,000 is a major donor and requires human review
    is_major = amount >= 100000
    
    return {
        **state,
        "is_major_donor": is_major,
        "requires_human_approval": is_major,
        "status": "triaged"
    }

# 2. Routing Logic
def route_post_triage(state: DonorAgentState) -> Literal["draft_message", "send_80g_receipt"]:
    """Decide what to do after triage."""
    if state.get("event_type") == "donation_received":
        return "draft_message"
    return "send_80g_receipt"

# 3. Message Generation Node (Generative Layer)
def draft_personalized_message(state: DonorAgentState) -> DonorAgentState:
    """Drafts a personalized WhatsApp/Email message based on donor tier."""
    print(f"--- DRAFTING MESSAGE: Generating content in {state.get('preferred_language', 'English')} ---")
    
    llm = chat_openai(ngo_id=state.get("ngo_id") or None, model="gpt-4o-mini", temperature=0.7)

    prompt = f"""
    You are an expert donor relations manager for an Indian NGO.
    Write a short, heartfelt thank you message for a donation of ₹{state['donation_amount']}.
    Donor Name: {state['donor_name']}
    Preferred Language: {state.get('preferred_language', 'English')}
    
    If the donation is >= ₹1,00,000, include an invitation for a personal call with the founder.
    Keep it under 3 sentences. Do not use placeholders.
    """
    
    try:
        if llm is None:
            raise RuntimeError("no_llm_key")
        response = llm.invoke([HumanMessage(content=prompt)])
        draft = response.content
    except Exception:
        # Fallback if API keys aren't set
        draft = f"Thank you {state['donor_name']} for your generous contribution of ₹{state['donation_amount']}. Your support means everything to our mission."
        if state['is_major_donor']:
            draft += " We would love to schedule a personal call with our founder to discuss the impact of your gift."

    return {**state, "drafted_message": draft, "status": "drafted"}

# 4. Human-in-the-Loop Routing Node
def check_human_approval_gate(state: DonorAgentState) -> Literal["wait_for_human", "auto_send"]:
    """Routes execution based on HITL requirement."""
    if state.get("requires_human_approval"):
        print("--- GATE TRIGGERED: High-stakes action requires human approval ---")
        return "wait_for_human"
    return "auto_send"

# 5. Execution Nodes
def wait_for_human(state: DonorAgentState) -> DonorAgentState:
    """Simulates pushing the task to the AgentHQ approval queue."""
    print(f"--- QUEUED: Pushed to AgentHQ for human review (ID: HITL-{state['donor_id']}) ---")
    return {**state, "status": "pending_approval"}

def auto_send_message(state: DonorAgentState) -> DonorAgentState:
    """Executes the tool call (e.g., Twilio WhatsApp API)."""
    print(f"--- AUTONOMOUS ACTION: Sending WhatsApp message to {state['donor_name']} ---")
    print(f"[Payload]: {state['drafted_message']}")
    return {**state, "status": "sent_autonomously"}

def send_80g_receipt(state: DonorAgentState) -> DonorAgentState:
    """Simulates sending an 80G receipt automatically."""
    print(f"--- ACTION: Generating and sending 80G receipt to {state['donor_name']} ---")
    return {**state, "status": "80g_sent"}

# Build the Graph
workflow = StateGraph(DonorAgentState)

# Add Nodes
workflow.add_node("triage", triage_donation)
workflow.add_node("draft_message", draft_personalized_message)
workflow.add_node("wait_for_human", wait_for_human)
workflow.add_node("auto_send", auto_send_message)
workflow.add_node("send_80g_receipt", send_80g_receipt)

# Define Edges
workflow.set_entry_point("triage")
workflow.add_conditional_edges("triage", route_post_triage)
workflow.add_conditional_edges("draft_message", check_human_approval_gate)
workflow.add_edge("wait_for_human", END) # Graph pauses here. Resumes via human trigger later.
workflow.add_edge("auto_send", END)
workflow.add_edge("send_80g_receipt", END)

# Compile the Agent
donor_nurture_app = workflow.compile()

if __name__ == "__main__":
    print("\n=== Testing Agent: Standard Donor (Autonomous) ===")
    standard_donor = {
        "ngo_id": "",
        "event_type": "donation_received",
        "donor_id": "D-1001",
        "donor_name": "Ravi Kumar",
        "donation_amount": 5000,
        "preferred_language": "English"
    }
    result_1 = donor_nurture_app.invoke(standard_donor)
    print(f"Final Status: {result_1['status']}\n")
    
    print("=== Testing Agent: Major Donor (HITL Gate) ===")
    major_donor = {
        "ngo_id": "",
        "event_type": "donation_received",
        "donor_id": "D-1002",
        "donor_name": "Anjali Desai",
        "donation_amount": 500000,
        "preferred_language": "English"
    }
    result_2 = donor_nurture_app.invoke(major_donor)
    print(f"Final Status: {result_2['status']}\n")
