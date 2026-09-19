import { describe, expect, it } from 'vitest';

import {
  CLOCK_GRANULARITY_MS,
  MIN_SAMPLES,
  WINDOW_SAMPLES,
  estimateOffset,
} from './clockSync';

/*
 * One round trip against a far end whose clock is offsetMs ahead of ours.
 *
 * forwardShare is how much of the round trip the outbound leg took: 0.5 is a symmetric
 * path, which is the assumption the estimator cannot verify, and anything else is the
 * asymmetry that is its whole error budget. The far end replies instantly, so its
 * turnaround cancels out of the round trip and the test controls rtt directly.
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

  /*
   * The point of the whole module. A slow sample can land closer to the truth by luck, and
   * an average would let it drag the answer around, so the fastest round trip wins outright.
   * Here the fast sample says 50 and seven slow ones say 30: any averaging scheme lands
   * near 32, and the right answer is 50.
   */
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

  /*
   * Null is the answer, not zero. Zero is what a same-machine session legitimately measures,
   * so returning it for "no idea" would make the two indistinguishable in the UI.
   */
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

    /*
     * A clock that steps mid-window shows up as the fastest samples disagreeing with each
     * other by far more than their own round trips allow. 120 ms of disagreement across
     * samples with round trips of 4 to 6 ms cannot be path asymmetry.
     */
    it('returns null when the fastest samples do not agree', () => {
      const unstable = [
        roundTrip({ offsetMs: 0, rttMs: 4 }),
        roundTrip({ offsetMs: 120, rttMs: 5 }),
        roundTrip({ offsetMs: 0, rttMs: 6 }),
        ...repeat(7, () => roundTrip({ offsetMs: 0, rttMs: 50 })),
      ];

      expect(estimateOffset(unstable)).toBeNull();
    });

    /*
     * The same shape, with the disagreement inside what the round trips can explain, has to
     * still produce an answer. Without this the stability rule could be "always refuse" and
     * the test above would not notice.
     */
    it('still answers when the disagreement is small enough to be path asymmetry', () => {
      const wobbly = [
        roundTrip({ offsetMs: 0, rttMs: 4 }),
        roundTrip({ offsetMs: 3, rttMs: 5 }),
        roundTrip({ offsetMs: 0, rttMs: 6 }),
        ...repeat(7, () => roundTrip({ offsetMs: 0, rttMs: 50 })),
      ];

      expect(estimateOffset(wobbly).offsetMs).toBe(0);
    });

    /*
     * The agreement rule is per pair, not one tolerance taken from the slowest of the
     * fastest three. Two 1 ms round trips cannot legitimately disagree by 300 ms whatever a
     * 400 ms sample sitting beside them is doing. Measured against the earlier
     * spread-against-the-largest rule, this window returned an offset of 0 with a stated
     * uncertainty of 0.5 ms, which is the exact failure the module exists to delete.
     */
    it('refuses a step between two fast samples that a slow third would otherwise excuse', () => {
      const stepped = [
        roundTrip({ offsetMs: 0, rttMs: 1 }),
        roundTrip({ offsetMs: 300, rttMs: 1 }),
        roundTrip({ offsetMs: 0, rttMs: 400 }),
        ...repeat(5, () => roundTrip({ offsetMs: 0, rttMs: 500 })),
      ];

      expect(estimateOffset(stepped)).toBeNull();
    });

    /*
     * The other half of that rule, without which it could be "refuse whenever the fastest
     * three are not identical" and the test above would still pass. A 200 ms round trip is
     * allowed to sit 40 ms away from a 4 ms one, because that is what half its own round
     * trip permits, and that allowance is the entire reason the minimum is what gets used.
     */
    it('still answers when the only sample that disagrees is the slow one', () => {
      const wide = [
        roundTrip({ offsetMs: 0, rttMs: 4 }),
        roundTrip({ offsetMs: 0, rttMs: 6 }),
        roundTrip({ offsetMs: 40, rttMs: 200 }),
        ...repeat(5, () => roundTrip({ offsetMs: 0, rttMs: 300 })),
      ];

      expect(estimateOffset(wide).offsetMs).toBe(0);
    });

    /*
     * Loopback round trips are 0 to 1 ms, so without a floor for clock granularity the
     * tolerance would be zero and a perfectly healthy same-machine window would refuse on
     * millisecond rounding.
     */
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

    /*
     * A round trip cannot be negative. When one comes back that way the local clock moved
     * between t0 and t3, which is exactly the condition that would otherwise hand back the
     * lowest RTT in the window and win.
     */
    it('drops a sample whose round trip came out negative', () => {
      const stepped = { t0: 100, t1: 90, t2: 95, t3: 90 };
      const good = repeat(MIN_SAMPLES, () => roundTrip({ offsetMs: 7, rttMs: 30 }));

      const estimate = estimateOffset([...good, stepped]);
      expect(estimate.offsetMs).toBe(7);
      expect(estimate.samples).toBe(MIN_SAMPLES);
    });

    /*
     * A reply cannot precede the request that caused it. Here the far clock stepped back
     * 60 ms between receiving and replying, so subtracting that turnaround inflates the
     * round trip to a plausible-looking 80 ms: fast enough to beat every honest sample in
     * this window and, before the per-leg check, to report 960 against a true offset of
     * 1000.
     */
    it('drops a sample whose far end replied before it received', () => {
      const backward = { t0: 0, t1: 1000, t2: 940, t3: 20 };
      const good = repeat(MIN_SAMPLES, () => roundTrip({ offsetMs: 1000, rttMs: 500 }));

      const estimate = estimateOffset([...good, backward]);
      expect(estimate.offsetMs).toBe(1000);
      expect(estimate.samples).toBe(MIN_SAMPLES);
    });

    /*
     * Both legs backwards at once cancel into a positive round trip, so a check on the
     * combined figure alone passes it. It carries a 105 ms error on a 10 ms round trip,
     * which was enough to drag an otherwise healthy window into refusing outright.
     */
    it('drops a sample whose two legs run backwards and cancel', () => {
      const cancelling = { t0: 100, t1: 0, t2: -20, t3: 90 };
      const good = repeat(MIN_SAMPLES, () => roundTrip({ offsetMs: 0, rttMs: 60 }));

      const estimate = estimateOffset([...good, cancelling]);
      expect(estimate.offsetMs).toBe(0);
      expect(estimate.samples).toBe(MIN_SAMPLES);
    });
  });

  /*
   * An old sample with an unbeatable round trip would otherwise hold the answer for the
   * rest of the session, long after the far clock had slewed out from under it.
   */
  it('forgets samples that have fallen out of the window', () => {
    const stale = roundTrip({ offsetMs: 999, rttMs: 2 });
    const recent = repeat(WINDOW_SAMPLES, () => roundTrip({ offsetMs: 20, rttMs: 50 }));

    const estimate = estimateOffset([stale, ...recent]);
    expect(estimate.offsetMs).toBe(20);
    expect(estimate.samples).toBe(WINDOW_SAMPLES);
  });

  /*
   * The error the module cannot detect, pinned down so nobody mistakes the uncertainty for
   * a measured accuracy: a 100 ms path that spends 90 ms outbound and 10 ms back reports a
   * healthy-looking estimate that is 40 ms wrong, inside the stated bound of 50 ms.
   */
  it('is wrong by the path asymmetry, silently, within its stated bound', () => {
    const skewed = repeat(MIN_SAMPLES, () => roundTrip({ offsetMs: 0, rttMs: 100, forwardShare: 0.9 }));

    const estimate = estimateOffset(skewed);
    expect(estimate.offsetMs).toBe(40);
    expect(estimate.uncertaintyMs).toBe(50);
    expect(Math.abs(estimate.offsetMs)).toBeLessThanOrEqual(estimate.uncertaintyMs);
  });
});
