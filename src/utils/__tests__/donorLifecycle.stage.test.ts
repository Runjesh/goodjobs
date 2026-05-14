/**
 * Locks in the donor lifecycle math (Task #11).
 *
 * Stage thresholds are exclusive on the upper bound:
 *   acquisition  : days <  30
 *   stewardship  : 30 <= days <  90
 *   renewal      : 90 <= days < 330
 *   lapse_risk   : 330 <= days < 360 (modulated by LAPSE_RISK_WINDOW)
 *   lapsed       : days >= 360
 *
 * Touchpoint state machine (per milestone, relative to last gift):
 *   days < trigger             → upcoming
 *   trigger <= days <= trigger+7 → due
 *   days >  trigger+7          → overdue
 *
 * Lapse-risk acknowledgement window is 14 days: an ack (or a renewal
 * touch) within the last 14d demotes a lapse_risk donor back to renewal.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  computeStage,
  computeTouchpoints,
  nextDueMilestone,
  urgencyScore,
  ackLapseRisk,
  markMilestoneDone,
  markMilestoneSkipped,
  setLifecycleScope,
  type MilestoneId,
} from '../donorLifecycle';

const NOW = new Date('2026-06-01T12:00:00Z');

const giftDaysAgo = (days: number, ref: Date = NOW): string =>
  new Date(ref.getTime() - days * 86_400_000).toISOString();

const donor = (id: string | number, lastGiftDays: number | null) => ({
  id,
  lastGift: lastGiftDays == null ? undefined : giftDaysAgo(lastGiftDays),
});

describe('donorLifecycle: computeStage boundaries', () => {
  beforeEach(() => {
    localStorage.clear();
    setLifecycleScope('test-stage');
    // Silence the fire-and-forget PUTs from mutation helpers.
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  });
  afterEach(() => {
    setLifecycleScope(null);
    vi.restoreAllMocks();
  });

  it('returns "unknown" when there is no recorded gift', () => {
    expect(computeStage(donor('u', null), NOW)).toBe('unknown');
  });

  it('29 days = acquisition, 30 days = stewardship (boundary at 30)', () => {
    expect(computeStage(donor('a29', 29), NOW)).toBe('acquisition');
    expect(computeStage(donor('a30', 30), NOW)).toBe('stewardship');
  });

  it('89 days = stewardship, 90 days = renewal (boundary at 90)', () => {
    expect(computeStage(donor('s89', 89), NOW)).toBe('stewardship');
    expect(computeStage(donor('s90', 90), NOW)).toBe('renewal');
  });

  it('329 days = renewal, 330 days = lapse_risk (boundary at 330, no ack)', () => {
    expect(computeStage(donor('r329', 329), NOW)).toBe('renewal');
    expect(computeStage(donor('r330', 330), NOW)).toBe('lapse_risk');
  });

  it('359 days = lapse_risk, 360 days = lapsed (boundary at 360)', () => {
    expect(computeStage(donor('lr359', 359), NOW)).toBe('lapse_risk');
    expect(computeStage(donor('lp360', 360), NOW)).toBe('lapsed');
  });

  it('lapse-risk: an ack within the 14d window keeps the donor at "renewal"', () => {
    const d = donor('lr-ack', 340);
    expect(computeStage(d, NOW)).toBe('lapse_risk');
    // Ack 13 days ago — still inside the 14d window.
    ackLapseRisk(d.id, new Date(NOW.getTime() - 13 * 86_400_000));
    expect(computeStage(d, NOW)).toBe('renewal');
  });

  it('lapse-risk: an ack older than 14d is ignored (donor is lapse_risk again)', () => {
    const d = donor('lr-stale', 340);
    // Ack 14 days ago — strictly NOT inside the < 14d window.
    ackLapseRisk(d.id, new Date(NOW.getTime() - 14 * 86_400_000));
    expect(computeStage(d, NOW)).toBe('lapse_risk');
    // 15 days old: definitely outside.
    ackLapseRisk(d.id, new Date(NOW.getTime() - 15 * 86_400_000));
    expect(computeStage(d, NOW)).toBe('lapse_risk');
  });

  it('lapse-risk: a recent renewal touchpoint also keeps the donor at "renewal"', () => {
    const d = donor('lr-touch', 340);
    markMilestoneDone(d.id, 'renewal', new Date(NOW.getTime() - 5 * 86_400_000));
    expect(computeStage(d, NOW)).toBe('renewal');
  });

  it('lapsed (>=360d) is unaffected by ack/touch — only the 330–360 window is gated', () => {
    const d = donor('lp-acked', 400);
    ackLapseRisk(d.id, new Date(NOW.getTime() - 1 * 86_400_000));
    expect(computeStage(d, NOW)).toBe('lapsed');
  });
});

describe('donorLifecycle: computeTouchpoints', () => {
  beforeEach(() => {
    localStorage.clear();
    setLifecycleScope('test-tp');
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  });
  afterEach(() => {
    setLifecycleScope(null);
    vi.restoreAllMocks();
  });

  it('every milestone is "upcoming" when the donor has no recorded gift', () => {
    const list = computeTouchpoints({ id: 'np', lastGift: undefined }, NOW);
    expect(list).toHaveLength(4);
    list.forEach(m => {
      expect(m.state).toBe('upcoming');
      expect(m.dueDate).toBeNull();
    });
  });

  it('day-3 thank-you transitions upcoming → due → overdue at the correct boundaries', () => {
    const tp = (days: number) => computeTouchpoints(donor('tp', days), NOW)
      .find(m => m.id === 'thankyou')!;
    expect(tp(2).state).toBe('upcoming');
    expect(tp(3).state).toBe('due');
    expect(tp(10).state).toBe('due');     // trigger + 7d window inclusive
    expect(tp(11).state).toBe('overdue'); // > trigger + 7d
  });

  it('marking a milestone done flips its state to "done" and records doneDate', () => {
    const d = donor('mk', 5);
    const doneAt = new Date(NOW.getTime() - 1 * 86_400_000);
    markMilestoneDone(d.id, 'thankyou', doneAt);
    const m = computeTouchpoints(d, NOW).find(x => x.id === 'thankyou')!;
    expect(m.state).toBe('done');
    expect(m.doneDate?.toISOString()).toBe(doneAt.toISOString());
  });

  it('skipped milestones report state="skipped"', () => {
    const d = donor('sk', 35);
    markMilestoneSkipped(d.id, 'impact');
    const m = computeTouchpoints(d, NOW).find(x => x.id === 'impact')!;
    expect(m.state).toBe('skipped');
  });

  it('marking a previously-skipped milestone done clears the skip', () => {
    const d = donor('un-skip', 35);
    markMilestoneSkipped(d.id, 'impact');
    markMilestoneDone(d.id, 'impact', NOW);
    const m = computeTouchpoints(d, NOW).find(x => x.id === 'impact')!;
    expect(m.state).toBe('done');
  });

  it('dueDate is exactly lastGift + triggerDays for each milestone', () => {
    const d = donor('dd', 10);
    const list = computeTouchpoints(d, NOW);
    const triggers: Record<MilestoneId, number> = {
      thankyou: 3, impact: 30, fullimpact: 90, renewal: 330,
    };
    for (const m of list) {
      const expected = new Date(new Date(d.lastGift!).getTime() + triggers[m.id] * 86_400_000);
      expect(m.dueDate?.toISOString()).toBe(expected.toISOString());
    }
  });
});

describe('donorLifecycle: nextDueMilestone', () => {
  beforeEach(() => {
    localStorage.clear();
    setLifecycleScope('test-next');
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  });
  afterEach(() => {
    setLifecycleScope(null);
    vi.restoreAllMocks();
  });

  it('returns the soonest "upcoming" when nothing is due', () => {
    const m = nextDueMilestone(donor('soon', 1), NOW);
    expect(m?.id).toBe('thankyou');
    expect(m?.state).toBe('upcoming');
  });

  it('prefers a "due" milestone over any "upcoming" ones', () => {
    // 3 days post-gift: thankyou is due; impact + others are upcoming.
    const m = nextDueMilestone(donor('due', 3), NOW);
    expect(m?.id).toBe('thankyou');
    expect(m?.state).toBe('due');
  });

  it('prefers the latest "overdue" milestone over earlier overdue + due', () => {
    // 95 days post-gift: thankyou (3) and impact (30) are overdue;
    // fullimpact (90) is due. We expect the LAST overdue (impact).
    const m = nextDueMilestone(donor('over', 95), NOW);
    expect(m?.id).toBe('impact');
    expect(m?.state).toBe('overdue');
  });

  it('returns null when every milestone is done or skipped', () => {
    const d = donor('clean', 10);
    (['thankyou', 'impact', 'fullimpact', 'renewal'] as MilestoneId[])
      .forEach(mid => markMilestoneSkipped(d.id, mid));
    expect(nextDueMilestone(d, NOW)).toBeNull();
  });
});

describe('donorLifecycle: urgencyScore', () => {
  beforeEach(() => {
    localStorage.clear();
    setLifecycleScope('test-urg');
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  });
  afterEach(() => {
    setLifecycleScope(null);
    vi.restoreAllMocks();
  });

  it('higher-stage donors outrank lower-stage donors at the base weight', () => {
    // Compare base-weight contributions only (no next-milestone bumps) by
    // marking every milestone skipped on each donor.
    const mkClean = (id: string, days: number) => {
      const d = donor(id, days);
      (['thankyou', 'impact', 'fullimpact', 'renewal'] as MilestoneId[])
        .forEach(mid => markMilestoneSkipped(d.id, mid));
      return d;
    };
    const lr  = urgencyScore(mkClean('lr',  340), NOW); // 100
    const lp  = urgencyScore(mkClean('lp',  400), NOW); //  90
    const rn  = urgencyScore(mkClean('rn',  120), NOW); //  70
    const acq = urgencyScore(mkClean('ac',   10), NOW); //  50
    const stw = urgencyScore(mkClean('st',   60), NOW); //  40
    expect(lr).toBeGreaterThan(lp);
    expect(lp).toBeGreaterThan(rn);
    expect(rn).toBeGreaterThan(acq);
    expect(acq).toBeGreaterThan(stw);
  });

  it('the +20 "due" bump is added on top of the stage weight (isolated)', () => {
    // Same stage (acquisition, base 50) for both donors, isolating the
    // milestone-state bump. Donor A has every milestone skipped → no
    // next-milestone bump. Donor B is exactly at day 3, so thankyou is
    // "due" → +20 bump.
    const a = donor('a-clean', 10);
    (['thankyou', 'impact', 'fullimpact', 'renewal'] as MilestoneId[])
      .forEach(mid => markMilestoneSkipped(a.id, mid));
    expect(urgencyScore(a, NOW)).toBe(50);                // base only
    expect(urgencyScore(donor('b-due', 3), NOW)).toBe(70); // base 50 + 20
  });

  it('the +30 "overdue" bump is added on top of the stage weight (isolated)', () => {
    // Both donors are renewal (base 70). Donor A: skip everything → no
    // milestone bump. Donor B: at 100d → impact (trigger 30) is overdue
    // → +30 bump.
    const a = donor('a-rn', 120);
    (['thankyou', 'impact', 'fullimpact', 'renewal'] as MilestoneId[])
      .forEach(mid => markMilestoneSkipped(a.id, mid));
    expect(urgencyScore(a, NOW)).toBe(70);                  // base only
    expect(urgencyScore(donor('b-rn', 100), NOW)).toBe(100); // base 70 + 30
  });

  it('upcoming bump grows as the dueDate approaches (max 14)', () => {
    // 25d post-gift: impact is upcoming, due in 5 days → bump = 14-5 = 9.
    // 5d post-gift: impact is upcoming, due in 25 days → bump = 0 (clamped).
    const close = urgencyScore(donor('close', 25), NOW);
    const far   = urgencyScore(donor('far',    5), NOW);
    expect(close - far).toBeGreaterThanOrEqual(9);
  });

  it('returns the bare stage weight when there is no next milestone', () => {
    const d = donor('done', 10);
    (['thankyou', 'impact', 'fullimpact', 'renewal'] as MilestoneId[])
      .forEach(mid => markMilestoneSkipped(d.id, mid));
    // Stage at 10d is acquisition (weight 50).
    expect(urgencyScore(d, NOW)).toBe(50);
  });
});
