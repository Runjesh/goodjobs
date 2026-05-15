"""
DPDP, tenant isolation, FCRA guard, and login rate-limit tests.
Run: cd backend && pytest tests/test_dpdp_security.py -q
"""
from fastapi.testclient import TestClient

from api.main import app, BENEFICIARIES_MEM_BY_NGO, DONORS_MEM_BY_NGO, FINANCE_EVENTS_MEM_BY_NGO
from core.rate_limit import reset_login_rate_limit_for_tests

client = TestClient(app)


def _token(email: str, password: str = "demo1234") -> str:
    reset_login_rate_limit_for_tests()
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def test_beneficiary_create_without_consent_returns_400():
    token = _token("programs@indiango.org")
    r = client.post(
        "/programs/beneficiaries",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "No Consent Person",
            "program": "Health",
            "location": "Pune",
            "aadhaar": False,
            "familySize": 1,
            "details": {"consent_given": False, "data_consent": False},
        },
    )
    assert r.status_code == 400
    body = r.json()
    detail = body.get("detail")
    if isinstance(detail, dict):
        assert detail.get("code") == "dpdp_consent_required"


def test_beneficiary_create_with_consent_succeeds():
    token = _token("programs@indiango.org")
    r = client.post(
        "/programs/beneficiaries",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Consent OK Person",
            "program": "Health",
            "location": "Pune",
            "familySize": 1,
            "details": {"consent_given": True, "consent_timestamp": "2026-05-15T10:00:00Z"},
        },
    )
    assert r.status_code == 200, r.text


def test_erasure_anonymizes_beneficiary_pii_preserves_metrics():
    token = _token("admin@indiango.org")
    create = client.post(
        "/programs/beneficiaries",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Erasure Test Subject",
            "program": "Education",
            "location": "Delhi",
            "familySize": 2,
            "details": {
                "consent_given": True,
                "email": "erasure.test@example.com",
                "timeline": [{"type": "outcome", "text": "1 child educated", "at": "2026-01-01"}],
            },
        },
    )
    assert create.status_code == 200

    log = client.post(
        "/compliance/erasure",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Erasure Test Subject",
            "email": "erasure.test@example.com",
            "reason": "Right to erasure test",
        },
    )
    assert log.status_code == 200, log.text
    req_id = log.json().get("request_id")
    assert req_id

    done = client.post(
        f"/compliance/erasure/{req_id}/complete",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert done.status_code == 200, done.text
    assert done.json().get("anonymized_beneficiaries", 0) >= 1

    ngo_id = "ngo_001"
    lst = BENEFICIARIES_MEM_BY_NGO.get(ngo_id, [])
    erased = next((b for b in lst if b.get("name") == "Erased data subject"), None)
    assert erased is not None
    metrics = (erased.get("details") or {}).get("anonymized_metrics") or []
    assert any("educated" in str(m.get("text", m)).lower() for m in metrics if isinstance(m, dict))


def test_tenant_cannot_read_other_ngo_donor():
    token_a = _token("admin@indiango.org")
    foreign_id = "donor-foreign-999"
    DONORS_MEM_BY_NGO.setdefault("ngo_other", []).append(
        {
            "id": foreign_id,
            "name": "Foreign NGO Donor",
            "type": "Individual",
            "totalGiven": 1000,
            "lastGift": "2026-01-01",
            "initial": "F",
            "pan": "",
            "location": "",
            "tags": [],
            "email": "foreign@example.com",
            "phone": "",
            "meta": {},
        }
    )
    r = client.get(
        f"/crm/donors/{foreign_id}",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert r.status_code == 404


def test_field_role_blocked_from_finance_journal_post():
    token = _token("field@indiango.org")
    r = client.post(
        "/finance/journal-entry",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "description": "Test expense",
            "amount": 100,
            "entry_type": "Expense",
            "fund": "General",
        },
    )
    assert r.status_code == 403


def test_fcra_admin_cap_rejects_over_limit_expense():
    token = _token("finance@indiango.org")
    ngo_id = "ngo_001"
    FINANCE_EVENTS_MEM_BY_NGO[ngo_id] = [
        {
            "id": "fcra-inc-1",
            "fund": "FCRA",
            "entry_type": "Income",
            "amount": 1_000_000,
            "is_admin_overhead": False,
        },
        {
            "id": "fcra-adm-1",
            "fund": "FCRA",
            "entry_type": "Expense",
            "amount": 150_000,
            "is_admin_overhead": True,
            "category": "Administrative",
        },
    ]
    r = client.post(
        "/finance/journal-entry",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "description": "Admin overhead breach attempt",
            "amount": 100_000,
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


def test_login_rate_limit_returns_429():
    reset_login_rate_limit_for_tests()
    last_status = 200
    for i in range(35):
        r = client.post(
            "/auth/login",
            json={"email": f"brute{i}@test.com", "password": "wrong"},
        )
        last_status = r.status_code
    assert last_status == 429
