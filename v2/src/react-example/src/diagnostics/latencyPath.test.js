import { describe, expect, it } from 'vitest';

import { decomposeReceiverLatency } from './latencyPath';

const receiving = (over = {}) => ({
  isReceiving: true, rttMs: 40, jitterBufferMs: 60, ...over,
});

describe('decomposeReceiverLatency', () => {
  it('splits the receiver figure into the two parts it can measure', () => {
    const path = decomposeReceiverLatency(receiving());
    expect(path.rows.map((r) => [r.key, r.valueMs])).toEqual([
      ['network', 20],   // half the round trip
      ['jitter', 60],
    ]);
    expect(path.totalMs).toBe(80);
    expect(path.partial).toBe(false);
  });

  /*
   * A publisher has no receive path at all, so there is nothing here to decompose. Showing
   * the panel there was the thing that made it useless.
   */
  it('has nothing to say on a sender', () => {
    expect(decomposeReceiverLatency({ isReceiving: false, rttMs: 40 })).toBeNull();
  });

  it('has nothing to say before anything is measured', () => {
    expect(decomposeReceiverLatency(null)).toBeNull();
    expect(decomposeReceiverLatency(receiving({ rttMs: null, jitterBufferMs: null }))).toBeNull();
  });

  // One half is a floor, not a sum, and the panel labels it as such.
  it('marks a half-measured figure as incomplete', () => {
    const path = decomposeReceiverLatency(receiving({ jitterBufferMs: null }));
    expect(path.totalMs).toBe(20);
    expect(path.partial).toBe(true);
  });
});
