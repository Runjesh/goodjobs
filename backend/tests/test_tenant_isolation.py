"""
Cross-tenant isolation for CSR cards, beneficiaries, and grant state.
Run: cd backend && pytest tests/test_tenant_isolation.py -q
"""
from fastapi.testclient import TestClient

from api.main import (
    app,
    BENEFICIARIES_MEM_BY_NGO,
    CSR_CARDS_MEM_BY_NGO,
    CSR_GRANT_STATE_MEM_BY_NGO,
    _seed_memory_csr,
)
from core.rate_limit import reset_login_rate_limit_for_tests

client = TestClient(app)


def _token(email: str, password: str = "demo1234") -> str:
    reset_login_rate_limit_for_tests()
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _minimal_csr_card(card_id: str) -> dict:
    return {
        "id": card_id,
        "company": "Foreign Tenant Corp",
        "amount": 1_000_000,
        "project": "Isolation probe",
        "tags": ["Test"],
        "agent": "QA",
        "col": "live",
        "date": "Demo",
        "win_probability": 50,
    }


def test_tenant_csr_list_excludes_other_ngo_cards():
    foreign_id = "csr-foreign-iso-1"
    _seed_memory_csr("ngo_other")
    CSR_CARDS_MEM_BY_NGO["ngo_other"] = [_minimal_csr_card(foreign_id)]

    token = _token("admin@indiango.org")
    r = client.get("/csr/cards", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    ids = {str(c.get("id")) for c in r.json().get("cards", [])}
    assert foreign_id not in ids


def test_tenant_cannot_put_grant_state_on_foreign_csr_card():
    foreign_id = "csr-foreign-iso-2"
    _seed_memory_csr("ngo_other")
    CSR_CARDS_MEM_BY_NGO["ngo_other"] = [_minimal_csr_card(foreign_id)]
    CSR_GRANT_STATE_MEM_BY_NGO.setdefault("ngo_other", {})[foreign_id] = {
        "state": {"notes": "secret"},
        "updated_at": "2026-01-01T00:00:00Z",
    }

    token = _token("admin@indiango.org")
    r = client.put(
        f"/csr/cards/{foreign_id}/grant-state",
        headers={"Authorization": f"Bearer {token}"},
        json={"state": {"notes": "cross-tenant write attempt"}},
    )
    assert r.status_code == 404


def test_tenant_grant_state_get_does_not_leak_foreign_card_payload():
    """Memory GET returns null state when the card id is not in the tenant pipeline."""
    foreign_id = "csr-foreign-iso-3"
    _seed_memory_csr("ngo_other")
    CSR_CARDS_MEM_BY_NGO["ngo_other"] = [_minimal_csr_card(foreign_id)]
    CSR_GRANT_STATE_MEM_BY_NGO.setdefault("ngo_other", {})[foreign_id] = {
        "state": {"closureChecklist": {"uc": True}, "isClosed": False},
        "updated_at": "2026-01-01T00:00:00Z",
    }

    token = _token("admin@indiango.org")
    r = client.get(
        f"/csr/cards/{foreign_id}/grant-state",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("state") in (None, {})


def test_tenant_cannot_update_foreign_beneficiary():
    foreign_ben_id = "BEN-FOREIGN-ISO"
    BENEFICIARIES_MEM_BY_NGO["ngo_other"] = [
        {
            "id": foreign_ben_id,
            "name": "Foreign Beneficiary",
            "program": "Health",
            "location": "Delhi",
            "aadhaar": False,
            "familySize": 1,
            "details": {"consent_given": True},
        }
    ]

    token = _token("programs@indiango.org")
    r = client.put(
        f"/programs/beneficiaries/{foreign_ben_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Tampered",
            "program": "Health",
            "location": "Delhi",
            "aadhaar": False,
            "familySize": 1,
            "details": {"consent_given": True},
        },
    )
    assert r.status_code == 404
