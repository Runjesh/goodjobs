"""Background tick for WhatsApp delivery queue (APScheduler)."""
from __future__ import annotations

import logging

from core.wa_delivery_queue import process_wa_delivery_queue

_LOG = logging.getLogger("goodjobs")


def tick_wa_delivery_queue() -> None:
    try:
        r = process_wa_delivery_queue(limit=25)
        if r.get("processed"):
            _LOG.info("wa_delivery_queue processed=%s source=%s", r.get("processed"), r.get("source"))
    except Exception as exc:
        _LOG.warning("wa_delivery_queue tick failed: %s", exc)


def register_wa_queue_scheduler(scheduler) -> None:
    """Add interval job to an existing BackgroundScheduler instance."""
    scheduler.add_job(
        tick_wa_delivery_queue,
        "interval",
        minutes=1,
        id="wa_delivery_queue",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
        misfire_grace_time=120,
    )
