/**
 * Task #9 — Lock the false-green regression closed.
 *
 * apiFetch's default behaviour is to fall through to the local mock backend
 * whenever a real fetch fails (connection refused, 404 / 405 from a static
 * host, etc.) so the demo UI keeps working without a backend. That is the
 * RIGHT default for read-only hydrate calls, but it's the WRONG default for
 * mutations like "Approve & Send" — a mock 200 there silently marks a
 * touchpoint done even though no message was ever sent.
 *
 * These tests pin the contract that endpoints opting in with
 * `noMockFallback: true` see a real failure response when the backend is
 * unreachable, and that the existing default mock-fallback path is
 * unchanged for everyone else.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiFetch } from '../client';

describe('apiFetch noMockFallback', () => {
  const origFetch = global.fetch;
  beforeEach(() => {
    // Mock is enabled by default in the test env (jsdom + DEV).
    localStorage.clear();
  });
  afterEach(() => {
    global.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it('falls through to the mock backend on network failure when noMockFallback is omitted (default behaviour preserved)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    // /crm/donors is a known mocked path so we can observe the fallback.
    const res = await apiFetch('/crm/donors');
    // The mock backend either returns 200 with a payload or a 503 if
    // mocks are disabled; in either case it must NOT throw and must NOT
    // synthesise a generic 503 from apiFetch's noMock branch.
    expect(res).toBeInstanceOf(Response);
    expect([200, 503]).toContain(res.status);
  });

  it('returns a real 503 (no mock fallback) when noMockFallback:true and fetch rejects', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await apiFetch('/crm/outreach', {
      method: 'POST',
      noMockFallback: true,
      body: JSON.stringify({ donor_ids: ['1'] }),
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/unreachable/i);
  });

  it('does NOT fall through to the mock when noMockFallback:true and the real response is 404', async () => {
    // Static host returning HTML 404 — the default code path would normally
    // promote this to a mock 200 for known paths.
    global.fetch = vi.fn().mockResolvedValue(
      new Response('<html>Not Found</html>', {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    const res = await apiFetch('/crm/outreach', {
      method: 'POST',
      noMockFallback: true,
      body: JSON.stringify({ donor_ids: ['1'] }),
    });
    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
  });

  it('strips the noMockFallback flag from the underlying fetch init', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    global.fetch = fetchSpy;
    await apiFetch('/anything', { method: 'POST', noMockFallback: true });
    const call = fetchSpy.mock.calls[0];
    const passedInit = call[1] as RequestInit & { noMockFallback?: unknown };
    expect(passedInit.noMockFallback).toBeUndefined();
    expect(passedInit.method).toBe('POST');
  });
});
