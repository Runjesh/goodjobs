"""
Shared DPDP-compliant export ZIP builder.

Used by:
  - backend/api/main.py   → GET /dpdp/export (on-demand, returns HTTP response)
  - backend/jobs/scheduled_export.py → scheduled cron job (emails the ZIP)

Both callers pass in the same parameters so the resulting ZIP is identical
regardless of whether the export is triggered by a user or by a scheduler.
"""

import csv
import io
import json
import zipfile
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


# ── CSV helpers ───────────────────────────────────────────────────────────────

def _make_csv(rows: List[Dict[str, Any]]) -> str:
    if not rows:
        return ""
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()), extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue()


def _ser(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False)
    return str(v)


# ── Row builders ──────────────────────────────────────────────────────────────

def _donors_from_db(cur, ngo_id: str) -> List[Dict]:
    cur.execute(
        """
        SELECT id::text, full_name, COALESCE(donor_type,'') as donor_type,
               COALESCE(total_lifetime_value,0)::float as total_given,
               COALESCE(pan_masked,'') as pan,
               COALESCE(location_text,'') as location,
               COALESCE(email,'') as email,
               COALESCE(phone,'') as phone,
               COALESCE(tags,'{}') as tags
        FROM donors WHERE ngo_id = %s::uuid ORDER BY created_at DESC
        """,
        (ngo_id,),
    )
    return [
        {"id": r[0], "name": r[1], "type": r[2], "total_given": r[3],
         "pan": r[4], "location": r[5], "email": r[6], "phone": r[7],
         "tags": ";".join(list(r[8] or []))}
        for r in cur.fetchall()
    ]


def _donors_from_mem(mem: List[Dict]) -> List[Dict]:
    return [
        {"id": _ser(d.get("id")), "name": _ser(d.get("name")),
         "type": _ser(d.get("type")), "total_given": _ser(d.get("totalGiven")),
         "pan": _ser(d.get("pan")), "location": _ser(d.get("location")),
         "email": _ser(d.get("email")), "phone": _ser(d.get("phone")),
         "tags": ";".join(d.get("tags") or [])}
        for d in mem
    ]


def _transactions_from_db(cur, ngo_id: str) -> List[Dict]:
    cur.execute(
        """
        SELECT id::text, donor_id::text, COALESCE(donor_name,'') as donor_name,
               amount::float, COALESCE(method,'') as method,
               COALESCE(campaign_id::text,'') as campaign_id,
               COALESCE(campaign_title,'') as campaign_title,
               created_at
        FROM transactions WHERE ngo_id = %s::uuid ORDER BY created_at DESC
        """,
        (ngo_id,),
    )
    return [
        {"id": r[0], "donor_id": r[1], "donor_name": r[2], "amount": r[3],
         "method": r[4], "campaign_id": r[5], "campaign_title": r[6],
         "date": _ser(r[7])}
        for r in cur.fetchall()
    ]


def _transactions_from_mem(mem: List[Dict]) -> List[Dict]:
    return [
        {"id": _ser(t.get("id")), "donor_id": _ser(t.get("donorId")),
         "donor_name": _ser(t.get("donorName")), "amount": _ser(t.get("amount")),
         "method": _ser(t.get("method")), "campaign_id": _ser(t.get("campaignId")),
         "campaign_title": _ser(t.get("campaignTitle")), "date": _ser(t.get("date"))}
        for t in mem
    ]


def _beneficiaries_from_db(cur, ngo_id: str) -> List[Dict]:
    cur.execute(
        """
        SELECT id, name, program, location, aadhaar, family_size,
               COALESCE(details,'{}') as details
        FROM program_beneficiaries WHERE ngo_id = %s ORDER BY created_at DESC
        """,
        (ngo_id,),
    )
    return [
        {"id": _ser(r[0]), "name": _ser(r[1]), "program": _ser(r[2]),
         "location": _ser(r[3]), "aadhaar": "yes" if r[4] else "no",
         "family_size": _ser(r[5]), "details": _ser(r[6])}
        for r in cur.fetchall()
    ]


def _beneficiaries_from_mem(mem: List[Dict]) -> List[Dict]:
    return [
        {"id": _ser(b.get("id")), "name": _ser(b.get("name")),
         "program": _ser(b.get("program")), "location": _ser(b.get("location")),
         "aadhaar": "yes" if b.get("aadhaar") else "no",
         "family_size": _ser(b.get("familySize")), "details": _ser(b.get("details"))}
        for b in mem
    ]


def _grants_from_db(cur, ngo_id: str) -> List[Dict]:
    cur.execute(
        """
        SELECT id::text, company, amount::float, project,
               COALESCE(tags,'{}') as tags, status, COALESCE(agent,'') as agent,
               COALESCE(report_due_date,'') as report_due_date,
               COALESCE(win_probability::text,'') as win_probability
        FROM csr_pipeline WHERE ngo_id = %s::uuid ORDER BY created_at DESC
        """,
        (ngo_id,),
    )
    return [
        {"id": r[0], "company": r[1], "amount": r[2], "project": r[3],
         "tags": ";".join(list(r[4] or [])), "status": r[5], "agent": r[6],
         "report_due_date": r[7], "win_probability": r[8]}
        for r in cur.fetchall()
    ]


def _grants_from_mem(mem: List[Dict]) -> List[Dict]:
    return [
        {"id": _ser(g.get("id")), "company": _ser(g.get("company")),
         "amount": _ser(g.get("amount")), "project": _ser(g.get("project")),
         "tags": ";".join(g.get("tags") or []), "status": _ser(g.get("col")),
         "agent": _ser(g.get("agent")), "report_due_date": _ser(g.get("report_due_date")),
         "win_probability": _ser(g.get("win_probability"))}
        for g in mem
    ]


def _compliance_from_db(cur, ngo_id: str) -> List[Dict]:
    cur.execute(
        """
        SELECT id::text, name, doc_type, status, expiry_date,
               COALESCE(registration_number,'') as reg_no,
               COALESCE(assigned_to,'') as assigned_to,
               uploaded_at
        FROM compliance_documents WHERE ngo_id = %s::uuid ORDER BY uploaded_at DESC
        """,
        (ngo_id,),
    )
    return [
        {"id": r[0], "name": r[1], "type": r[2], "status": r[3],
         "expiry": _ser(r[4]), "registration_number": r[5],
         "assigned_to": r[6], "uploaded_at": _ser(r[7])}
        for r in cur.fetchall()
    ]


def _compliance_from_mem(mem: List[Dict]) -> List[Dict]:
    return [
        {"id": _ser(c.get("id")), "name": _ser(c.get("name")),
         "type": _ser(c.get("type")), "status": _ser(c.get("status")),
         "expiry": _ser(c.get("expiry")),
         "registration_number": _ser(c.get("registration_number")),
         "assigned_to": _ser(c.get("assigned_to")),
         "uploaded_at": _ser(c.get("uploadedAt"))}
        for c in mem
    ]


def _volunteers_from_db(cur, ngo_id: str) -> List[Dict]:
    cur.execute(
        """
        SELECT id::text, name, COALESCE(skills,'{}') as skills,
               COALESCE(hours_logged,0)::float as hours, verified
        FROM volunteers WHERE ngo_id = %s::uuid ORDER BY created_at DESC
        """,
        (ngo_id,),
    )
    return [
        {"id": r[0], "name": r[1], "skills": ";".join(list(r[2] or [])),
         "hours": r[3], "verified": "yes" if r[4] else "no"}
        for r in cur.fetchall()
    ]


def _volunteers_from_mem(mem: List[Dict]) -> List[Dict]:
    return [
        {"id": _ser(v.get("id")), "name": _ser(v.get("name")),
         "skills": ";".join(v.get("skills") or []),
         "hours": _ser(v.get("hours")), "verified": "yes" if v.get("verified") else "no"}
        for v in mem
    ]


# ── Main public function ──────────────────────────────────────────────────────

def build_ngo_export_zip(
    ngo_id: str,
    exported_by: str,
    ngo_info: Optional[Dict[str, Any]] = None,
    conn=None,
    mem_stores: Optional[Dict[str, List[Dict]]] = None,
) -> bytes:
    """
    Build and return a DPDP-compliant export ZIP as raw bytes.

    Parameters
    ----------
    ngo_id      : UUID string of the organisation
    exported_by : email address of the user/system triggering the export
    ngo_info    : dict with keys name, reg_no, fcra_reg, pan, state (used in manifest)
    conn        : live psycopg2 connection; when None falls back to mem_stores
    mem_stores  : dict mapping store names to lists:
                    donors, transactions, beneficiaries, grants, compliance, volunteers
                  Only consulted when conn is None.
    """
    exported_at = datetime.now(timezone.utc).isoformat()
    mem_stores = mem_stores or {}

    if conn is not None:
        cur = conn.cursor()
        donors_rows      = _donors_from_db(cur, ngo_id)
        tx_rows          = _transactions_from_db(cur, ngo_id)
        ben_rows         = _beneficiaries_from_db(cur, ngo_id)
        grant_rows       = _grants_from_db(cur, ngo_id)
        comp_rows        = _compliance_from_db(cur, ngo_id)
        vol_rows         = _volunteers_from_db(cur, ngo_id)
    else:
        donors_rows      = _donors_from_mem(mem_stores.get("donors", []))
        tx_rows          = _transactions_from_mem(mem_stores.get("transactions", []))
        ben_rows         = _beneficiaries_from_mem(mem_stores.get("beneficiaries", []))
        grant_rows       = _grants_from_mem(mem_stores.get("grants", []))
        comp_rows        = _compliance_from_mem(mem_stores.get("compliance", []))
        vol_rows         = _volunteers_from_mem(mem_stores.get("volunteers", []))

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        manifest = {
            "exported_by": exported_by,
            "exported_at": exported_at,
            "ngo": ngo_info or {},
            "files": ["manifest.json", "donors.csv", "transactions.csv",
                      "beneficiaries.csv", "grants.csv", "compliance_docs.csv",
                      "volunteers.csv"],
        }
        zf.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
        zf.writestr("donors.csv",          _make_csv(donors_rows))
        zf.writestr("transactions.csv",    _make_csv(tx_rows))
        zf.writestr("beneficiaries.csv",   _make_csv(ben_rows))
        zf.writestr("grants.csv",          _make_csv(grant_rows))
        zf.writestr("compliance_docs.csv", _make_csv(comp_rows))
        zf.writestr("volunteers.csv",      _make_csv(vol_rows))

    return buf.getvalue()
