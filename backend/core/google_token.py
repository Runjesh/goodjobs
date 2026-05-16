"""Verify Google Sign-In ID tokens (issued to our OAuth client)."""

from __future__ import annotations

import os
from typing import Any, Dict

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token


def verify_google_credential(credential: str) -> Dict[str, Any]:
    """
    Raises ValueError if the client id is not configured or the token is invalid.
    """
    aud = (os.getenv("GOOGLE_CLIENT_ID") or os.getenv("VITE_GOOGLE_CLIENT_ID") or "").strip()
    if not aud:
        raise ValueError("missing_google_client_id")
    info: Dict[str, Any] = google_id_token.verify_oauth2_token(
        credential,
        google_requests.Request(),
        aud,
    )
    return info
