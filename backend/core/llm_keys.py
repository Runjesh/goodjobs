"""
Resolve OpenAI API keys for agents: per-NGO key (Settings UI) → env OPENAI_API_KEY.

Keys at rest are encrypted with Fernet derived from JWT_SECRET (or OPENAI_KEY_ENCRYPTION_SECRET).
"""
from __future__ import annotations

import base64
import hashlib
import os
from typing import Dict, Optional

from core.db import db_conn

# Decrypted keys in process memory (never logged).
_ORG_OPENAI_KEYS: Dict[str, str] = {}


def _fernet():
    from cryptography.fernet import Fernet

    secret = (
        os.getenv("OPENAI_KEY_ENCRYPTION_SECRET")
        or os.getenv("JWT_SECRET")
        or "sevasuite-dev-secret-change-in-production"
    ).encode()
    key = base64.urlsafe_b64encode(hashlib.sha256(secret).digest())
    return Fernet(key)


def _is_placeholder_key(key: str) -> bool:
    k = (key or "").strip().lower()
    return not k or k.startswith("sk-mock") or k in ("placeholder", "none", "your-key-here")


def _looks_like_openai_secret(key: str) -> bool:
    k = (key or "").strip()
    return len(k) >= 20 and k.startswith("sk-")


def resolve_openai_api_key(ngo_id: Optional[str] = None) -> Optional[str]:
    """
    Return a usable OpenAI API key, or None to trigger heuristic / template fallbacks.

    Priority:
      1. Per-NGO key set via POST /settings/llm (memory + DB)
      2. Environment variable OPENAI_API_KEY (if not a placeholder)
    """
    if ngo_id:
        hit = _ORG_OPENAI_KEYS.get(str(ngo_id).strip())
        if hit and _looks_like_openai_secret(hit) and not _is_placeholder_key(hit):
            return hit.strip()
    env_k = (os.getenv("OPENAI_API_KEY") or "").strip()
    if env_k and not _is_placeholder_key(env_k) and _looks_like_openai_secret(env_k):
        return env_k
    return None


def mask_api_key(key: str) -> str:
    k = (key or "").strip()
    if len(k) <= 12:
        return "••••" if k else ""
    return f"{k[:7]}…{k[-4:]}"


def set_org_openai_key(ngo_id: str, api_key: str) -> None:
    """Store key for NGO (memory + encrypted Postgres row when DB configured)."""
    ngo_id = str(ngo_id).strip()
    raw = (api_key or "").strip()
    if not _looks_like_openai_secret(raw):
        raise ValueError("Invalid OpenAI API key format (expected sk-… secret).")
    _ORG_OPENAI_KEYS[ngo_id] = raw
    f = _fernet()
    cipher = f.encrypt(raw.encode()).decode("ascii")
    with db_conn() as conn:
        if conn is None:
            return
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS ngo_llm_settings (
                ngo_id TEXT PRIMARY KEY,
                openai_key_cipher TEXT NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            INSERT INTO ngo_llm_settings (ngo_id, openai_key_cipher, updated_at)
            VALUES (%s, %s, NOW())
            ON CONFLICT (ngo_id) DO UPDATE SET openai_key_cipher = EXCLUDED.openai_key_cipher, updated_at = NOW()
            """,
            (ngo_id, cipher),
        )


def clear_org_openai_key(ngo_id: str) -> None:
    ngo_id = str(ngo_id).strip()
    _ORG_OPENAI_KEYS.pop(ngo_id, None)
    with db_conn() as conn:
        if conn is None:
            return
        cur = conn.cursor()
        try:
            cur.execute("DELETE FROM ngo_llm_settings WHERE ngo_id = %s", (ngo_id,))
        except Exception:
            pass


def load_all_org_keys_from_db() -> int:
    """Populate memory cache from Postgres. Returns number of rows loaded."""
    n = 0
    f = _fernet()
    with db_conn() as conn:
        if conn is None:
            return 0
        cur = conn.cursor()
        try:
            cur.execute(
                """
                SELECT ngo_id, openai_key_cipher FROM ngo_llm_settings
                """
            )
            for row in cur.fetchall() or []:
                nid, cipher = str(row[0]), str(row[1])
                try:
                    raw = f.decrypt(cipher.encode("ascii")).decode("utf-8")
                except Exception:
                    continue
                if _looks_like_openai_secret(raw):
                    _ORG_OPENAI_KEYS[nid] = raw
                    n += 1
        except Exception:
            pass
    return n


def llm_key_status_for_ngo(ngo_id: str) -> dict:
    """For GET /settings/llm — never returns the raw secret."""
    ngo_id = str(ngo_id).strip()
    org = _ORG_OPENAI_KEYS.get(ngo_id)
    env = (os.getenv("OPENAI_API_KEY") or "").strip()
    env_ok = bool(env and not _is_placeholder_key(env) and _looks_like_openai_secret(env))
    if org and not _is_placeholder_key(org):
        return {
            "configured": True,
            "masked": mask_api_key(org),
            "source": "organisation",
            "env_fallback_available": env_ok,
        }
    if env_ok:
        return {
            "configured": True,
            "masked": mask_api_key(env),
            "source": "environment",
            "env_fallback_available": True,
        }
    return {
        "configured": False,
        "masked": None,
        "source": "none",
        "env_fallback_available": False,
    }
