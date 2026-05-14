"""Minimal WhatsApp Cloud API text send (shared by CRM outreach and delivery queue)."""
from __future__ import annotations

import json
import urllib.request
from typing import Optional


def send_whatsapp_text(access_token: str, phone_number_id: str, to_phone: str, message: str) -> Optional[str]:
    """
    POST a text message. Returns wamid on success; raises on HTTP/API error.
    """
    url = f"https://graph.facebook.com/v19.0/{phone_number_id}/messages"
    payload = json.dumps({
        "messaging_product": "whatsapp",
        "to": to_phone,
        "type": "text",
        "text": {"body": message[:4096]},
    }).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    messages = data.get("messages") or []
    if messages:
        return str(messages[0].get("id") or "")
    return None
