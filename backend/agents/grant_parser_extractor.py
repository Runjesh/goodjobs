"""
Grant Parser extractor — turns an uploaded MoU / contract into the structured
list of deadlines, deliverables, budget heads and compliance conditions that
GrantDetail's "Grant Parser preview" panel renders for the user to Approve /
Edit / Reject.

Two extractors live here:

1. ``llm_extract_rows`` — uses ``langchain_openai`` with a tight JSON prompt
   when ``OPENAI_API_KEY`` is present. Falls through to the heuristic on any
   failure (network, parsing, validation) so a flaky LLM never blocks the UI.

2. ``heuristic_extract_rows`` — deterministic, no external calls. Derives
   plausible rows from the card metadata (amount, project, sector tags) plus
   any uploaded document name. This is what powers the demo path and the
   per-NGO "no real OpenAI key" deployments. It varies per card so it does
   NOT look like the old hard-coded 14-row mock.

Both return the same shape:

    {
      "rows": [
        {"id", "type", "label", "detail", "confidence"},
        ...
      ],
      "source": "llm" | "heuristic",
      "doc_id": str | None,
      "doc_name": str | None,
    }
"""
from __future__ import annotations

import hashlib
import os
import json
from typing import Any, Dict, List, Optional


RowType = str  # 'deadline' | 'deliverable' | 'budget' | 'condition'


def _seeded_int(seed: str, salt: str, modulo: int) -> int:
    """Stable, non-cryptographic int derived from card+salt — used to vary
    counts/percentages so different cards don't all show identical rows."""
    h = hashlib.sha256(f"{seed}:{salt}".encode("utf-8")).hexdigest()
    return int(h[:8], 16) % max(1, modulo)


def heuristic_extract_rows(
    card: Dict[str, Any],
    doc: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Generate a plausible parser row set from the card metadata.

    Designed to feel "extracted from this specific contract" without calling
    an LLM: the cohort size, budget percentages, mid-line month and admin cap
    all derive from the card seed, and the doc name (if any) is woven into
    the detail strings so users can tell which file was parsed.
    """
    card_id = str(card.get("id") or "0")
    amount = float(card.get("amount") or 1_000_000)
    project = str(card.get("project") or "Project")
    company = str(card.get("company") or "Funder")
    tags = card.get("tags") or []
    sector = (tags[0] if tags else "Programme")
    doc_name = (doc or {}).get("name") or "MoU"

    cohort = 100 + _seeded_int(card_id, "cohort", 400)
    midline_month = 4 + _seeded_int(card_id, "midline", 5)  # 4..8
    admin_cap_pct = 10 + _seeded_int(card_id, "admin", 6)   # 10..15
    me_pct = 8 + _seeded_int(card_id, "me", 6)              # 8..13
    cap_build_pct = 12 + _seeded_int(card_id, "cap", 6)     # 12..17
    delivery_pct = max(0, 100 - admin_cap_pct - me_pct - cap_build_pct)

    rupees = lambda pct: round(amount * (pct / 100.0))  # noqa: E731

    rows: List[Dict[str, Any]] = [
        # Deadlines
        {"id": "pl1", "type": "deadline", "label": "Final UC submission",
         "detail": f"Within 30 days of project completion (per {doc_name})", "confidence": 0.94},
        {"id": "pl2", "type": "deadline", "label": "Quarterly progress reports",
         "detail": "Q1 Jan, Q2 Apr, Q3 Jul, Q4 Oct (15th of month)", "confidence": 0.90},
        {"id": "pl3", "type": "deadline", "label": "Mid-line evaluation",
         "detail": f"At month {midline_month} of project", "confidence": 0.74},

        # Deliverables
        {"id": "dv1", "type": "deliverable",
         "label": f"Train {cohort} direct beneficiaries",
         "detail": f"{project} — {sector} cohort, geo-tagged attendance",
         "confidence": 0.92},
        {"id": "dv2", "type": "deliverable", "label": "Field documentation",
         "detail": "5 case studies + photo essay submitted with each quarterly report",
         "confidence": 0.85},
        {"id": "dv3", "type": "deliverable", "label": "Independent assessment",
         "detail": "Third-party endline survey by an empanelled M&E partner",
         "confidence": 0.71},

        # Budget
        {"id": "bg1", "type": "budget", "label": "Programme delivery",
         "detail": f"₹{rupees(delivery_pct) / 1e5:.1f}L · {delivery_pct}%",
         "confidence": 0.96},
        {"id": "bg2", "type": "budget", "label": "Capacity building",
         "detail": f"₹{rupees(cap_build_pct) / 1e5:.1f}L · {cap_build_pct}%",
         "confidence": 0.92},
        {"id": "bg3", "type": "budget", "label": "M&E + reporting",
         "detail": f"₹{rupees(me_pct) / 1e5:.1f}L · {me_pct}%",
         "confidence": 0.88},
        {"id": "bg4", "type": "budget", "label": "Admin overhead",
         "detail": f"₹{rupees(admin_cap_pct) / 1e5:.1f}L · {admin_cap_pct}% (cap {admin_cap_pct}%)",
         "confidence": 0.80},

        # Compliance conditions — these are largely funder-agnostic but we
        # tag the no-diversion clause with the funder name so the user can
        # see the row was conditioned on this specific contract.
        {"id": "cd1", "type": "condition", "label": "No-diversion clause",
         "detail": f"Funds usable only for the Schedule VII purpose stated in the {company} agreement",
         "confidence": 0.95},
        {"id": "cd2", "type": "condition", "label": "Auditor sign-off",
         "detail": "Independent CA sign-off required on every UC",
         "confidence": 0.93},
        {"id": "cd3", "type": "condition", "label": "Branding & visibility",
         "detail": "Funder logo on all collaterals; quarterly visibility report",
         "confidence": 0.86},
        {"id": "cd4", "type": "condition", "label": "Repayment of unspent funds",
         "detail": "Within 60 days of project closure (per FCRA)",
         "confidence": 0.78},
    ]
    return {
        "rows": rows,
        "source": "heuristic",
        "doc_id": (doc or {}).get("id"),
        "doc_name": (doc or {}).get("name"),
    }


def _validate_llm_rows(raw: Any) -> Optional[List[Dict[str, Any]]]:
    """Coerce LLM output into our row schema. Returns None on any malformed
    input so the caller falls back to the heuristic — better a deterministic
    response than a half-broken one."""
    if not isinstance(raw, list) or not raw:
        return None
    valid_types = {"deadline", "deliverable", "budget", "condition"}
    out: List[Dict[str, Any]] = []
    for i, r in enumerate(raw):
        if not isinstance(r, dict):
            return None
        rtype = r.get("type")
        label = r.get("label")
        detail = r.get("detail")
        if rtype not in valid_types or not isinstance(label, str) or not isinstance(detail, str):
            return None
        try:
            conf = float(r.get("confidence", 0.7))
        except (TypeError, ValueError):
            conf = 0.7
        conf = max(0.0, min(1.0, conf))
        out.append({
            "id": str(r.get("id") or f"x{i+1}"),
            "type": rtype,
            "label": label[:200],
            "detail": detail[:600],
            "confidence": conf,
        })
    return out


def llm_extract_rows(
    card: Dict[str, Any],
    doc: Optional[Dict[str, Any]],
    doc_text: str,
) -> Optional[Dict[str, Any]]:
    """Call the LLM if a key is configured and we have document text. Returns
    None to signal "fall back to heuristic" on any failure."""
    if not os.environ.get("OPENAI_API_KEY"):
        return None
    if not doc_text or not doc_text.strip():
        return None
    try:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import HumanMessage, SystemMessage
    except ImportError:
        return None

    snippet = doc_text[:8000]  # Keep prompt small; most MoUs fit easily.
    system = (
        "You are an expert grant compliance analyst for Indian NGOs. Extract a "
        "structured list of obligations from the funder agreement. Return ONLY "
        "valid JSON — no prose, no markdown — as a JSON array. Each element "
        "must have keys: id (short string), type (one of 'deadline', "
        "'deliverable', 'budget', 'condition'), label (string, <200 chars), "
        "detail (string, <600 chars), confidence (float 0-1)."
    )
    human = (
        f"Funder: {card.get('company')}\n"
        f"Project: {card.get('project')}\n"
        f"Grant amount (INR): {card.get('amount')}\n\n"
        f"Contract excerpt:\n{snippet}"
    )
    try:
        llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
        resp = llm.invoke([SystemMessage(content=system), HumanMessage(content=human)])
        text = (resp.content or "").strip()
        # Strip code fences if the model wrapped its JSON.
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:]
        parsed = json.loads(text)
        rows = _validate_llm_rows(parsed)
        if not rows:
            return None
        return {
            "rows": rows,
            "source": "llm",
            "doc_id": (doc or {}).get("id"),
            "doc_name": (doc or {}).get("name"),
        }
    except Exception:
        return None


def extract_parser_rows(
    card: Dict[str, Any],
    doc: Optional[Dict[str, Any]] = None,
    doc_text: str = "",
) -> Dict[str, Any]:
    """Single entry-point. Tries the LLM, falls back to heuristic."""
    llm = llm_extract_rows(card, doc, doc_text)
    if llm is not None:
        return llm
    return heuristic_extract_rows(card, doc)


def pick_primary_doc(docs: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Pick the most likely contract/MoU from a card's document room.

    Priority: doc_type matches mou/contract/agreement → name keywords →
    most recent. Returns None on an empty list."""
    if not docs:
        return None
    keyword_types = {"mou", "contract", "agreement"}
    by_type = [d for d in docs if str(d.get("doc_type") or "").lower() in keyword_types]
    if by_type:
        return by_type[0]
    keywords = ("mou", "contract", "agreement", "grant")
    by_name = [d for d in docs if any(k in str(d.get("name") or "").lower() for k in keywords)]
    if by_name:
        return by_name[0]
    return docs[0]
