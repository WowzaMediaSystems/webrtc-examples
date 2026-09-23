import { describe, expect, it, vi } from 'vitest';

import { createStatsWatcher, diffSamples } from './statsWatcher';

const sample = (over = {}) => ({
  rttMs: 20, jitterBufferMs: 30, estimatedLatencyMs: 40,
  packetLossPct: 0, inboundKbps: null, outboundKbps: 1000,
  frameWidth: 1280, frameHeight: 720, codec: 'H264',
  qualityLimitation: null, isReceiving: false, availableOutgoingKbps: 2500,
  outboundLayers: [], ...over,
});

const labels = (before, after) => diffSamples(before, after).map((e) => e.label);

describe('diffSamples', () => {
  it('says nothing about a steady connection', () => {
    expect(diffSamples(sample(), sample())).toEqual([]);
  });

  it('says nothing without a baseline to compare against', () => {
    expect(diffSamples(null, sample())).toEqual([]);
  });

  it('names the old and the new latency, not just that it is high', () => {
    const [event] = diffSamples(sample(), sample({ estimatedLatencyMs: 610, rttMs: 300 }));
    expect(event.label).toContain('40 ms');
    expect(event.label).toContain('610 ms');
    expect(event.level).toBe('error');
    expect(event.detail.roundTripMs).toEqual({ from: 20, to: 300 });
  });

  it('stays quiet about a wobble', () => {
    expect(labels(sample(), sample({ estimatedLatencyMs: 50 }))).toEqual([]);
  });

  // 40 ms to 146 ms never leaves the "good" band.
  it('reports a climb that never crosses a band', () => {
    const [event] = diffSamples(sample(), sample({ estimatedLatencyMs: 146 }));
    expect(event.label).toBe('latency 40 ms → 146 ms');
  });

  it('reports packet loss appearing and clearing', () => {
    expect(labels(sample(), sample({ packetLossPct: 3 }))[0]).toMatch(/packet loss good → poor/);
    expect(labels(sample({ packetLossPct: 3 }), sample())[0]).toMatch(/packet loss poor → good/);
  });

  it('reports a bitrate collapse, with the bandwidth estimate beside it', () => {
    const [event] = diffSamples(sample(), sample({ outboundKbps: 200, availableOutgoingKbps: 250 }));
    expect(event.label).toMatch(/bitrate 1000 kbps → 200 kbps/);
    expect(event.detail.availableOutgoingKbps).toBe(250);
    expect(event.level).toBe('error');
  });

  it('ignores a bitrate change too small to mean anything', () => {
    expect(labels(sample(), sample({ outboundKbps: 990 }))).toEqual([]);
  });

  it('reports the encoder starting and stopping being limited', () => {
    expect(labels(sample(), sample({ qualityLimitation: 'bandwidth' }))[0])
      .toBe('encoder limited by bandwidth');
    expect(labels(sample({ qualityLimitation: 'cpu' }), sample())[0])
      .toBe('encoder no longer limited (was cpu)');
  });

  it('reports a change of frame size and of codec', () => {
    expect(labels(sample(), sample({ frameWidth: 640, frameHeight: 360 }))[0])
      .toBe('frame size 1280×720 → 640×360');
    expect(labels(sample(), sample({ codec: 'VP8' }))[0]).toBe('codec H264 → VP8');
  });

  it('reports a simulcast rung stopping, and why', () => {
    const on = sample({ outboundLayers: [{ rid: 'h', sending: true }] });
    const off = sample({ outboundLayers: [{ rid: 'h', sending: false, limitedBy: 'bandwidth' }] });
    expect(labels(on, off)[0]).toBe('simulcast rung "h" stopped sending (bandwidth)');
    expect(labels(off, on)[0]).toBe('simulcast rung "h" started sending');
  });
});

describe('createStatsWatcher', () => {
  it('logs transitions against the previous sample, prefixed with the role', () => {
    const log = vi.fn();
    const watch = createStatsWatcher('publish', log);

    watch(sample());                                  // first sample: nothing to compare
    expect(log).not.toHaveBeenCalled();

    watch(sample({ estimatedLatencyMs: 610 }));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe('error');
    expect(log.mock.calls[0][1]).toBe('pc');
    expect(log.mock.calls[0][2]).toMatch(/^publish latency/);
  });

  it('catches a climb that happens too slowly to show between two samples', () => {
    const log = vi.fn();
    const watch = createStatsWatcher('play', log);

    // 40 ms rising to 150 ms in 20 ms steps: no single step is worth a line.
    for (let value = 40; value <= 150; value += 20) watch(sample({ estimatedLatencyMs: value }));

    const said = log.mock.calls.filter((c) => /latency/.test(c[2]));
    expect(said.length).toBeGreaterThan(0);
    expect(said[0][2]).toMatch(/40 ms → \d+ ms/);
  });

  it('does not repeat itself while a figure sits still at its new level', () => {
    const log = vi.fn();
    const watch = createStatsWatcher('play', log);

    watch(sample());
    watch(sample({ estimatedLatencyMs: 146 }));
    const after = log.mock.calls.length;
    for (let i = 0; i < 10; i += 1) watch(sample({ estimatedLatencyMs: 146 }));
    expect(log.mock.calls.length).toBe(after);
  });

  it('drops its baseline when the connection goes away', () => {
    const log = vi.fn();
    const watch = createStatsWatcher('play', log);

    watch(sample());
    watch(null);
    watch(sample({ estimatedLatencyMs: 610 }));       // a new session, not a spike
    expect(log).not.toHaveBeenCalled();
  });
});
