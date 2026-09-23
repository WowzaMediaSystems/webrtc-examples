import { describe, expect, it } from 'vitest';

import { summarizeStats } from './stats';

// getStats() resolves to an RTCStatsReport, which is Map-like. A Map is a faithful stand-in.
const report = (...stats) => new Map(stats.map((s, i) => [s.id || `s${i}`, s]));

const pair = (over = {}) => ({
  type: 'candidate-pair', state: 'succeeded', nominated: true,
  currentRoundTripTime: 0.040, availableOutgoingBitrate: 2_500_000, ...over,
});

const inbound = (over = {}) => ({
  type: 'inbound-rtp', kind: 'video',
  jitterBufferDelay: 12, jitterBufferEmittedCount: 300,   // => 40ms average
  jitter: 0.004, packetsReceived: 9900, packetsLost: 100,
  bytesReceived: 1_000_000, framesPerSecond: 30, frameWidth: 1280, frameHeight: 720, ...over,
});

describe('RTT', () => {
  it('reads currentRoundTripTime from the nominated candidate pair, in ms', () => {
    const s = summarizeStats(report(pair(), inbound()), null, 1000, 0);
    expect(s.rttMs).toBeCloseTo(40);
  });

  it('falls back to the RTCP-reported RTT when no pair RTT is available', () => {
    const s = summarizeStats(
      report(
        pair({ currentRoundTripTime: undefined }),
        { type: 'remote-inbound-rtp', kind: 'video', roundTripTime: 0.085 }
      ), null, 1000, 0);
    expect(s.rttMs).toBeCloseTo(85);
  });

  it('reports null rather than zero when RTT is genuinely unknown', () => {
    const s = summarizeStats(report(inbound()), null, 1000, 0);
    expect(s.rttMs).toBeNull();
  });
});

describe('latency estimate', () => {
  it('is half the RTT plus the average jitter buffer delay', () => {
    // 40ms RTT -> 20ms one way, plus 12/300 = 40ms buffered.
    const s = summarizeStats(report(pair(), inbound()), null, 1000, 0);
    expect(s.jitterBufferMs).toBeCloseTo(40);
    expect(s.estimatedLatencyMs).toBeCloseTo(60);
    expect(s.latencyIsPartial).toBe(false);
  });

  it('flags the estimate as partial when only one half is known', () => {
    const s = summarizeStats(report(pair()), null, 1000, 0);
    expect(s.estimatedLatencyMs).toBeCloseTo(20);
    expect(s.latencyIsPartial).toBe(true);
  });

  it('is null when neither half is known', () => {
    const s = summarizeStats(report({ type: 'outbound-rtp', kind: 'video' }), null, 1000, 0);
    expect(s.estimatedLatencyMs).toBeNull();
  });

  it('does not divide by zero before any frame has been emitted', () => {
    const s = summarizeStats(
      report(pair(), inbound({ jitterBufferEmittedCount: 0, jitterBufferDelay: 0 })), null, 1000, 0);
    expect(s.jitterBufferMs).toBeNull();
    expect(Number.isFinite(s.estimatedLatencyMs)).toBe(true);
  });
});

describe('rates', () => {
  it('derives inbound kbps from the byte delta between two samples', () => {
    const first = report(pair(), inbound({ bytesReceived: 1_000_000 }));
    const second = report(pair(), inbound({ bytesReceived: 1_250_000 }));
    // 250,000 bytes over 2s = 125,000 B/s = 1000 kbps
    const s = summarizeStats(second, first, 3000, 1000);
    expect(s.inboundKbps).toBeCloseTo(1000);
  });

  it('returns null rather than a negative rate when counters reset', () => {
    const first = report(pair(), inbound({ bytesReceived: 5_000_000 }));
    const second = report(pair(), inbound({ bytesReceived: 1000 }));
    expect(summarizeStats(second, first, 3000, 1000).inboundKbps).toBeNull();
  });

  it('has no rate on the very first sample', () => {
    expect(summarizeStats(report(pair(), inbound()), null, 1000, 0).inboundKbps).toBeNull();
  });
});

describe('packet loss', () => {
  it('is a percentage of received plus lost', () => {
    const s = summarizeStats(report(pair(), inbound()), null, 1000, 0);
    expect(s.packetLossPct).toBeCloseTo(1.0); // 100 lost of 10,000
  });

  it('is null when nothing has been received yet', () => {
    const s = summarizeStats(
      report(pair(), inbound({ packetsReceived: 0, packetsLost: 0 })), null, 1000, 0);
    expect(s.packetLossPct).toBeNull();
  });
});

/*
 * Shape reported by Chromium for a three-rung publish: one encoding sending, two active at
 * zero bytes with qualityLimitationReason "bandwidth".
 */
const layer = (rid, over = {}) => ({
  type: 'outbound-rtp', kind: 'video', id: `out-${rid}`, rid,
  bytesSent: 0, framesEncoded: 0, active: true,
  qualityLimitationReason: 'bandwidth', ...over,
});

const SENDING = layer('m', {
  bytesSent: 138_500, framesEncoded: 122, framesPerSecond: 20,
  frameWidth: 320, frameHeight: 240,
});

describe('simulcast layers', () => {
  it('reports every encoding, not just the first one found', () => {
    const s = summarizeStats(report(pair(), layer('h'), SENDING, layer('l')), null, 1000, 0);
    expect(s.outboundLayers.map((l) => l.rid).sort()).toEqual(['h', 'l', 'm']);
  });

  it('separates "asked for" from "actually sending", and says what stopped it', () => {
    const s = summarizeStats(report(pair(), layer('h'), SENDING, layer('l')), null, 1000, 0);
    const byRid = Object.fromEntries(s.outboundLayers.map((l) => [l.rid, l]));

    expect(byRid.m.sending).toBe(true);
    expect(byRid.m.frameWidth).toBe(320);
    expect(byRid.m.frameHeight).toBe(240);

    // Configured and active, but nothing came out of it.
    expect(byRid.h.active).toBe(true);
    expect(byRid.h.sending).toBe(false);
    expect(byRid.h.limitedBy).toBe('bandwidth');
  });

  it('computes each layer rate from its own previous sample', () => {
    const before = report(pair(), layer('h'), SENDING, layer('l'));
    const after = report(
      pair(),
      layer('h'),
      { ...SENDING, bytesSent: 138_500 + 25_000 },
      layer('l')
    );
    const s = summarizeStats(after, before, 2000, 1000);
    const m = s.outboundLayers.find((l) => l.rid === 'm');
    expect(m.kbps).toBeCloseTo(200);          // 25,000 bytes in 1s = 200 kbps
    expect(s.outboundTotalKbps).toBeCloseTo(200);
  });

  // The headline bitrate must agree with the layer table under it.
  it('reports the whole outbound rate, summed across every encoding', () => {
    const before = report(pair(), layer('h', { bytesSent: 0 }), SENDING, layer('l', { bytesSent: 0 }));
    const after = report(
      pair(),
      layer('h', { bytesSent: 50_000 }),
      { ...SENDING, bytesSent: 138_500 + 25_000 },
      layer('l', { bytesSent: 12_500 })
    );
    const s = summarizeStats(after, before, 2000, 1000);
    // 50,000 + 25,000 + 12,500 bytes in one second.
    expect(s.outboundKbps).toBeCloseTo(700);
    expect(s.outboundKbps).toBeCloseTo(s.outboundTotalKbps);
  });

  it('computes packet loss for a sender from what it sent and what RTCP reported lost', () => {
    const s = summarizeStats(
      report(
        pair(),
        { ...SENDING, packetsSent: 1000 },
        layer('h', { packetsSent: 0 }),
        { type: 'remote-inbound-rtp', kind: 'video', id: 'ri-m', packetsLost: 25 }
      ),
      null, 1000, 0
    );
    expect(s.packetsLost).toBe(25);
    expect(s.packetLossPct).toBeCloseTo(2.5);
  });

  it('still uses the receiver denominator when there is an inbound stream', () => {
    const s = summarizeStats(report(pair(), inbound()), null, 1000, 0);
    expect(s.packetLossPct).toBeCloseTo(1);   // 100 lost of 9900 received + 100 lost
  });

  it('stays empty for an ordinary publish, because one encoding is not a layer list', () => {
    const s = summarizeStats(
      report(pair(), { type: 'outbound-rtp', kind: 'video', bytesSent: 1000 }),
      null, 1000, 0
    );
    expect(s.outboundLayers).toEqual([]);
    expect(s.outboundTotalKbps).toBeNull();
  });
});
