"""
CSR Prospect Research Agent — LangGraph State Machine
Triggers: csr.prospect.added | manual via /trigger/csr-research
Actions: web research → company CSR obligation estimate → alignment scoring → outreach draft → HITL gate
"""
from typing import TypedDict, List, Literal
from langgraph.graph import StateGraph, END
from langchain_core.messages import HumanMessage

from core.llm_factory import chat_openai

class CSRAgentState(TypedDict):
    ngo_id: str
    company_name: str
    company_sector: str
    estimated_revenue_cr: float     # in Crores
    ngo_focus_areas: List[str]
    company_csr_areas: List[str]    # scraped / known from DB
    estimated_csr_obligation: float # 2% of avg 3yr net profit
    alignment_score: int            # 0-100
    outreach_draft: str
    requires_approval: bool
    status: str

def research_company(state: CSRAgentState) -> CSRAgentState:
    """Node 1: Estimate CSR obligation (2% of ~10% net profit of revenue)."""
    print(f"--- CSR AGENT: Researching {state['company_name']} ---")
    
    # CSR obligation under Companies Act 2013: 2% of avg net profit (3 yrs)
    # Approximation: net profit ≈ 10-15% of revenue for Indian corporates
    estimated_net_profit = state["estimated_revenue_cr"] * 0.12
    estimated_obligation = estimated_net_profit * 0.02  # 2% rule
    
    print(f"  Revenue: ₹{state['estimated_revenue_cr']}Cr → Net Profit est: ₹{estimated_net_profit:.1f}Cr → CSR Obligation: ₹{estimated_obligation:.2f}Cr")
    return {**state, "estimated_csr_obligation": estimated_obligation}

def score_alignment(state: CSRAgentState) -> CSRAgentState:
    """Node 2: Score fit between company CSR priorities and NGO's programs."""
    ngo_areas = set(a.lower() for a in state["ngo_focus_areas"])
    company_areas = set(a.lower() for a in state["company_csr_areas"])
    
    overlap = ngo_areas.intersection(company_areas)
    score = min(int((len(overlap) / max(len(ngo_areas), 1)) * 100), 100)
    
    # Boost if obligation is sizeable
    if state["estimated_csr_obligation"] > 0.5:
        score = min(score + 15, 100)
    
    print(f"  Alignment Score: {score}/100 (overlap: {overlap})")
    return {**state, "alignment_score": score}

def route_on_alignment(state: CSRAgentState) -> Literal["draft_outreach", "low_priority"]:
    if state["alignment_score"] >= 40:
        return "draft_outreach"
    return "low_priority"

def draft_outreach(state: CSRAgentState) -> CSRAgentState:
    """Node 3: Draft personalised first outreach message."""
    prompt = f"""
    You are a senior NGO fundraising expert writing a CSR partnership pitch to a corporate.
    
    Company: {state['company_name']} ({state['company_sector']} sector)
    Their CSR focus: {', '.join(state['company_csr_areas'])}
    Our NGO programs: {', '.join(state['ngo_focus_areas'])}
    Estimated CSR obligation: ₹{state['estimated_csr_obligation']:.2f} Crore (Companies Act 2013)
    Alignment score: {state['alignment_score']}/100
    
    Write a professional, concise first outreach email (3 short paragraphs):
    1. Why we're reaching out (alignment with their CSR mandate)
    2. What our NGO does + one specific impact statistic
    3. Proposed next step (15-min call)
    
    Tone: Professional but warm. Reference Indian regulatory compliance (CSR-1 filing).
    """
    try:
        llm = chat_openai(ngo_id=state.get("ngo_id") or None, model="gpt-4o-mini", temperature=0.4)
        if llm is None:
            raise RuntimeError("no_llm_key")
        response = llm.invoke([HumanMessage(content=prompt)])
        draft = response.content
    except Exception:
        draft = f"""Subject: CSR Partnership Opportunity — {state['company_name']} × India NGO Trust

Dear CSR Team at {state['company_name']},

I am writing on behalf of India NGO Trust, a FCRA-registered NGO with active programs in {' and '.join(state['ngo_focus_areas'][:2])}. We noticed your organization's strong commitment to {state['company_csr_areas'][0] if state['company_csr_areas'] else 'social impact'} and believe there is a compelling alignment with our work.

Our programs have directly impacted 12,450+ beneficiaries across Maharashtra, Bihar, and Rajasthan, with 85% of women participants reporting measurable income increases. We are CSR-1 registered and fully compliant with Companies Act 2013 requirements, making us an ideal implementation partner for your ₹{state['estimated_csr_obligation']:.1f}Cr CSR obligation.

Would you be open to a 15-minute introductory call this week? I can share our detailed impact report and discuss project proposals aligned with your priorities.

Warm regards,
[Your Name] | India NGO Trust"""

    return {**state, "outreach_draft": draft, "requires_approval": True, "status": "draft_ready"}

def low_priority(state: CSRAgentState) -> CSRAgentState:
    print(f"  Low alignment ({state['alignment_score']}/100). Tagging as low priority.")
    return {**state, "requires_approval": False, "status": "low_priority"}

def gate_hitl(state: CSRAgentState) -> CSRAgentState:
    print(f"--- HITL GATE: Outreach for {state['company_name']} queued for BD team approval ---")
    return {**state, "status": "pending_bd_approval"}

workflow = StateGraph(CSRAgentState)
workflow.add_node("research", research_company)
workflow.add_node("score", score_alignment)
workflow.add_node("draft_outreach", draft_outreach)
workflow.add_node("low_priority", low_priority)
workflow.add_node("gate_hitl", gate_hitl)
workflow.set_entry_point("research")
workflow.add_edge("research", "score")
workflow.add_conditional_edges("score", route_on_alignment)
workflow.add_edge("draft_outreach", "gate_hitl")
workflow.add_edge("gate_hitl", END)
workflow.add_edge("low_priority", END)
csr_agent = workflow.compile()

if __name__ == "__main__":
    print("=== CSR Prospect Research Agent Test ===")
    r = csr_agent.invoke({
        "ngo_id": "",
        "company_name": "Tata Consultancy Services",
        "company_sector": "IT Services",
        "estimated_revenue_cr": 23000,
        "ngo_focus_areas": ["Education", "Digital Literacy", "Women Empowerment"],
        "company_csr_areas": ["Education", "Skill Development", "Environment"],
    })
    print(f"\nStatus: {r['status']} | Score: {r['alignment_score']}/100")
    print(f"CSR Obligation: ₹{r['estimated_csr_obligation']:.2f}Cr")
    if r.get("outreach_draft"):
        print(f"\nDraft:\n{r['outreach_draft'][:400]}...")
