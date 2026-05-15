"""
FCRA 20% admin cap — boundary value analysis.
Run: cd backend && pytest tests/test_fcra_boundaries.py -q
"""
from fastapi.testclient import TestClient

from api.main import app, FINANCE_EVENTS_MEM_BY_NGO
from core.fcra_guard import assert_fcra_admin_within_cap, fcra_totals_from_events
from core.rate_limit import reset_login_rate_limit_for_tests

client = TestClient(app)

NGO_ID = "ngo_001"
INCOME = 1_000_000.0


def _token(email: str = "finance@indiango.org") -> str:
    reset_login_rate_limit_for_tests()
    r = client.post("/auth/login", json={"email": email, "password": "demo1234"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _fcra_events(admin_spent: float) -> list:
    return [
        {
            "id": "fcra-inc-boundary",
            "fund": "FCRA",
            "entry_type": "Income",
            "amount": INCOME,
            "is_admin_overhead": False,
        },
        {
            "id": "fcra-adm-boundary",
            "fund": "FCRA",
            "entry_type": "Expense",
            "amount": admin_spent,
            "is_admin_overhead": True,
            "category": "Administrative",
        },
    ]


def test_fcra_boundary_19_9_percent_admin_allowed():
    events = _fcra_events(199_000)
    assert_fcra_admin_within_cap(
        fund="FCRA",
        entry_type="Expense",
        amount=1_000,
        is_admin_overhead=True,
        category="Administrative",
        events=events,
    )
    income, admin = fcra_totals_from_events(events)
    assert admin / income < 0.20


def test_fcra_boundary_20_01_percent_admin_rejected_via_api():
    FINANCE_EVENTS_MEM_BY_NGO[NGO_ID] = _fcra_events(200_000)
    token = _token()
    r = client.post(
        "/finance/journal-entry",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "description": "Boundary breach admin",
            "amount": 10_000,
            "entry_type": "Expense",
            "fund": "FCRA",
            "is_admin_overhead": True,
            "category": "Administrative",
        },
    )
    assert r.status_code == 400
    detail = r.json().get("detail")
    if isinstance(detail, dict):
        assert detail.get("code") == "fcra_admin_cap_exceeded"
