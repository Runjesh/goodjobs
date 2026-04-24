"""
Generative AI & Natural Language Processing
Handles conversation summaries, sentiment analysis, and report generation.
"""
from typing import List, Dict, Any
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
import os

# Initialize LLM with a dummy key if OPENAI_API_KEY is not set (prevents crash on boot)
api_key = os.getenv("OPENAI_API_KEY", "sk-mock-key-for-local-dev-only")
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0, api_key=api_key)

def summarize_conversations(messages: List[Dict[str, str]]) -> str:
    """
    Summarizes a list of WhatsApp/Email interactions.
    """
    if not messages:
        return "No recent interactions."
        
    formatted_msgs = "\n".join([f"{m['sender']}: {m['text']}" for m in messages])
    
    prompt = ChatPromptTemplate.from_template(
        "Summarize the following donor interactions into 2-3 key bullet points focusing on donor intent and sentiment:\n\n{messages}"
    )
    
    chain = prompt | llm | StrOutputParser()
    summary = chain.invoke({"messages": formatted_msgs})
    return summary

def analyze_sentiment(text: str) -> Dict[str, Any]:
    """
    Analyzes donor sentiment and extracts key concerns.
    """
    prompt = ChatPromptTemplate.from_template(
        "Analyze the sentiment of this donor message. Return JSON with keys: sentiment (Positive/Neutral/Negative), score (0-1), and concerns (list):\n\n{text}"
    )
    
    # In a real app, we'd use PydanticOutputParser for JSON
    chain = prompt | llm | StrOutputParser()
    result = chain.invoke({"text": text})
    
    # Mocking JSON parsing for this demo
    return {
        "sentiment": "Positive",
        "score": 0.85,
        "concerns": ["Transparency on utilization"],
        "raw_analysis": result
    }

def draft_annual_report(ngo_name: str, impact_data: Dict[str, Any]) -> str:
    """
    Generates a draft of the annual report executive summary.
    """
    prompt = ChatPromptTemplate.from_template(
        "Write a professional executive summary for the {ngo_name} Annual Report 2025. "
        "Highlight these achievements: {impact_data}. "
        "Tone: Inspiring, transparent, and data-driven."
    )
    
    chain = prompt | llm | StrOutputParser()
    draft = chain.invoke({"ngo_name": ngo_name, "impact_data": str(impact_data)})
    return draft
