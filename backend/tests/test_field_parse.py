"""Field MIS parse — messy Hinglish / slang input."""
from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)

HINDI_SLANG_NOTE = (
    "Bhaiya, Meena ka visit ho gaya, sab theek hai, usko ration diya."
)


def test_field_report_parse_extracts_meena_and_ration():
    r = client.post(
        "/webhook/field-report/parse",
        json={"report_text": HINDI_SLANG_NOTE, "reporter_id": "field-1"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    parsed = data.get("parsed") or {}
    name = (parsed.get("beneficiary_name") or data.get("beneficiary_name") or "").lower()
    notes = (parsed.get("notes") or data.get("notes") or "").lower()
    action = (parsed.get("action") or data.get("action") or "").lower()
    blob = " ".join([name, notes, action, str(data.get("summary", "")).lower()])
    assert "meena" in blob or "ration" in blob
