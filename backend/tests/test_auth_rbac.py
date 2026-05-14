"""
API-level RBAC and auth smoke tests (pytest + TestClient).
Run from repo: cd backend && pytest -q
"""

from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)


def test_login_demo_ed_returns_token_and_role():
    r = client.post(
        "/auth/login",
        json={"email": "admin@indiango.org", "password": "demo1234"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data
    assert data.get("role") == "ed"


def test_login_invalid_password_401():
    r = client.post(
        "/auth/login",
        json={"email": "admin@indiango.org", "password": "wrong"},
    )
    assert r.status_code == 401


def test_field_blocked_from_finance_only_analytics():
    r = client.post(
        "/auth/login",
        json={"email": "field@indiango.org", "password": "demo1234"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    r2 = client.get(
        "/analytics/revenue-forecast",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r2.status_code == 403


def test_finance_can_read_revenue_forecast():
    r = client.post(
        "/auth/login",
        json={"email": "finance@indiango.org", "password": "demo1234"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    r2 = client.get(
        "/analytics/revenue-forecast",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r2.status_code == 200
    body = r2.json()
    assert "forecast" in body
