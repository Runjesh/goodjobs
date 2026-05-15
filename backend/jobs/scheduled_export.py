"""
Scheduled Data Export Job
Runs: Daily at 06:00 IST via APScheduler (registered in backend/api/main.py startup).
      The job's own _should_run_today() gate fires only on due days:
        weekly  → every Monday
        monthly → 1st of every month

Action: For each NGO with exports enabled, builds a full DPDP-compliant data export
        ZIP using the shared build_ngo_export_zip() (same function as GET /dpdp/export)
        and emails it to the registered admin address.

Email configuration (env vars):
  SMTP_HOST   — e.g. smtp.sendgrid.net or email-smtp.ap-south-1.amazonaws.com
  SMTP_PORT   — default 587 (STARTTLS)
  SMTP_USER   — SMTP username
  SMTP_PASS   — SMTP password / API key
  SMTP_FROM   — sender address, default noreply@goodjobs.co.in

Idempotency: EXPORT_LAST_SENT dict tracks the last sent date per (ngo_id, frequency)
             so duplicate fires on the same day are safe no-ops.
"""

import os
import smtplib
from datetime import date, datetime, timezone
from email.encoders import encode_base64
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List

from core.db import db_conn
from core.export_builder import build_ngo_export_zip

# ── Idempotency guard ────────────────────────────────────────────────────────
# Primary: DB lock via export_send_log table (works across replicas).
# Secondary: in-process dict as a fast-path cache within a single process.
# Key: "{ngo_id}:{frequency}:{date}", Value: True when sent in this process.
EXPORT_LAST_SENT: Dict[str, bool] = {}


def _idempotency_key(ngo_id: str, frequency: str) -> str:
    return f"{ngo_id}:{frequency}:{date.today().isoformat()}"


def _claim_send_slot(conn, ngo_id: str, frequency: str) -> bool:
    """
    Attempt to claim a send slot for today via a DB INSERT.
    Returns True when the slot was successfully claimed (proceed with send).
    Returns False when another worker already claimed it (skip).
    Falls back to the in-process dict when no DB is available.
    """
    key = _idempotency_key(ngo_id, frequency)
    # Fast-path: already sent in this process
    if EXPORT_LAST_SENT.get(key):
        return False

    if conn is None:
        # Memory-only mode — in-process dict is the best we can do
        EXPORT_LAST_SENT[key] = True
        return True

    try:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS export_send_log (
                ngo_id    UUID NOT NULL,
                send_date DATE NOT NULL,
                frequency TEXT NOT NULL,
                sent_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (ngo_id, send_date, frequency)
            )
            """
        )
        cur.execute(
            """
            INSERT INTO export_send_log (ngo_id, send_date, frequency)
            VALUES (%s::uuid, %s::date, %s)
            ON CONFLICT DO NOTHING
            """,
            (ngo_id, date.today().isoformat(), frequency),
        )
        claimed = cur.rowcount == 1
        if claimed:
            EXPORT_LAST_SENT[key] = True
        return claimed
    except Exception as e:
        print(f"  [WARN] Could not acquire idempotency lock from DB: {e}. Falling back to in-process guard.")
        if EXPORT_LAST_SENT.get(key):
            return False
        EXPORT_LAST_SENT[key] = True
        return True


# ── Email delivery ────────────────────────────────────────────────────────────

def _build_email_body(ngo_name: str, frequency: str, exported_at: str) -> str:
    return f"""Hello,

Your {frequency} GoodJobs data export is attached.

Organisation : {ngo_name}
Exported at  : {exported_at} UTC
Frequency    : {frequency.capitalize()}

The attached ZIP contains one CSV file per data type:
  donors.csv, transactions.csv, beneficiaries.csv,
  grants.csv, compliance_docs.csv, volunteers.csv

This export was generated automatically under the Digital Personal Data
Protection Act 2023 (DPDP Act) data-portability provisions.

— GoodJobs Automated Export System
  noreply@goodjobs.co.in
"""


def send_export_email(to_email: str, ngo_name: str, frequency: str,
                      zip_bytes: bytes, filename: str) -> bool:
    """
    Send the export ZIP as an email attachment.

    Returns True on success, False when SMTP is not configured (demo / dev mode).
    Raises on SMTP errors so the caller can log and continue.
    """
    smtp_host = os.getenv("SMTP_HOST", "").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "").strip()
    smtp_pass = os.getenv("SMTP_PASS", "").strip()
    smtp_from = os.getenv("SMTP_FROM", "noreply@goodjobs.co.in").strip()

    if not smtp_host:
        size_kb = len(zip_bytes) / 1024
        exported_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
        print(
            f"  [SMTP NOT CONFIGURED] Would send {frequency} export to <{to_email}> "
            f"— {filename} ({size_kb:.1f} KB) for {ngo_name} at {exported_at} UTC"
        )
        return False

    exported_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
    subject = f"GoodJobs {frequency.capitalize()} Data Export — {ngo_name} ({date.today()})"

    msg = MIMEMultipart()
    msg["From"]    = smtp_from
    msg["To"]      = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(_build_email_body(ngo_name, frequency, exported_at), "plain"))

    attachment = MIMEBase("application", "zip")
    attachment.set_payload(zip_bytes)
    encode_base64(attachment)
    attachment.add_header("Content-Disposition", "attachment", filename=filename)
    msg.attach(attachment)

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        if smtp_user and smtp_pass:
            server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_from, [to_email], msg.as_string())

    print(f"  ✉  Sent {frequency} export to <{to_email}> — {filename}")
    return True


# ── Schedule checker ──────────────────────────────────────────────────────────

def _should_run_today(frequency: str) -> bool:
    """Return True if the job should fire on today's date for the given frequency."""
    today = date.today()
    if frequency == "weekly":
        return today.weekday() == 0  # Monday
    if frequency == "monthly":
        return today.day == 1
    return False


# ── Schedule loader ───────────────────────────────────────────────────────────

def _load_schedules_from_db(conn) -> List[Dict[str, Any]]:
    """Query ngo_export_schedules for all enabled NGOs."""
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT s.ngo_id::text, s.schedule, n.name AS ngo_name
            FROM ngo_export_schedules s
            JOIN ngos n ON n.id = s.ngo_id
            WHERE (s.schedule->>'enabled')::boolean = true
            """
        )
        rows = cur.fetchall()
        return [
            {
                "ngo_id":    r[0],
                "email":     (r[1] or {}).get("email", ""),
                "frequency": (r[1] or {}).get("frequency", "weekly"),
                "ngo_name":  r[2] or "NGO",
                "schedule":  r[1] or {},
            }
            for r in rows
        ]
    except Exception as e:
        print(f"  [WARN] Could not read ngo_export_schedules from DB: {e}")
        return []


def _load_schedules_from_memory() -> List[Dict[str, Any]]:
    """
    Fallback used when no DB is configured.
    Reads in-process EXPORT_SCHEDULE_MEM_BY_NGO — only works when the job runs
    inside the same API process (e.g. APScheduler in-process).
    """
    try:
        from api.main import EXPORT_SCHEDULE_MEM_BY_NGO  # type: ignore[import]
        return [
            {
                "ngo_id":    ngo_id,
                "email":     cfg.get("email", ""),
                "frequency": cfg.get("frequency", "weekly"),
                "ngo_name":  cfg.get("ngo_name", "NGO"),
                "schedule":  cfg,
            }
            for ngo_id, cfg in EXPORT_SCHEDULE_MEM_BY_NGO.items()
            if cfg.get("enabled")
        ]
    except ImportError:
        return []


def _get_mem_stores(ngo_id: str) -> Dict[str, List[Dict]]:
    """
    Build the mem_stores dict for build_ngo_export_zip() when running without a DB.
    Seeds the in-memory data stores (same way as dpdp_export) then returns them.
    Only called when conn is None (memory-only / demo mode).
    """
    try:
        from api.main import (  # type: ignore[import]
            DONORS_MEM_BY_NGO, TX_MEM_BY_NGO, BENEFICIARIES_MEM_BY_NGO,
            CSR_CARDS_MEM_BY_NGO, COMPLIANCE_DOCS_MEM_BY_NGO,
            VOLUNTEERS_ROSTER_MEM_BY_NGO,
            _seed_memory_crm, _seed_memory_beneficiaries,
            _seed_memory_csr, _seed_memory_volunteer_roster,
        )
        _seed_memory_crm(ngo_id)
        _seed_memory_beneficiaries(ngo_id)
        _seed_memory_csr(ngo_id)
        _seed_memory_volunteer_roster(ngo_id)
        return {
            "donors":        list(DONORS_MEM_BY_NGO.get(ngo_id, [])),
            "transactions":  list(TX_MEM_BY_NGO.get(ngo_id, [])),
            "beneficiaries": list(BENEFICIARIES_MEM_BY_NGO.get(ngo_id, [])),
            "grants":        list(CSR_CARDS_MEM_BY_NGO.get(ngo_id, [])),
            "compliance":    list(COMPLIANCE_DOCS_MEM_BY_NGO.get(ngo_id, [])),
            "volunteers":    list(VOLUNTEERS_ROSTER_MEM_BY_NGO.get(ngo_id, [])),
        }
    except ImportError:
        return {}


# ── Main entry point ──────────────────────────────────────────────────────────

def run_scheduled_exports() -> None:
    """
    Main cron entry point — registered with APScheduler on API startup.

    1. Loads enabled export schedules from ngo_export_schedules (DB first,
       falls back to in-process memory store when running under APScheduler).
    2. Idempotency: skips any NGO already sent to today.
    3. For each due NGO: builds the export ZIP via the shared build_ngo_export_zip()
       (same function called by GET /dpdp/export), then emails it.
    """
    print(f"\n=== GoodJobs Scheduled Export Job — {date.today()} ===")

    with db_conn() as conn:
        if conn is not None:
            schedules = _load_schedules_from_db(conn)
        else:
            schedules = _load_schedules_from_memory()

        if not schedules:
            print("  No NGOs have an active export schedule. Exiting.")
            return

        sent = 0
        skipped = 0
        for entry in schedules:
            ngo_id    = entry["ngo_id"]
            frequency = entry.get("frequency", "weekly")
            email     = entry.get("email", "")
            ngo_name  = entry.get("ngo_name", "NGO")

            if not _should_run_today(frequency):
                print(f"  ⏭  [{ngo_id[:8]}…] {frequency} schedule not due today — skipping.")
                skipped += 1
                continue

            if not _claim_send_slot(conn, ngo_id, frequency):
                print(f"  ⏭  [{ngo_id[:8]}…] Already sent today (idempotency guard) — skipping.")
                skipped += 1
                continue

            if not email:
                print(f"  ⚠  [{ngo_id[:8]}…] No email address configured — skipping.")
                skipped += 1
                continue

            today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            filename  = f"goodjobs_export_{ngo_id[:8]}_{today_str}.zip"
            ngo_info  = {"name": ngo_name, "ngo_id": ngo_id}

            print(f"  🗜  [{ngo_id[:8]}…] Building export for {ngo_name} ({frequency})…")
            try:
                # In DB mode: use the live connection (same canonical path as /dpdp/export).
                # In memory mode: seed and pass the in-process stores.
                mem_stores = {} if conn is not None else _get_mem_stores(ngo_id)
                zip_bytes = build_ngo_export_zip(
                    ngo_id=ngo_id,
                    exported_by=f"scheduler (recipient: {email})",
                    ngo_info=ngo_info,
                    conn=conn,
                    mem_stores=mem_stores,
                )
                send_export_email(email, ngo_name, frequency, zip_bytes, filename)
                sent += 1
            except Exception as exc:
                print(f"  ✗  [{ngo_id[:8]}…] Export failed: {exc}")

    print(f"\n✅ Scheduled export run complete — {sent} sent, {skipped} skipped.")


if __name__ == "__main__":
    run_scheduled_exports()
