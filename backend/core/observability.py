"""
Observability Layer for SevaSuite
─────────────────────────────────
Sentry  : Captures all unhandled exceptions + FastAPI request traces.
Langfuse: Traces every LLM call — records agent name, tokens, latency, cost per NGO.

Both integrations are boot-safe:
  • If env vars are absent (local dev / unit tests), they initialise as no-ops.
  • Production: set SENTRY_DSN and LANGFUSE_SECRET_KEY / LANGFUSE_PUBLIC_KEY.
"""
import os
import time
import logging
from contextlib import contextmanager
from typing import Optional, Generator

logger = logging.getLogger("sevasuite.observability")

# ── Sentry ────────────────────────────────────────────────────────────────────

def init_sentry() -> bool:
    """
    Initialise Sentry SDK.  Returns True if configured, False if skipped.
    Add `init_sentry()` at the top of backend/api/main.py (before app creation).
    """
    dsn = os.getenv("SENTRY_DSN", "")
    if not dsn:
        logger.info("SENTRY_DSN not set — Sentry disabled (dev mode).")
        return False

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration

        sentry_sdk.init(
            dsn=dsn,
            environment=os.getenv("ENVIRONMENT", "production"),
            release=os.getenv("APP_VERSION", "2.0.0"),
            traces_sample_rate=float(os.getenv("SENTRY_TRACE_RATE", "0.2")),
            integrations=[
                StarletteIntegration(transaction_style="endpoint"),
                FastApiIntegration(transaction_style="endpoint"),
            ],
            # Scrub sensitive fields before sending to Sentry
            before_send=_scrub_sensitive,
        )
        logger.info("✅ Sentry initialised (DSN configured).")
        return True
    except ImportError:
        logger.warning("sentry-sdk not installed — skipping Sentry init.")
        return False


def _scrub_sensitive(event, hint):
    """Remove PII / secrets from Sentry payloads before upload."""
    _SENSITIVE_KEYS = {"password", "token", "secret", "pan", "aadhaar", "jwt", "Authorization"}
    request = event.get("request", {})
    data = request.get("data", {})
    if isinstance(data, dict):
        for key in list(data.keys()):
            if any(s in key.lower() for s in _SENSITIVE_KEYS):
                data[key] = "[REDACTED]"
    return event


def capture_exception(exc: Exception, extra: Optional[dict] = None):
    """Manually capture an exception in Sentry (with optional context)."""
    try:
        import sentry_sdk
        with sentry_sdk.push_scope() as scope:
            if extra:
                for k, v in extra.items():
                    scope.set_extra(k, v)
            sentry_sdk.capture_exception(exc)
    except Exception:
        pass  # Never let observability break the app


# ── Langfuse ──────────────────────────────────────────────────────────────────

class _NoOpTrace:
    """Null-object trace returned when Langfuse is not configured."""
    def end(self, **kwargs): pass
    def span(self, *args, **kwargs): return self
    def __enter__(self): return self
    def __exit__(self, *_): pass


_langfuse_client = None


def _get_langfuse():
    """Lazy singleton for the Langfuse client."""
    global _langfuse_client
    if _langfuse_client is not None:
        return _langfuse_client

    secret_key = os.getenv("LANGFUSE_SECRET_KEY", "")
    public_key = os.getenv("LANGFUSE_PUBLIC_KEY", "")
    host = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")

    if not secret_key or not public_key:
        logger.info("LANGFUSE keys not set — LLM tracing disabled (dev mode).")
        _langfuse_client = None
        return None

    try:
        from langfuse import Langfuse
        _langfuse_client = Langfuse(
            secret_key=secret_key,
            public_key=public_key,
            host=host,
        )
        logger.info("✅ Langfuse initialised.")
        return _langfuse_client
    except ImportError:
        logger.warning("langfuse package not installed — skipping LLM tracing.")
        return None


def track_agent_run(
    agent_name: str,
    input_text: str,
    output_text: str,
    input_tokens: int,
    output_tokens: int,
    latency_ms: float,
    ngo_id: str,
    model: str = "gpt-4o",
    metadata: Optional[dict] = None,
) -> None:
    """
    Record a single agent LLM call in Langfuse.

    Usage in any agent:
        start = time.time()
        response = llm.invoke(prompt)
        track_agent_run(
            agent_name="DonorNurtureAgent",
            input_text=prompt,
            output_text=response.content,
            input_tokens=response.usage_metadata["input_tokens"],
            output_tokens=response.usage_metadata["output_tokens"],
            latency_ms=(time.time() - start) * 1000,
            ngo_id=ngo_id,
        )
    """
    lf = _get_langfuse()
    if lf is None:
        return

    try:
        trace = lf.trace(
            name=agent_name,
            metadata={
                "ngo_id": ngo_id,
                "model": model,
                **(metadata or {}),
            },
        )
        trace.generation(
            name=f"{agent_name}_generation",
            model=model,
            input=input_text,
            output=output_text,
            usage={
                "input": input_tokens,
                "output": output_tokens,
                "unit": "TOKENS",
            },
            metadata={"latency_ms": latency_ms},
        )
        lf.flush()
    except Exception as e:
        logger.warning(f"Langfuse tracking failed (non-fatal): {e}")


@contextmanager
def agent_trace(
    agent_name: str,
    ngo_id: str,
    model: str = "gpt-4o",
) -> Generator[dict, None, None]:
    """
    Context-manager convenience wrapper for Langfuse tracing.

    Usage:
        with agent_trace("GrantReportAgent", ngo_id=ngo_id) as ctx:
            response = llm.invoke(prompt)
            ctx["input"] = prompt
            ctx["output"] = response.content
            ctx["input_tokens"] = ...
            ctx["output_tokens"] = ...
    """
    ctx: dict = {
        "agent_name": agent_name,
        "ngo_id": ngo_id,
        "model": model,
        "input": "",
        "output": "",
        "input_tokens": 0,
        "output_tokens": 0,
    }
    start = time.perf_counter()
    try:
        yield ctx
    finally:
        latency_ms = (time.perf_counter() - start) * 1000
        track_agent_run(
            agent_name=ctx["agent_name"],
            input_text=ctx["input"],
            output_text=ctx["output"],
            input_tokens=ctx["input_tokens"],
            output_tokens=ctx["output_tokens"],
            latency_ms=latency_ms,
            ngo_id=ctx["ngo_id"],
            model=ctx["model"],
        )
