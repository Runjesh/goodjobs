"""DPDP Act helpers — consent validation and erasure anonymization."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

ANONYMIZED_SUBJECT_NAME = "Erased data subject"
ANONYMIZED_LOCATION = "Redacted"


def extract_consent_given(details: Optional[Dict[str, Any]]) -> bool:
    """True when enrollment details record affirmative consent (DPDP)."""
    if not details or not isinstance(details, dict):
        return False
    for key in ("consent_given", "data_consent", "consentGiven"):
        if key not in details:
            continue
        val = details[key]
        if isinstance(val, bool):
            return val
        if isinstance(val, str):
            return val.strip().lower() in ("true", "1", "yes", "on")
    return False


def require_beneficiary_consent(details: Optional[Dict[str, Any]]) -> None:
    from fastapi import HTTPException

    if not extract_consent_given(details):
        raise HTTPException(
            status_code=400,
            detail={
                "code": "dpdp_consent_required",
                "message": "DPDP consent is required before saving beneficiary data.",
                "field": "consent_given",
            },
        )


def preserve_anonymized_metrics(details: Optional[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Keep non-identifying outcome / service summaries for NGO reporting."""
    if not details or not isinstance(details, dict):
        return []
    existing = details.get("anonymized_metrics") or details.get("outcome_metrics")
    if isinstance(existing, list) and existing:
        return [
            {"type": str(m.get("type", "outcome")), "text": str(m.get("text", m))[:300]}
            if isinstance(m, dict)
            else {"type": "outcome", "text": str(m)[:300]}
            for m in existing
        ]
    metrics: List[Dict[str, str]] = []
    timeline = details.get("timeline")
    if isinstance(timeline, list):
        for ev in timeline:
            if not isinstance(ev, dict):
                continue
            if ev.get("type") in ("outcome", "service", "enrollment", "field_mis"):
                text = str(ev.get("text", "")).strip()
                if text:
                    metrics.append({"type": str(ev.get("type", "outcome")), "text": text[:300]})
    return metrics


def anonymize_beneficiary_record(
    name: str,
    location: str,
    details: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Strip PII; retain anonymized outcome metrics for historical stats."""
    metrics = preserve_anonymized_metrics(details)
    return {
        "name": ANONYMIZED_SUBJECT_NAME,
        "location": ANONYMIZED_LOCATION,
        "aadhaar": False,
        "details": {
            "erased_at": datetime.now(timezone.utc).isoformat(),
            "consent_given": False,
            "data_consent": False,
            "anonymized_metrics": metrics,
            "phone": None,
            "email": None,
            "id_doc_ref": None,
            "aadhaar_ref": None,
        },
    }
