"""Build LangChain ChatOpenAI instances using org/env resolved API keys."""
from __future__ import annotations

from typing import Any, Optional

from core.llm_keys import resolve_openai_api_key


def chat_openai(
    *,
    ngo_id: Optional[str] = None,
    model: str = "gpt-4o-mini",
    temperature: float = 0,
) -> Any:
    """
    Returns a ChatOpenAI client or None if no key is configured (callers use fallbacks).
    """
    key = resolve_openai_api_key(ngo_id)
    if not key:
        return None
    try:
        from langchain_openai import ChatOpenAI
    except Exception:
        return None
    return ChatOpenAI(model=model, temperature=temperature, api_key=key)
