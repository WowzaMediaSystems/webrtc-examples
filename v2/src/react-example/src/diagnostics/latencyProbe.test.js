import { describe, expect, it } from 'vitest';

import { MAX_SEQUENCE, findSeiPayload } from '../utils/frameStamp';
import { MAX_TRUSTED_UNCERTAINTY_MS, MIN_SAMPLES } from './clockSync';
import {
  CLOCK_CHANNEL_LABEL,
  STALE_MS,
  buildClockPing,
  newClockSessionId,
  buildClockReply,
  configureEncodedStreams,
  countMissedFrames,
  decideStamping,
  describeClock,
  frameLatency,
  getSample,
  isProbeAvailable,
  median,
  nextSequenceFor,
  parseClockMessage,
  probeUnavailableReason,
  resetProbe,
  stampFrameBytes,
  subscribe,
  summarizeProbe,
} from './latencyProbe';

// The state shape summarizeProbe reads, spelled out because createState is private.
const stateWith = (overrides = {}) => ({
  senderStatus: 'off',
  senderReason: null,
  stampedOut: 0,
  receiverStatus: 'reading',
  receiverReason: null,
  frames: [],
  byRtpTimestamp: new Map(),
  stampedFrames: 0,
  unstampedFrames: 0,
  missedFrames: 0,
  lastSequence: null,
  lastFrameAt: null,
  joinedFrames: 0,
  clockSamples: [],
  ...overrides,
});

/* One received frame, with both legs measurable unless a field is nulled out. */
const record = ({
  sequence = 1, sentAt = 1_000_000, transportMs = 100, playerMs = 20, rtpTimestamp = 90_000,
} = {}) => ({
  sequence,
  sentAt,
  arrivedAt: sentAt + transportMs,
  arrivedAtHighRes: 5_000,
  rtpTimestamp,
  displayAtHighRes: playerMs === null ? null : 5_000 + playerMs,
});

// A round trip to a far end offsetMs ahead, replying instantly so the round trip is exactly
// rttMs. Same construction as clockSync.test.js, so the two agree on what a sample is.
const roundTrip = ({ offsetMs = 0, rttMs = 20, t0 = 1_000_000 } = {}) => {
  const t1 = t0 + rttMs / 2 + offsetMs;
  return { t0, t1, t2: t1, t3: t0 + rttMs };
};

const repeat = (count, make) => Array.from({ length: count }, (_unused, index) => make(index));

describe('decideStamping', () => {
  it('stamps an H.264 sender, however the mime type is spelled', () => {
    for (const mimeType of ['video/H264', 'video/h264', 'video/AVC1']) {
      expect(decideStamping(mimeType, null)).toEqual({ stamp: true, resolved: true, reason: null });
    }
  });

  // An SEI NAL corrupts a VP8 frame, so a non-H.264 codec must be a refusal.
  it('refuses a codec that has no SEI, and says which one it saw', () => {
    const decision = decideStamping('video/VP8', 'H264');
    expect(decision.stamp).toBe(false);
    expect(decision.resolved).toBe(true);
    expect(decision.reason).toContain('video/VP8');
  });

  it('treats the page setting as provisional, so the decision is taken again', () => {
    expect(decideStamping(null, 'H264')).toEqual({ stamp: true, resolved: false, reason: null });
  });

  it('does not stamp when nothing has said H.264 yet', () => {
    const decision = decideStamping(null, undefined);
    expect(decision.stamp).toBe(false);
    expect(decision.resolved).toBe(false);
    expect(decision.reason).toContain('negotiated video codec');
  });
});

describe('countMissedFrames', () => {
  it('counts nothing between consecutive frames', () => {
    expect(countMissedFrames(41, 42)).toBe(0);
  });

  it('counts the frames a gap skipped', () => {
    expect(countMissedFrames(10, 14)).toBe(3);
  });

  it('counts nothing for a repeat or a reordered pair', () => {
    expect(countMissedFrames(42, 42)).toBe(0);
    expect(countMissedFrames(42, 40)).toBe(0);
  });

  it('counts across the 32-bit wrap instead of inventing four billion losses', () => {
    expect(countMissedFrames(MAX_SEQUENCE, 0)).toBe(0);
    // MAX_SEQUENCE and 0 are the two frames between these, so two were missed.
    expect(countMissedFrames(MAX_SEQUENCE - 1, 1)).toBe(2);
  });

  it('counts nothing when either side is not a sequence number', () => {
    expect(countMissedFrames(null, 5)).toBe(0);
    expect(countMissedFrames(5, undefined)).toBe(0);
  });
});

describe('stampFrameBytes', () => {
  // Sender and receiver halves meeting over the real frameStamp codec, frame intact behind it.
  it('writes a stamp the receiver half reads back, ahead of the frame it was given', () => {
    // An IDR slice with a payload that contains 00 00 01, which is the emulation-prevention trap.
    const frame = Uint8Array.from([
      0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x00, 0x00, 0x01, 0x42, 0xff,
    ]);
    const stamp = { sequence: 77, sentAt: 1_726_600_000_123, rung: 1 };
    const stamped = stampFrameBytes(frame.buffer, stamp);

    expect(findSeiPayload(stamped)).toEqual(stamp);

    const bytes = new Uint8Array(stamped);
    expect(bytes.slice(bytes.length - frame.length)).toEqual(frame);
    expect(bytes.length).toBeGreaterThan(frame.length);
  });

  it('leaves the frame it was handed alone, so a pass-through frame is never corrupted', () => {
    const frame = Uint8Array.from([0x00, 0x00, 0x00, 0x01, 0x41, 0x9a]);
    const before = Uint8Array.from(frame);
    stampFrameBytes(frame.buffer, { sequence: 1, sentAt: 2 });
    expect(frame).toEqual(before);
  });
});

describe('nextSequenceFor', () => {
  it('counts each simulcast rung on its own, so one rung arrives contiguous', () => {
    const counters = new Map();
    expect(nextSequenceFor(counters, 'h')).toBe(0);
    expect(nextSequenceFor(counters, 'l')).toBe(0);
    expect(nextSequenceFor(counters, 'h')).toBe(1);
    expect(nextSequenceFor(counters, 'h')).toBe(2);
    expect(nextSequenceFor(counters, 'l')).toBe(1);

    // What the player subscribed to one rung actually sees: no gaps.
    expect(countMissedFrames(1, 2)).toBe(0);
  });

  it('wraps at the width of the field the stamp carries', () => {
    const counters = new Map([['single', MAX_SEQUENCE]]);
    expect(nextSequenceFor(counters, 'single')).toBe(MAX_SEQUENCE);
    expect(nextSequenceFor(counters, 'single')).toBe(0);
  });
});

describe('median', () => {
  it('returns a value that was actually observed', () => {
    expect(median([10, 20, 30, 40])).toBe(20);
    expect(median([30, 10, 20])).toBe(20);
  });

  it('ignores the frames that had no figure rather than counting them as zero', () => {
    expect(median([null, 100, null, 102, 104])).toBe(102);
  });

  it('returns null when there is nothing to report', () => {
    expect(median([])).toBe(null);
    expect(median([null, undefined, Number.NaN])).toBe(null);
  });
});

describe('describeClock', () => {
  it('reports how far it is from having an answer while the window fills', () => {
    const clock = describeClock(repeat(3, () => roundTrip({ rttMs: 10 })));
    expect(clock.state).toBe('unknown');
    expect(clock.offsetMs).toBe(null);
    expect(clock.reason).toBe(`Exchanging clock samples (3 of ${MIN_SAMPLES}).`);
  });

  it('calls an offset of zero on a tight path exact rather than estimated', () => {
    const clock = describeClock(repeat(10, () => roundTrip({ rttMs: 1, offsetMs: 0 })));
    expect(clock.state).toBe('ok');
    expect(clock.exact).toBe(true);
    expect(clock.mode).toBe('same-clock');
    expect(clock.offsetMs).toBe(0);
    expect(clock.uncertaintyMs).toBe(0.5);
  });

  // One clock is provable only when this page is also stamping; a near-zero offset is not proof.
  it('names one browser only when this page is also the publisher', () => {
    const samples = repeat(10, () => roundTrip({ rttMs: 1, offsetMs: 0 }));
    expect(describeClock(samples, { sameContext: true }).mode).toBe('same-context');
    expect(describeClock(samples, { sameContext: false }).mode).toBe('same-clock');
  });

  it('reports a real offset as estimated across machines, with its bound', () => {
    const clock = describeClock(repeat(10, (i) => roundTrip({ rttMs: 20 + i, offsetMs: 4_000 })));
    expect(clock.state).toBe('ok');
    expect(clock.exact).toBe(false);
    expect(clock.mode).toBe('cross-machine');
    expect(clock.offsetMs).toBe(4_000);
    expect(clock.uncertaintyMs).toBe(10);
  });

  it('never claims one clock while it is refusing to measure', () => {
    const scattered = repeat(10, (i) => roundTrip({ rttMs: 4, offsetMs: i % 2 === 0 ? 0 : 900 }));
    expect(describeClock(scattered, { sameContext: true }).exact).toBe(false);
    expect(describeClock(scattered, { sameContext: true }).mode).toBe(null);
  });

  // Above the threshold there is no number at all: a confidently wrong latency is the failure.
  it('refuses an offset whose bound is wider than the display policy allows', () => {
    const rttMs = (MAX_TRUSTED_UNCERTAINTY_MS + 5) * 2;
    const clock = describeClock(repeat(10, () => roundTrip({ rttMs, offsetMs: 500 })));
    expect(clock.state).toBe('untrusted');
    expect(clock.reason).toContain('too uncertain');
  });

  it('refuses when the samples disagree, and says so differently from a short window', () => {
    const scattered = repeat(10, (i) => roundTrip({ rttMs: 4, offsetMs: i % 2 === 0 ? 0 : 900 }));
    const clock = describeClock(scattered);
    expect(clock.state).toBe('unknown');
    expect(clock.reason).toContain('not stable enough');
  });
});

describe('frameLatency', () => {
  it('converts the publisher clock to ours before subtracting', () => {
    // The publisher's clock reads 4,000 ms ahead, so its 1,004,000 is our 1,000,000.
    const frame = frameLatency(
      {
        sentAt: 1_004_000, arrivedAt: 1_000_100, arrivedAtHighRes: 500, displayAtHighRes: 520,
      },
      4_000,
    );
    expect(frame.transportMs).toBe(100);
    expect(frame.playerMs).toBe(20);
    expect(frame.totalMs).toBe(120);
  });

  it('withholds the transport leg when the offset is unknown, and keeps the local one', () => {
    const frame = frameLatency(record({ transportMs: 100, playerMs: 20 }), null);
    expect(frame.transportMs).toBe(null);
    expect(frame.totalMs).toBe(null);
    expect(frame.playerMs).toBe(20);
  });

  it('withholds the player leg for a frame that has not been presented yet', () => {
    const frame = frameLatency(record({ playerMs: null }), 0);
    expect(frame.transportMs).toBe(100);
    expect(frame.playerMs).toBe(null);
    expect(frame.totalMs).toBe(null);
  });
});

describe('summarizeProbe', () => {
  const exactClock = repeat(10, () => roundTrip({ rttMs: 1, offsetMs: 0 }));

  it('is off when no receiver is attached', () => {
    const sample = summarizeProbe(stateWith({ receiverStatus: 'off' }), 1_000);
    expect(sample.status).toBe('off');
    expect(sample.transportMs).toBe(null);
  });

  it('says it is waiting before any frame arrives', () => {
    expect(summarizeProbe(stateWith(), 1_000).status).toBe('waiting');
  });

  // The case an operator hits most often, and it must never look like a bug.
  it('names every cause when frames arrive with no stamp', () => {
    const sample = summarizeProbe(stateWith({ unstampedFrames: 90 }), 1_000);
    expect(sample.status).toBe('no-stamp');
    expect(sample.reason).toContain('probe off');
    expect(sample.reason).toContain('transcoding');
    expect(sample.reason).toContain('H.264');
    expect(sample.totalMs).toBe(null);
  });

  it('goes stale rather than reporting a figure from a stream that stopped', () => {
    const state = stateWith({
      stampedFrames: 5,
      lastFrameAt: 10_000,
      frames: [record()],
      clockSamples: exactClock,
    });
    const sample = summarizeProbe(state, 10_000 + STALE_MS + 1);
    expect(sample.status).toBe('stalled');
    expect(sample.transportMs).toBe(null);
    expect(sample.reason).toContain('No stamped frame for');
  });

  it('reports the median of the window, not the last frame or the mean', () => {
    const frames = [80, 100, 120, 1_400].map((transportMs, index) => record({
      sequence: index, transportMs, playerMs: 20, rtpTimestamp: 90_000 + index,
    }));
    const state = stateWith({
      stampedFrames: frames.length, lastFrameAt: 1_000, frames, clockSamples: exactClock,
    });
    const sample = summarizeProbe(state, 1_000);

    expect(sample.status).toBe('measuring');
    expect(sample.transportMs).toBe(100);
    expect(sample.playerMs).toBe(20);
    expect(sample.totalMs).toBe(120);
    expect(sample.clock.exact).toBe(true);
    expect(sample.reason).toBe(null);
  });

  it('still reports the player leg when the clock offset cannot be measured', () => {
    const state = stateWith({
      stampedFrames: 1,
      lastFrameAt: 1_000,
      frames: [record({ playerMs: 25 })],
      clockSamples: [],
    });
    const sample = summarizeProbe(state, 1_000);

    expect(sample.status).toBe('measuring');
    expect(sample.playerMs).toBe(25);
    expect(sample.transportMs).toBe(null);
    expect(sample.totalMs).toBe(null);
    // The reason the transport row is empty travels with the sample, not in a console log.
    expect(sample.reason).toContain('Exchanging clock samples');
  });

  it('carries the missed-frame count and the sender state through every status', () => {
    const state = stateWith({
      missedFrames: 7,
      lastSequence: 412,
      senderStatus: 'stamping',
      stampedOut: 900,
      unstampedFrames: 3,
    });
    const sample = summarizeProbe(state, 1_000);
    expect(sample.missedFrames).toBe(7);
    expect(sample.lastSequence).toBe(412);
    expect(sample.sender).toEqual({ status: 'stamping', reason: null, stampedFrames: 900 });
  });
});

describe('the clock messages', () => {
  it('round trips a ping and its reply', () => {
    const ping = parseClockMessage(buildClockPing({ sequence: 4, t0: 1_700_000_000_123, id: 77 }));
    expect(ping).toEqual({ kind: 'ping', sequence: 4, t0: 1_700_000_000_123, id: 77 });

    const reply = parseClockMessage(buildClockReply({ ping, t1: 50, t2: 51 }));
    expect(reply).toEqual({
      kind: 'reply', sequence: 4, t0: 1_700_000_000_123, t1: 50, t2: 51, id: 77,
    });
  });

  // Replies are mirrored to every viewer and sequences start at zero on each, so only the id
  // stops two viewers taking each other's replies.
  it('carries the asker through the reply, so viewers do not take each other for themselves', () => {
    const mine = parseClockMessage(buildClockPing({ sequence: 1, t0: 10, id: 111 }));
    const theirs = parseClockMessage(buildClockPing({ sequence: 1, t0: 10, id: 222 }));

    expect(parseClockMessage(buildClockReply({ ping: mine, t1: 11, t2: 12 })).id).toBe(111);
    expect(parseClockMessage(buildClockReply({ ping: theirs, t1: 11, t2: 12 })).id).toBe(222);
  });

  it('gives every initiator a different id', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newClockSessionId()));
    expect(ids.size).toBeGreaterThan(190);
  });

  // A message from a build without the id reads as id null, which is nobody's.
  it('reports no id rather than inventing one', () => {
    const older = JSON.stringify({ wz: 'wz-clock', v: 1, seq: 2, t0: 5 });
    expect(parseClockMessage(older).id).toBeNull();
  });

  // The split view runs both arms on one channel, so answering replies would answer itself.
  it('tells a reply from a ping so the responder never answers itself', () => {
    const reply = buildClockReply({ ping: { sequence: 1, t0: 10, id: 1 }, t1: 11, t2: 12 });
    expect(parseClockMessage(reply).kind).toBe('reply');
  });

  it('ignores anything that is not ours', () => {
    expect(parseClockMessage('hello')).toBe(null);
    expect(parseClockMessage('{"wz":"other","v":1,"seq":1,"t0":1}')).toBe(null);
    expect(parseClockMessage('{"wz":"wz-clock","v":99,"seq":1,"t0":1}')).toBe(null);
    expect(parseClockMessage('{"wz":"wz-clock","v":1,"seq":1}')).toBe(null);
    expect(parseClockMessage('{"wz":"wz-clock","v":1,"seq":"one","t0":1}')).toBe(null);
    expect(parseClockMessage(new ArrayBuffer(8))).toBe(null);
    expect(parseClockMessage(null)).toBe(null);
  });

  it('keeps the channel label in one place', () => {
    expect(CLOCK_CHANNEL_LABEL).toBe('wz-clock');
  });
});

describe('availability', () => {
  // jsdom has no RTCRtpSender, the same answer a non-Chromium browser gives.
  it('refuses with a reason where insertable streams do not exist', () => {
    expect(isProbeAvailable()).toBe(false);
    expect(probeUnavailableReason()).toContain('insertable streams');
  });

  it('does not put the flag on a peer-connection config it cannot honor', () => {
    const config = { iceServers: [] };
    expect(configureEncodedStreams(config, true)).toBe(false);
    expect(config.encodedInsertableStreams).toBe(undefined);
  });

  it('leaves the config alone when the probe is off', () => {
    const config = { iceServers: [] };
    expect(configureEncodedStreams(config, false)).toBe(false);
    expect(config).toEqual({ iceServers: [] });
  });
});

describe('the subscription', () => {
  // Null, not a sample of nulls, so "never measured" cannot be mistaken for a latency.
  it('publishes null while nothing has been measured', () => {
    resetProbe();
    let seen = 'untouched';
    const unsubscribe = subscribe((next) => { seen = next; });
    expect(seen).toBe(null);
    unsubscribe();
  });

  it('still describes why there is no figure, for a caller that asks', () => {
    resetProbe();
    const current = getSample();
    expect(current.status).toBe('off');
    expect(current.transportMs).toBe(null);
    expect(current.clock.exact).toBe(false);
  });

  it('stops delivering once unsubscribed', () => {
    let count = 0;
    const unsubscribe = subscribe(() => { count += 1; });
    expect(count).toBe(1);
    unsubscribe();
    resetProbe();
    expect(count).toBe(1);
  });
});

/*
 * The combined page stamps and reads with one Date.now, but its clock samples still round-trip
 * through the Engine, which can push the bound past trusted and hide every figure.
 */
describe('one page that both stamps and reads', () => {
  // A wide bound around an offset of zero: the samples agree, the path is just slow.
  const slowButZero = repeat(10, () =>
    roundTrip({ rttMs: MAX_TRUSTED_UNCERTAINTY_MS * 3, offsetMs: 0 }));

  it('is refused when nothing says the two ends share a context', () => {
    const clock = describeClock(slowButZero);
    expect(clock.state).toBe('untrusted');
    expect(clock.exact).toBe(false);
  });

  it('is exact when the reader is also the stamper', () => {
    const clock = describeClock(slowButZero, { sameContext: true });
    expect(clock.state).toBe('ok');
    expect(clock.exact).toBe(true);
    expect(clock.mode).toBe('same-context');
  });

  // A combined page playing another machine's stream carries that machine's clock.
  it('is still refused when the measured offset says another clock', () => {
    const elsewhere = repeat(10, () =>
      roundTrip({ rttMs: MAX_TRUSTED_UNCERTAINTY_MS * 3, offsetMs: 400 }));
    const clock = describeClock(elsewhere, { sameContext: true });
    expect(clock.state).toBe('untrusted');
    expect(clock.exact).toBe(false);
  });
});
