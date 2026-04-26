"""
Intent Router for SevaSuite
Translates natural language directives into structured Action Cards.
"""
import os
from typing import Dict, Any, List
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from pydantic import BaseModel, Field

# Define the structure of an Action Card
class ActionCard(BaseModel):
    intent_type: str = Field(description="The category of action (e.g., outreach, report, compliance, finance, donor_create)")
    summary: str = Field(description="A one-line summary of what the system will do")
    risk_level: str = Field(description="Low/Medium/High risk assessment")
    action_data: Dict[str, Any] = Field(description="The specific data needed to execute the action")
    suggested_ui: str = Field(description="The type of UI component to render (whatsapp_preview, report_review, finance_approve, donor_preview)")

api_key = os.getenv("OPENAI_API_KEY", "sk-mock-key-for-local-dev-only")
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0, api_key=api_key)
parser = JsonOutputParser(pydantic_object=ActionCard)

INTENT_PROMPT = """
You are the SevaSuite Intent Router. Your job is to translate user natural language into a structured Action Card.
Available Intents:
1. outreach: "Send thank you", "Nudge lapsed donors"
2. report: "Draft Tata Trusts report", "Annual impact report"
3. compliance: "Check 80G status", "FCRA filing due"
4. finance: "Classify transactions", "Check balance"
5. donor_create: "Add Meera Joshi who gave 5k"

User Directive: {input}

{format_instructions}
"""

def route_intent(user_input: str) -> Dict[str, Any]:
    prompt = ChatPromptTemplate.from_template(INTENT_PROMPT)
    chain = prompt | llm | parser
    
    try:
        result = chain.invoke({
            "input": user_input,
            "format_instructions": parser.get_format_instructions()
        })
        return result
    except Exception as e:
        print(f"Intent routing failed: {e}")
        return {
            "intent_type": "unknown",
            "summary": f"I heard '{user_input}', but I'm not sure how to execute that yet.",
            "risk_level": "Low",
            "action_data": {},
            "suggested_ui": "fallback"
        }

def generate_morning_brief() -> List[Dict[str, Any]]:
    """
    Simulates the agentic logic that builds the morning prioritized list.
    In production, this would query various agents (Finance, Nurture, Compliance).
    """
    return [
        {
            "id": "brief-1",
            "priority": "High",
            "category": "Compliance",
            "title": "Tata Trusts utilization report due in 4 days",
            "summary": "Draft is 90% ready. Requires your review of Q4 beneficiary numbers.",
            "action_type": "report_review",
            "data": {"grant": "Tata Trusts", "due_date": "2026-04-27"}
        },
        {
            "id": "brief-2",
            "priority": "Medium",
            "category": "Fundraising",
            "title": "2 high-propensity donors identified",
            "summary": "Rahul Mehta (₹50K) and Sunita Rao (₹25K) have high conversion probability today.",
            "action_type": "outreach_queue",
            "data": {"donors": ["Rahul Mehta", "Sunita Rao"]}
        },
        {
            "id": "brief-3",
            "priority": "Medium",
            "category": "Finance",
            "title": "FCRA admin overhead approaching 20%",
            "summary": "Current: 18.7%. 2 upcoming payments will push it to 21.4%. Review required.",
            "action_type": "finance_limit_check",
            "data": {"current": 18.7, "projected": 21.4}
        }
    ]
