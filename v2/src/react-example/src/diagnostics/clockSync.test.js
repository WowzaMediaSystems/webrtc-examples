import { describe, expect, it } from 'vitest';

import {
  CLOCK_GRANULARITY_MS,
  MIN_SAMPLES,
  WINDOW_SAMPLES,
  estimateOffset,
} from './clockSync';

/*
 * One round trip against a far end whose clock is offsetMs ahead of ours. forwardShare is the
 * outbound leg's share of the round trip (0.5 is symmetric). The far end replies instantly,
 * so the test controls rtt directly.
 */
const roundTrip = ({ offsetMs = 0, rttMs = 20, forwardShare = 0.5, t0 = 1_000_000 } = {}) => {
  const t1 = t0 + rttMs * forwardShare + offsetMs;
  return { t0, t1, t2: t1, t3: t0 + rttMs };
};

const repeat = (count, make) => Array.from({ length: count }, (_unused, i) => make(i));

describe('estimateOffset', () => {
  it('recovers an offset that was injected on purpose', () => {
    const rtts = [40, 60, 25, 80, 55, 30, 95, 45, 70, 35];
    const estimate = estimateOffset(rtts.map((rttMs) => roundTrip({ offsetMs: 137, rttMs })));

    expect(estimate.offsetMs).toBe(137);
    expect(estimate.uncertaintyMs).toBe(12.5); // the 25 ms round trip, halved
    expect(estimate.samples).toBe(10);
  });

  // Any averaging lands near 32; the fastest round trip says 50, and that wins.
  it('takes the minimum-RTT sample rather than the crowd', () => {
    const slow = repeat(7, () => roundTrip({ offsetMs: 30, rttMs: 100 }));
    const fast = roundTrip({ offsetMs: 50, rttMs: 20 });

    const estimate = estimateOffset([...slow, fast]);

    expect(estimate.offsetMs).toBe(50);
    expect(estimate.uncertaintyMs).toBe(10);
  });

  // Half the fastest round trip, exactly, and not rounded on the way out.
  it('reports the uncertainty as rtt_min / 2', () => {
    const estimate = estimateOffset(repeat(MIN_SAMPLES, (i) => roundTrip({ rttMs: 21 + i * 10 })));
    expect(estimate.uncertaintyMs).toBe(10.5);
  });

  // Null, not zero: zero is a legitimate same-machine offset.
  describe('refusing to answer', () => {
    it('returns null before there are enough samples to take a minimum over', () => {
      expect(estimateOffset(repeat(MIN_SAMPLES - 1, () => roundTrip()))).toBeNull();
      expect(estimateOffset(repeat(MIN_SAMPLES, () => roundTrip()))).not.toBeNull();
    });

    it('returns null on nothing at all', () => {
      expect(estimateOffset([])).toBeNull();
      expect(estimateOffset(null)).toBeNull();
      expect(estimateOffset(undefined)).toBeNull();
    });

    // 120 ms of disagreement across 4 to 6 ms round trips cannot be path asymmetry.
    it('returns null when the fastest samples do not agree', () => {
      const unstable = [
        roundTrip({ offsetMs: 0, rttMs: 4 }),
        roundTrip({ offsetMs: 120, rttMs: 5 }),
        roundTrip({ offsetMs: 0, rttMs: 6 }),
        ...repeat(7, () => roundTrip({ offsetMs: 0, rttMs: 50 })),
      ];

      expect(estimateOffset(unstable)).toBeNull();
    });

    // Guards against a stability rule that always refuses.
    it('still answers when the disagreement is small enough to be path asymmetry', () => {
      const wobbly = [
        roundTrip({ offsetMs: 0, rttMs: 4 }),
        roundTrip({ offsetMs: 3, rttMs: 5 }),
        roundTrip({ offsetMs: 0, rttMs: 6 }),
        ...repeat(7, () => roundTrip({ offsetMs: 0, rttMs: 50 })),
      ];

      expect(estimateOffset(wobbly).offsetMs).toBe(0);
    });

    // Agreement is per pair: a 400 ms sample cannot excuse two 1 ms samples 300 ms apart.
    it('refuses a step between two fast samples that a slow third would otherwise excuse', () => {
      const stepped = [
        roundTrip({ offsetMs: 0, rttMs: 1 }),
        roundTrip({ offsetMs: 300, rttMs: 1 }),
        roundTrip({ offsetMs: 0, rttMs: 400 }),
        ...repeat(5, () => roundTrip({ offsetMs: 0, rttMs: 500 })),
      ];

      expect(estimateOffset(stepped)).toBeNull();
    });

    // The other half: a 200 ms sample may sit 40 ms from a 4 ms one, within half its round trip.
    it('still answers when the only sample that disagrees is the slow one', () => {
      const wide = [
        roundTrip({ offsetMs: 0, rttMs: 4 }),
        roundTrip({ offsetMs: 0, rttMs: 6 }),
        roundTrip({ offsetMs: 40, rttMs: 200 }),
        ...repeat(5, () => roundTrip({ offsetMs: 0, rttMs: 300 })),
      ];

      expect(estimateOffset(wide).offsetMs).toBe(0);
    });

    // Without a granularity floor, a 0 to 1 ms loopback window would refuse on rounding.
    it('tolerates clock granularity on a near-zero round trip', () => {
      const loopback = [
        roundTrip({ offsetMs: 0, rttMs: 0 }),
        roundTrip({ offsetMs: CLOCK_GRANULARITY_MS, rttMs: 1 }),
        ...repeat(6, () => roundTrip({ offsetMs: 1, rttMs: 1 })),
      ];

      const estimate = estimateOffset(loopback);
      expect(estimate.offsetMs).toBe(0);
      expect(estimate.uncertaintyMs).toBe(0);
    });
  });

  describe('samples it will not use', () => {
    // A missing or non-numeric timestamp is a dropped reply, not a measurement.
    it('drops malformed samples and counts only what it used', () => {
      const junk = [null, {}, { t0: 1, t1: 2, t2: 3 }, { t0: 1, t1: NaN, t2: 3, t3: 4 }];
      const good = repeat(MIN_SAMPLES, () => roundTrip({ offsetMs: 12, rttMs: 20 }));

      const estimate = estimateOffset([...junk, ...good]);
      expect(estimate.offsetMs).toBe(12);
      expect(estimate.samples).toBe(MIN_SAMPLES);
    });

    it('returns null when dropping the malformed ones leaves too few', () => {
      const junk = repeat(5, () => null);
      const good = repeat(MIN_SAMPLES - 1, () => roundTrip());
      expect(estimateOffset([...junk, ...good])).toBeNull();
    });

    // A negative round trip means the local clock moved; it would otherwise win the window.
    it('drops a sample whose round trip came out negative', () => {
      const stepped = { t0: 100, t1: 90, t2: 95, t3: 90 };
      const good = repeat(MIN_SAMPLES, () => roundTrip({ offsetMs: 7, rttMs: 30 }));

      const estimate = estimateOffset([...good, stepped]);
      expect(estimate.offsetMs).toBe(7);
      expect(estimate.samples).toBe(MIN_SAMPLES);
    });

    /*
     * The far clock stepped back 60 ms during turnaround, giving a plausible 80 ms round trip
     * that would beat every honest sample.
     */
    it('drops a sample whose far end replied before it received', () => {
      const backward = { t0: 0, t1: 1000, t2: 940, t3: 20 };
      const good = repeat(MIN_SAMPLES, () => roundTrip({ offsetMs: 1000, rttMs: 500 }));

      const estimate = estimateOffset([...good, backward]);
      expect(estimate.offsetMs).toBe(1000);
      expect(estimate.samples).toBe(MIN_SAMPLES);
    });

    // Both legs backwards cancel into a positive round trip that a combined check would pass.
    it('drops a sample whose two legs run backwards and cancel', () => {
      const cancelling = { t0: 100, t1: 0, t2: -20, t3: 90 };
      const good = repeat(MIN_SAMPLES, () => roundTrip({ offsetMs: 0, rttMs: 60 }));

      const estimate = estimateOffset([...good, cancelling]);
      expect(estimate.offsetMs).toBe(0);
      expect(estimate.samples).toBe(MIN_SAMPLES);
    });
  });

  // An old sample with an unbeatable round trip must not hold the answer forever.
  it('forgets samples that have fallen out of the window', () => {
    const stale = roundTrip({ offsetMs: 999, rttMs: 2 });
    const recent = repeat(WINDOW_SAMPLES, () => roundTrip({ offsetMs: 20, rttMs: 50 }));

    const estimate = estimateOffset([stale, ...recent]);
    expect(estimate.offsetMs).toBe(20);
    expect(estimate.samples).toBe(WINDOW_SAMPLES);
  });

  /*
   * The undetectable error, pinned so the uncertainty is not mistaken for measured accuracy:
   * a 90/10 split on a 100 ms path is 40 ms wrong, inside the 50 ms bound.
   */
  it('is wrong by the path asymmetry, silently, within its stated bound', () => {
    const skewed = repeat(MIN_SAMPLES, () => roundTrip({ offsetMs: 0, rttMs: 100, forwardShare: 0.9 }));

    const estimate = estimateOffset(skewed);
    expect(estimate.offsetMs).toBe(40);
    expect(estimate.uncertaintyMs).toBe(50);
    expect(Math.abs(estimate.offsetMs)).toBeLessThanOrEqual(estimate.uncertaintyMs);
  });
});
