"""
Grant Report Agent — LangGraph State Machine with RAG
Triggers: grant.report.due | grant.milestone.reached
Actions: RAG retrieval → pull MIS data → LLM draft → HITL review gate → send for PM approval
"""
from typing import TypedDict, List
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI

class GrantReportState(TypedDict):
    grant_id: str
    grant_name: str
    funder_name: str
    report_type: str              # 'quarterly' | 'milestone' | 'final'
    mis_data: dict                # Beneficiary counts, outcomes from Programs MIS
    finance_data: dict            # Spend vs budget from Finance module
    rag_chunks: List[str]         # Similar past report chunks from pgvector
    draft_report: str
    requires_pm_review: bool
    status: str

def fetch_mis_data(state: GrantReportState) -> GrantReportState:
    """Node 1: Pull relevant MIS data for this grant from Programs module."""
    print(f"--- GRANT REPORT AGENT: Fetching MIS data for grant {state['grant_id']} ---")
    
    # In production: SELECT FROM programs JOIN beneficiaries WHERE grant_id = ?
    mis = {
        "beneficiaries_reached": 450,
        "female_beneficiaries": 387,
        "sessions_conducted": 48,
        "avg_income_increase_pct": 85,
        "field_visits": 23,
        "districts_covered": ["Nashik", "Pune", "Kolhapur"]
    }
    return {**state, "mis_data": mis}

def fetch_finance_data(state: GrantReportState) -> GrantReportState:
    """Node 2: Pull budget utilization data from Finance module."""
    print("--- GRANT REPORT AGENT: Fetching finance utilization data ---")
    
    # In production: SELECT FROM transactions WHERE grant_id = ?
    finance = {
        "total_budget": 2500000,
        "total_spent": 1800000,
        "utilization_pct": 72,
        "categories": {
            "Staff Salaries": 900000,
            "Training Materials": 350000,
            "Field Operations": 400000,
            "Admin (capped 20%)": 150000
        }
    }
    return {**state, "finance_data": finance}

def retrieve_rag_context(state: GrantReportState) -> GrantReportState:
    """Node 3: Retrieve similar past grant report chunks from pgvector."""
    print("--- GRANT REPORT AGENT: Performing RAG retrieval from pgvector ---")
    
    # In production:
    # query_embedding = embed(f"Grant report for {state['grant_name']}")
    # chunks = db.query("SELECT chunk_text FROM vector_documents ORDER BY embedding <-> $1 LIMIT 5", [query_embedding])
    
    # Simulated retrieved chunks
    chunks = [
        "The Women Livelihood Center program demonstrated significant economic impact, with 85% of participants reporting income doubling within 6 months of program completion.",
        "All expenditures complied with the 20% administrative overhead limit as mandated under FCRA regulations. Fund utilization certificates were issued quarterly.",
        "Field data was collected via geo-tagged mobile forms, ensuring verifiable GPS coordinates for each session conducted in the target districts."
    ]
    return {**state, "rag_chunks": chunks}

def draft_report(state: GrantReportState) -> GrantReportState:
    """Node 4: Use LLM with RAG context to draft the grant utilization report."""
    print("--- GRANT REPORT AGENT: Drafting report with LLM + RAG context ---")
    
    mis = state["mis_data"]
    fin = state["finance_data"]
    rag_context = "\n".join(state["rag_chunks"])
    
    prompt = f"""
    You are an expert grant writer for an Indian NGO. Draft a professional grant utilization report.
    
    Grant: {state['grant_name']} | Funder: {state['funder_name']} | Type: {state['report_type']} report
    
    Past Report Context (use our NGO's writing style):
    {rag_context}
    
    Program Data:
    - Beneficiaries reached: {mis['beneficiaries_reached']} ({mis['female_beneficiaries']} women)
    - Sessions conducted: {mis['sessions_conducted']}
    - Districts covered: {', '.join(mis['districts_covered'])}
    - Key outcome: {mis['avg_income_increase_pct']}% of beneficiaries reported income increase
    
    Financial Utilization:
    - Budget: ₹{fin['total_budget']:,} | Spent: ₹{fin['total_spent']:,} ({fin['utilization_pct']}%)
    
    Write sections: 1) Program Overview 2) Beneficiary Impact 3) Financial Summary
    Keep it professional, use specific numbers, reference Indian regulatory compliance.
    """
    
    try:
        llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.3)
        from langchain_core.messages import HumanMessage
        response = llm.invoke([HumanMessage(content=prompt)])
        draft = response.content
    except Exception:
        draft = f"""
## {state['grant_name']} — {state['report_type'].title()} Utilization Report

**Submitted to:** {state['funder_name']}

### 1. Program Overview
The program successfully reached {mis['beneficiaries_reached']} direct beneficiaries ({mis['female_beneficiaries']} women) across {len(mis['districts_covered'])} districts ({', '.join(mis['districts_covered'])}). A total of {mis['sessions_conducted']} structured sessions were conducted during the reporting period, supported by {mis['field_visits']} geo-verified field visits.

### 2. Beneficiary Impact
Our monitoring data indicates that {mis['avg_income_increase_pct']}% of program participants reported measurable income increases within 6 months of completing the skills training. All field data was collected via GPS-tagged mobile forms per our MIS protocol.

### 3. Financial Summary
Total grant budget: ₹{fin['total_budget']:,}
Total expenditure: ₹{fin['total_spent']:,} ({fin['utilization_pct']}% utilized)
Administrative overhead: ₹{fin['categories']['Admin (capped 20%)']:,} (within FCRA 20% cap)

All expenditures are documented with original receipts and available for audit. The unspent balance of ₹{fin['total_budget'] - fin['total_spent']:,} will be utilized in the next quarter as per approved budget plan.
"""
    
    return {**state, "draft_report": draft, "requires_pm_review": True, "status": "draft_ready"}

def gate_pm_review(state: GrantReportState) -> GrantReportState:
    """HITL Gate: Push draft to Agent HQ for Program Manager review before submitting."""
    print(f"--- HITL GATE: Grant report draft queued for PM review (HITL-REPORT-{state['grant_id']}) ---")
    return {**state, "status": "pending_pm_approval"}

# Build Graph
workflow = StateGraph(GrantReportState)
workflow.add_node("fetch_mis", fetch_mis_data)
workflow.add_node("fetch_finance", fetch_finance_data)
workflow.add_node("retrieve_rag", retrieve_rag_context)
workflow.add_node("draft_report", draft_report)
workflow.add_node("gate_pm_review", gate_pm_review)

workflow.set_entry_point("fetch_mis")
workflow.add_edge("fetch_mis", "fetch_finance")
workflow.add_edge("fetch_finance", "retrieve_rag")
workflow.add_edge("retrieve_rag", "draft_report")
workflow.add_edge("draft_report", "gate_pm_review")
workflow.add_edge("gate_pm_review", END)

grant_report_agent = workflow.compile()

if __name__ == "__main__":
    print("=== Grant Report Agent Test ===")
    result = grant_report_agent.invoke({
        "grant_id": "G-2026-01",
        "grant_name": "Rural Digital Literacy (CSR)",
        "funder_name": "Infosys Foundation",
        "report_type": "quarterly"
    })
    print(f"\nStatus: {result['status']}")
    print(f"Draft:\n{result['draft_report'][:500]}...")
