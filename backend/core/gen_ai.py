"""
Generative AI & Natural Language Processing.

This project must remain usable for nonprofits in offline / demo / no-keys setups.
So every GenAI function has a deterministic fallback when OPENAI_API_KEY is missing.
"""

from __future__ import annotations

from typing import List, Dict, Any, Optional, Optional

try:
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_core.output_parsers import StrOutputParser
except Exception:  # pragma: no cover
    ChatPromptTemplate = None  # type: ignore
    StrOutputParser = None  # type: ignore

from core.llm_factory import chat_openai


def _get_llm(ngo_id: Optional[str] = None):
    return chat_openai(ngo_id=ngo_id, model="gpt-4o-mini", temperature=0)


def _fallback_summary(messages: List[Dict[str, str]]) -> str:
    # Simple, predictable 2-3 bullets for UI rendering
    last = messages[-6:]
    senders = {m.get("sender", "Unknown") for m in last}
    donor_lines = [m.get("text", "").strip() for m in last if (m.get("sender") or "").lower() in ("donor", "supporter")]
    ngo_lines = [m.get("text", "").strip() for m in last if (m.get("sender") or "").lower() not in ("donor", "supporter")]
    donor_takeaway = donor_lines[-1] if donor_lines else (last[-1].get("text", "").strip() if last else "")
    ngo_takeaway = ngo_lines[-1] if ngo_lines else ""
    bullets = []
    bullets.append(f"- Participants: {', '.join(sorted(senders))}")
    if donor_takeaway:
        bullets.append(f"- Latest donor message: {donor_takeaway[:140]}")
    if ngo_takeaway:
        bullets.append(f"- Latest NGO reply: {ngo_takeaway[:140]}")
    return "\n".join(bullets[:3]) or "No recent interactions."


def _fallback_sentiment(text: str) -> Dict[str, Any]:
    t = (text or "").strip().lower()
    if not t:
        return {"sentiment": "Neutral", "score": 0.5, "concerns": [], "raw_analysis": "empty"}
    neg_words = ("angry", "upset", "bad", "refund", "complaint", "scam", "fraud", "disappointed", "hate", "not happy")
    pos_words = ("happy", "great", "love", "thanks", "thank you", "appreciate", "amazing", "good", "glad")
    score = 0.5
    if any(w in t for w in neg_words):
        score -= 0.25
    if any(w in t for w in pos_words):
        score += 0.25
    score = max(0.0, min(1.0, score))
    sentiment = "Positive" if score >= 0.65 else "Negative" if score <= 0.35 else "Neutral"
    concerns = []
    if "receipt" in t or "80g" in t:
        concerns.append("Receipt/80G")
    if "report" in t or "update" in t or "impact" in t:
        concerns.append("Impact reporting")
    if "transparen" in t or "utilization" in t:
        concerns.append("Transparency on utilization")
    return {"sentiment": sentiment, "score": round(score, 2), "concerns": concerns, "raw_analysis": "heuristic"}

def summarize_conversations(messages: List[Dict[str, str]], ngo_id: Optional[str] = None) -> str:
    """
    Summarizes a list of WhatsApp/Email interactions.
    """
    if not messages:
        return "No recent interactions."
        
    llm = _get_llm(ngo_id)
    if llm is None or ChatPromptTemplate is None or StrOutputParser is None:
        return _fallback_summary(messages)

    try:
        formatted_msgs = "\n".join([f"{m.get('sender', 'Unknown')}: {m.get('text', '')}" for m in messages])
        prompt = ChatPromptTemplate.from_template(
            "Summarize the following donor interactions into 2-3 key bullet points focusing on donor intent and sentiment:\n\n{messages}"
        )
        chain = prompt | llm | StrOutputParser()
        return chain.invoke({"messages": formatted_msgs})
    except Exception:
        return _fallback_summary(messages)

def analyze_sentiment(text: str, ngo_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Analyzes donor sentiment and extracts key concerns.
    """
    llm = _get_llm(ngo_id)
    if llm is None or ChatPromptTemplate is None or StrOutputParser is None:
        return _fallback_sentiment(text)

    try:
        prompt = ChatPromptTemplate.from_template(
            "Analyze the sentiment of this donor message. Return JSON with keys: sentiment (Positive/Neutral/Negative), score (0-1), and concerns (list):\n\n{text}"
        )
        chain = prompt | llm | StrOutputParser()
        result = chain.invoke({"text": text})
        # For now still provide a stable top-level structure even if parsing isn't implemented.
        base = _fallback_sentiment(text)
        base["raw_analysis"] = result
        return base
    except Exception:
        return _fallback_sentiment(text)

def draft_annual_report(ngo_name: str, impact_data: Dict[str, Any], ngo_id: Optional[str] = None) -> str:
    """
    Generates a draft of the annual report executive summary.
    """
    llm = _get_llm(ngo_id)
    if llm is None or ChatPromptTemplate is None or StrOutputParser is None:
        bullets = []
        bullets.append(f"{ngo_name} — Annual Report (Draft Executive Summary)")
        bullets.append("")
        bullets.append("This year we focused on measurable outcomes and transparent reporting.")
        bullets.append(f"Key achievements (from provided data): {impact_data}")
        bullets.append("")
        bullets.append("We remain committed to high-integrity delivery, donor trust, and statutory compliance.")
        return "\n".join(bullets)

    try:
        prompt = ChatPromptTemplate.from_template(
            "Write a professional executive summary for the {ngo_name} Annual Report 2025. "
            "Highlight these achievements: {impact_data}. "
            "Tone: Inspiring, transparent, and data-driven."
        )
        chain = prompt | llm | StrOutputParser()
        return chain.invoke({"ngo_name": ngo_name, "impact_data": str(impact_data)})
    except Exception:
        return f"{ngo_name}: Annual report draft unavailable (LLM error)."


def draft_donor_outreach_whatsapp(
    *,
    donor_name: str,
    first_name: str,
    total_given: float,
    propensity_score: Optional[int] = None,
    program_hint: str = "",
    ngo_name: str = "our organisation",
    ngo_id: Optional[str] = None,
) -> str:
    """Draft a short WhatsApp stewardship / re-engagement message for one donor."""
    band = "high" if (propensity_score or 0) >= 80 else "mid" if (propensity_score or 0) >= 50 else "low"
    llm = _get_llm(ngo_id)
    ctx = (
        f"Donor: {donor_name}. Lifetime giving approx ₹{total_given:,.0f}. "
        f"Propensity band: {band}. Programme hint: {program_hint or 'general fund'}."
    )
    if llm is None or ChatPromptTemplate is None or StrOutputParser is None:
        if band == "high":
            return (
                f"Namaste {first_name}! 🙏 Your past support through {ngo_name} helped us reach more families. "
                f"We are planning the next phase of our {program_hint or 'programmes'} — would love to share a short update. "
                "Reply if you would like to hear more."
            )
        if band == "mid":
            return (
                f"Hi {first_name}, this is {ngo_name}. Your gift made a real difference on the ground. "
                f"Sharing a quick impact note from our {program_hint or 'recent work'} — hope it brings a smile. 🌱"
            )
        return (
            f"Namaste {first_name}! We have been continuing our work and your earlier support still matters. "
            "Would love to reconnect when you have a moment."
        )
    try:
        prompt = ChatPromptTemplate.from_template(
            "Write a warm WhatsApp message (under 320 chars, no markdown) from an Indian NGO to a donor. "
            "Use Namaste or Hi. Context: {ctx}. Sign off briefly as the NGO team. "
            "Do not ask for money in the first line; focus on impact and relationship."
        )
        chain = prompt | llm | StrOutputParser()
        return chain.invoke({"ctx": ctx})[:500]
    except Exception:
        return draft_donor_outreach_whatsapp(
            donor_name=donor_name,
            first_name=first_name,
            total_given=total_given,
            propensity_score=propensity_score,
            program_hint=program_hint,
            ngo_name=ngo_name,
            ngo_id=None,
        )
