/**
 * Verifies the lapse-risk acknowledge / snooze flow is backed by
 * `ackLapseRisk` (which writes through to the lifecycle endpoint),
 * not just by Dashboard's local snooze map. This is the persistence
 * contract Task #10 reviewers asked us to lock down: both the
 * "Acknowledge" and "Snooze 14 days" buttons on Today must hit
 * PUT /crm/donors/{id}/lifecycle so the suppression survives across
 * devices.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ackLapseRisk, loadDonorState, setLifecycleScope } from '../donorLifecycle';

describe('ackLapseRisk', () => {
  const origFetch = global.fetch;
  beforeEach(() => {
    localStorage.clear();
    setLifecycleScope('test-tenant');
  });
  afterEach(() => {
    global.fetch = origFetch;
    setLifecycleScope(null);
    vi.restoreAllMocks();
  });

  it('writes lapseRiskAckAt to cache + LS and PUTs the lifecycle endpoint', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    global.fetch = fetchSpy;

    const before = Date.now();
    const state = ackLapseRisk('42');
    const after = Date.now();

    expect(state.lapseRiskAckAt).toBeDefined();
    const ackMs = new Date(state.lapseRiskAckAt!).getTime();
    expect(ackMs).toBeGreaterThanOrEqual(before);
    expect(ackMs).toBeLessThanOrEqual(after);

    // Cache + LS write-through.
    expect(loadDonorState('42').lapseRiskAckAt).toBe(state.lapseRiskAckAt);
    expect(localStorage.getItem('goodjobs.test-tenant.donor.42.v2')).toContain('lapseRiskAckAt');

    // Fire-and-forget PUT — give the microtask queue a tick to drain.
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchSpy).toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/crm/donors/42/lifecycle');
    expect((init as RequestInit).method).toBe('PUT');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.state.lapseRiskAckAt).toBe(state.lapseRiskAckAt);
  });

  it('persists for many donors (covers the lapse-risk fan-out from Today)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchSpy;
    ['1', '2', '3'].forEach(id => { ackLapseRisk(id); });
    await Promise.resolve();
    await Promise.resolve();
    const urls = fetchSpy.mock.calls.map(c => String(c[0]));
    expect(urls.filter(u => u.includes('/crm/donors/1/lifecycle'))).toHaveLength(1);
    expect(urls.filter(u => u.includes('/crm/donors/2/lifecycle'))).toHaveLength(1);
    expect(urls.filter(u => u.includes('/crm/donors/3/lifecycle'))).toHaveLength(1);
  });
});
