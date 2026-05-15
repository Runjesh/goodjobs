"""FCRA administrative overhead cap (20% of foreign contribution)."""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import HTTPException


def fcra_totals_from_events(events: List[Dict[str, Any]]) -> tuple[float, float]:
    """Return (foreign_income_total, admin_expense_total) from finance journal events."""
    income = 0.0
    admin = 0.0
    for ev in events:
        fund = str(ev.get("fund") or "").upper()
        if fund != "FCRA":
            continue
        amount = abs(float(ev.get("amount") or 0))
        entry_type = str(ev.get("entry_type") or "Expense").lower()
        if entry_type == "income":
            income += amount
        elif entry_type == "expense" and (
            ev.get("is_admin_overhead")
            or str(ev.get("category") or "").lower() == "administrative"
        ):
            admin += amount
    return income, admin


def assert_fcra_admin_within_cap(
    *,
    fund: str,
    entry_type: str,
    amount: float,
    is_admin_overhead: bool,
    category: str | None,
    events: List[Dict[str, Any]],
) -> None:
    """Reject journal posts that would breach the 20% FCRA admin cap."""
    if str(fund).upper() != "FCRA":
        return
    if str(entry_type).lower() != "expense":
        return
    is_admin = bool(is_admin_overhead) or str(category or "").lower() == "administrative"
    if not is_admin:
        return

    income, admin_spent = fcra_totals_from_events(events)
    cap_base = income if income > 0 else 4_000_000.0  # demo fallback aligned with seed grant
    projected = admin_spent + abs(float(amount))
    if projected > cap_base * 0.2 + 0.01:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "fcra_admin_cap_exceeded",
                "message": (
                    "FCRA administrative overhead would exceed the 20% legal cap. "
                    "Reduce the amount or reclassify the expense."
                ),
                "projected_pct": round((projected / cap_base) * 100, 2),
                "cap_pct": 20,
            },
        )
