"""
Campaign Intelligence Agent — LangGraph State Machine
Triggers: campaign.performance.update (daily), campaign.underperforming.detected
Actions: detect underperformance → A/B copy variant → alert Fundraising team → HITL for send
"""
from typing import TypedDict, List, Literal, Optional
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

class CampaignAgentState(TypedDict):
    campaign_id: str
    campaign_title: str
    target_amount: float
    raised_so_far: float
    days_active: int
    days_remaining: int
    donor_count: int
    daily_avg_required: float
    pct_funded: float
    performance_status: str        # on_track | underperforming | critical
    ab_variant_a: str              # original copy
    ab_variant_b: str              # AI-generated variant
    recommended_action: str
    requires_approval: bool
    status: str

def analyse_performance(state: CampaignAgentState) -> CampaignAgentState:
    """Node 1: Compute performance metrics and classify campaign health."""
    pct = (state["raised_so_far"] / state["target_amount"]) * 100
    days_used_pct = ((state["days_active"]) / (state["days_active"] + state["days_remaining"])) * 100
    
    # A campaign should be at roughly the same % raised as % days used
    gap = days_used_pct - pct
    
    if gap > 30:
        status = "critical"
    elif gap > 15:
        status = "underperforming"
    else:
        status = "on_track"

    daily_avg = (state["target_amount"] - state["raised_so_far"]) / max(state["days_remaining"], 1)

    print(f"--- CAMPAIGN AGENT: {state['campaign_title']} → {status} ({pct:.1f}% funded, {days_used_pct:.1f}% days elapsed) ---")
    return {**state, "pct_funded": pct, "performance_status": status, "daily_avg_required": daily_avg}

def route_on_performance(state: CampaignAgentState) -> Literal["generate_boost", "log_healthy"]:
    if state["performance_status"] in ("underperforming", "critical"):
        return "generate_boost"
    return "log_healthy"

def generate_boost_copy(state: CampaignAgentState) -> CampaignAgentState:
    """Node 2: Use LLM to generate an A/B boost message variant."""
    prompt = f"""
    Campaign: "{state['campaign_title']}"
    Progress: ₹{state['raised_so_far']:,} raised of ₹{state['target_amount']:,} goal ({state['pct_funded']:.0f}% funded).
    Days remaining: {state['days_remaining']}. Status: {state['performance_status'].upper()}.

    Write a compelling, urgent WhatsApp/social media fundraising message to boost donations.
    Max 3 sentences. Use ₹ symbol. Include a soft deadline urgency. No hashtags. Indian context.
    """
    try:
        llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.7)
        response = llm.invoke([HumanMessage(content=prompt)])
        variant_b = response.content
    except Exception:
        variant_b = f"🙏 Only {state['days_remaining']} days left! \"{state['campaign_title']}\" has raised ₹{state['raised_so_far']:,} but needs ₹{(state['target_amount'] - state['raised_so_far']):,} more to reach its goal. Your donation of even ₹500 today can make the difference."

    action = f"Campaign is {state['performance_status']}. Requires ₹{state['daily_avg_required']:,.0f}/day for remaining {state['days_remaining']} days. AI generated boost copy — awaiting approval to deploy."
    return {**state, "ab_variant_b": variant_b, "recommended_action": action, "requires_approval": True}

def log_healthy(state: CampaignAgentState) -> CampaignAgentState:
    print(f"--- CAMPAIGN AGENT: {state['campaign_title']} is on track. No action needed. ---")
    return {**state, "requires_approval": False, "recommended_action": "Campaign healthy — monitoring continues.", "status": "healthy"}

def queue_for_approval(state: CampaignAgentState) -> CampaignAgentState:
    """HITL Gate: Queue the boost message for Fundraising team approval."""
    print(f"--- HITL GATE: Boost message for '{state['campaign_title']}' queued for approval ---")
    print(f"Variant B: {state.get('ab_variant_b', '')}")
    return {**state, "status": "pending_approval"}

workflow = StateGraph(CampaignAgentState)
workflow.add_node("analyse", analyse_performance)
workflow.add_node("generate_boost", generate_boost_copy)
workflow.add_node("log_healthy", log_healthy)
workflow.add_node("queue_approval", queue_for_approval)
workflow.set_entry_point("analyse")
workflow.add_conditional_edges("analyse", route_on_performance)
workflow.add_edge("generate_boost", "queue_approval")
workflow.add_edge("queue_approval", END)
workflow.add_edge("log_healthy", END)
campaign_agent = workflow.compile()

if __name__ == "__main__":
    print("=== Test 1: Underperforming Campaign ===")
    r = campaign_agent.invoke({
        "campaign_id": "c1", "campaign_title": "Digital Literacy for Rural Girls",
        "target_amount": 2000000, "raised_so_far": 750000,
        "days_active": 45, "days_remaining": 15, "donor_count": 120,
    })
    print(f"Status: {r['status']} | Action: {r['recommended_action'][:80]}...")
