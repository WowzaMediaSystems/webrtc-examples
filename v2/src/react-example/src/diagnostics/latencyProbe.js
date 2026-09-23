/*
 * The latency probe: how long a frame takes from the publisher's encoder to the player's
 * screen, and how much of that the Engine owns.
 *
 * Every encoded frame carries a sequence number and send time as an H.264 SEI NAL (see
 * utils/frameStamp.js), read on the receiver before decode and joined to the presented frame
 * by rtpTimestamp:
 *
 *   camera -> encode ->| SEI written |-> Engine -> depacketize |<- SEI read ->| decode -> display
 *                            t0                                      t1                     t2
 *
 *   t1 - t0   transport: packetize, network, Engine, jitter buffer, depacketize (the Engine figure)
 *   t2 - t1   player: decode, compositor, wait until scheduled for display
 *   t2 - t0   end to end, minus capture and encode
 *
 * Not included: sensor and ISP delay, the encoder queue, and panel emission. expectedDisplayTime
 * is a prediction, not an observation.
 *
 * Structure: everything above the "browser plumbing" line is pure and unit tested. Below it are
 * the two encoded-stream transforms, the video-frame callback and the clock data channel.
 *
 * Chromium only (createEncodedStreams). Without it the probe reports unavailable with a reason.
 */

import {
  MAX_RUNG,
  MAX_SEQUENCE,
  buildSeiPayload,
} from '../utils/frameStamp';
import {
  CLOCK_GRANULARITY_MS,
  MAX_TRUSTED_UNCERTAINTY_MS,
  MIN_SAMPLES,
  estimateOffset,
} from './clockSync';

// Its own channel, not chat: the exchange runs all session and must work with chat switched off.
export const CLOCK_CHANNEL_LABEL = 'wz-clock';

// The sequence space the stamp's 32-bit field can carry, used for wrap-safe gap counting.
const SEQUENCE_SPACE = MAX_SEQUENCE + 1;

/*
 * Frames the medians cover: 2 to 4 s at 30 to 60 fps. It must also outlast the join, since
 * requestVideoFrameCallback reports a frame only after it is decoded and scheduled.
 */
export const FRAME_WINDOW = 120;

// No stamped frame for this long means the stream stopped. Kept short so a stall shows as
// stale rather than as a frozen figure.
export const STALE_MS = 1000;

/* ------------------------------------------------------------------ pure logic ------------- */

/**
 * Whether to write the stamp into this sender's frames.
 *
 * SEI is H.264 only: prepended to a VP8, VP9 or AV1 frame it corrupts the frame, so an unknown
 * codec means do not stamp. `mimeType` is the negotiated codec. `wanted` is the page setting,
 * used only until negotiation, so a decision from it comes back unresolved.
 */
export const decideStamping = (mimeType, wanted) => {
  const isH264 = (value) => typeof value === 'string' && /h\.?264|avc/i.test(value);

  if (isH264(mimeType)) return { stamp: true, resolved: true, reason: null };
  if (typeof mimeType === 'string' && mimeType !== '') {
    return {
      stamp: false,
      resolved: true,
      reason: `The frame stamp is an H.264 SEI NAL and this sender negotiated ${mimeType}.`,
    };
  }
  if (isH264(wanted)) return { stamp: true, resolved: false, reason: null };
  return {
    stamp: false,
    resolved: false,
    reason: 'Waiting for the negotiated video codec before stamping.',
  };
};

/**
 * Frames lost between two received sequence numbers. Reordering and duplicates count as zero,
 * and the modulo keeps the count right across the 32-bit wrap.
 */
export const countMissedFrames = (previous, sequence) => {
  if (!Number.isInteger(previous) || !Number.isInteger(sequence)) return 0;
  const gap = (sequence - previous + SEQUENCE_SPACE) % SEQUENCE_SPACE;
  // More than half the space forward is a wrap seen backwards: reordering, not lost frames.
  if (gap === 0 || gap > SEQUENCE_SPACE / 2) return 0;
  return gap - 1;
};

/**
 * The next sequence number for one simulcast rung. `counters` is mutated.
 *
 * Per rung because the sender's stream carries every rung while the player receives one, so a
 * shared counter shows up as false missed frames. The caller keys on synchronizationSource:
 * Chromium reports rid undefined and spatialIndex 0 on every rung, so only the SSRC differs.
 */
export const nextSequenceFor = (counters, key) => {
  const value = counters.get(key) ?? 0;
  counters.set(key, (value + 1) % SEQUENCE_SPACE);
  return value;
};

/**
 * A one-byte index for a rung, in order of first appearance; this, not the SSRC, travels in the
 * stamp. `indices` is mutated. Clamped at MAX_RUNG so a key never exceeds what the stamp holds.
 */
export const rungIndexFor = (indices, key) => {
  const existing = indices.get(key);
  if (existing !== undefined) return existing;
  const next = Math.min(indices.size, MAX_RUNG);
  indices.set(key, next);
  return next;
};

/**
 * An encoded frame with the stamp prepended, as a fresh ArrayBuffer. The SEI is a NAL of its
 * own, so the existing bitstream is untouched and the decoder may ignore it.
 */
export const stampFrameBytes = (frameData, { sequence, sentAt, rung = 0 }) => {
  const sei = buildSeiPayload({ sequence, sentAt, rung });
  const frameBytes = new Uint8Array(frameData);
  const stamped = new Uint8Array(sei.length + frameBytes.length);
  stamped.set(sei, 0);
  stamped.set(frameBytes, sei.length);
  return stamped.buffer;
};

/**
 * The middle observed value, not the mean, because per-frame latency is long tailed. On an even
 * count it returns the lower middle, so every figure is one some frame actually had.
 */
export const median = (values) => {
  const usable = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};

/**
 * What the clock exchange currently supports. Zero never stands in for "unknown": state 'ok'
 * with offsetMs 0 is a measurement, state 'unknown' is a refusal.
 */
export const describeClock = (samples, { sameContext = false } = {}) => {
  const count = Array.isArray(samples) ? samples.length : 0;
  const estimate = estimateOffset(samples);

  if (estimate === null) {
    return {
      state: 'unknown',
      offsetMs: null,
      uncertaintyMs: null,
      samples: count,
      mode: null,
      exact: false,
      reason: count < MIN_SAMPLES
        ? `Exchanging clock samples (${count} of ${MIN_SAMPLES}).`
        : 'The clock offset is not stable enough to measure.',
    };
  }

  /*
   * A page that both stamps and reads has one clock, and the bound only describes the round trip
   * through the Engine, which can exceed the trusted limit. The offset must still be zero: if the
   * page plays somebody else's stream, the offset shows the different clock.
   */
  const oneClockByConstruction = sameContext
    && Math.abs(estimate.offsetMs) <= CLOCK_GRANULARITY_MS;

  if (estimate.uncertaintyMs > MAX_TRUSTED_UNCERTAINTY_MS && !oneClockByConstruction) {
    return {
      state: 'untrusted',
      offsetMs: estimate.offsetMs,
      uncertaintyMs: estimate.uncertaintyMs,
      samples: estimate.samples,
      mode: null,
      exact: false,
      reason: `Clock offset too uncertain to measure (± ${Math.round(estimate.uncertaintyMs)} ms).`,
    };
  }

  /*
   * Processes on one machine share the OS clock, so offset and bound collapse to its resolution
   * and "exact" reads better than "0 ms plus or minus 0 ms". Only 'same-context' is a verified
   * topology; a near-zero offset alone is 'same-clock', with no claim about where the far end runs.
   */
  const sameClock = oneClockByConstruction
    || (Math.abs(estimate.offsetMs) <= CLOCK_GRANULARITY_MS
      && estimate.uncertaintyMs <= CLOCK_GRANULARITY_MS);
  const mode = oneClockByConstruction
    ? 'same-context'
    : (sameClock ? 'same-clock' : 'cross-machine');

  return {
    state: 'ok',
    offsetMs: estimate.offsetMs,
    uncertaintyMs: estimate.uncertaintyMs,
    samples: estimate.samples,
    mode,
    exact: sameClock,
    reason: null,
  };
};

/**
 * The three figures for one received frame, or nulls where a figure cannot be had.
 *
 * `sentAt` is on the publisher's clock, so transport needs the offset (farTime - offsetMs is
 * local). The player leg subtracts two local monotonic readings and is reported without one. A
 * negative transport figure is returned as measured: it is the evidence of a wrong clock estimate.
 */
export const frameLatency = (record, offsetMs) => {
  const transportMs = typeof offsetMs === 'number'
    ? record.arrivedAt - (record.sentAt - offsetMs)
    : null;
  const playerMs = typeof record.displayAtHighRes === 'number'
    ? record.displayAtHighRes - record.arrivedAtHighRes
    : null;
  return {
    transportMs,
    playerMs,
    totalMs: transportMs === null || playerMs === null ? null : transportMs + playerMs,
  };
};

/**
 * Turns the probe's state into the object the UI subscribes to. Pure, with `now` a parameter.
 *
 *   off        nothing is running on this page
 *   waiting    the receiver is attached but no video frame has arrived yet
 *   no-stamp   frames are arriving and none carry a stamp
 *   stalled    stamped frames arrived and then stopped
 *   measuring  there is a figure
 */
export const summarizeProbe = (state, now) => {
  // Same-page stamping is the only provable one-clock case, so it is passed in, not inferred.
  const clock = describeClock(state.clockSamples, {
    sameContext: state.senderStatus === 'stamping',
  });
  const base = {
    transportMs: null,
    playerMs: null,
    totalMs: null,
    missedFrames: state.missedFrames,
    lastSequence: state.lastSequence,
    stampedFrames: state.stampedFrames,
    unstampedFrames: state.unstampedFrames,
    joinedFrames: state.joinedFrames,
    lastFrameAt: state.lastFrameAt,
    frameWindow: state.frames.length,
    clock,
    sender: {
      status: state.senderStatus,
      reason: state.senderReason,
      stampedFrames: state.stampedOut,
    },
  };

  if (state.receiverStatus === 'off') {
    return { ...base, status: 'off', reason: state.receiverReason };
  }
  if (state.stampedFrames === 0 && state.unstampedFrames === 0) {
    return { ...base, status: 'waiting', reason: 'No video frames received yet.' };
  }
  if (state.stampedFrames === 0) {
    return {
      ...base,
      status: 'no-stamp',
      // Name all three causes, or a transcoding application reads as a broken feature.
      reason: 'No frame stamp in this stream. The publisher has the probe off, the application '
        + 'is transcoding, or the codec is not H.264.',
    };
  }
  if (now - state.lastFrameAt > STALE_MS) {
    return {
      ...base,
      status: 'stalled',
      reason: `No stamped frame for ${Math.round((now - state.lastFrameAt) / 100) / 10} s.`,
    };
  }

  const offsetMs = clock.state === 'ok' ? clock.offsetMs : null;
  const perFrame = state.frames.map((record) => frameLatency(record, offsetMs));

  return {
    ...base,
    status: 'measuring',
    // A trusted clock is what the transport leg needs; the player leg never needed one.
    reason: clock.state === 'ok' ? null : clock.reason,
    transportMs: median(perFrame.map((frame) => frame.transportMs)),
    playerMs: median(perFrame.map((frame) => frame.playerMs)),
    totalMs: median(perFrame.map((frame) => frame.totalMs)),
  };
};

/* --------------------------------------------------------------- clock protocol ------------- */

// Tagged, because the label is no guarantee. Anything on the channel that is not ours is ignored.
const CLOCK_MESSAGE_TAG = 'wz-clock';
const CLOCK_MESSAGE_VERSION = 1;

/*
 * Who asked. The Engine mirrors the publisher's replies to every viewer, and sequences start at
 * zero on each player, so without an id two viewers take each other's replies and estimate the
 * offset from another machine's clock. Random, because no counter is shared between ends.
 */
export const newClockSessionId = () => Math.floor(Math.random() * 0xffffffff);

export const buildClockPing = ({ sequence, t0, id }) =>
  JSON.stringify({ wz: CLOCK_MESSAGE_TAG, v: CLOCK_MESSAGE_VERSION, seq: sequence, t0, id });

export const buildClockReply = ({ ping, t1, t2 }) =>
  JSON.stringify({
    wz: CLOCK_MESSAGE_TAG, v: CLOCK_MESSAGE_VERSION,
    seq: ping.sequence, t0: ping.t0, id: ping.id, t1, t2,
  });

/**
 * Reads one clock message, or returns null for anything that is not one. `kind` separates ping
 * from reply, so a page running both arms (the split view) never answers its own reply.
 */
export const parseClockMessage = (data) => {
  if (typeof data !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!parsed || parsed.wz !== CLOCK_MESSAGE_TAG || parsed.v !== CLOCK_MESSAGE_VERSION) return null;

  const numeric = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const sequence = numeric(parsed.seq);
  const t0 = numeric(parsed.t0);
  if (sequence === null || t0 === null) return null;

  // Null for a message without an id, which every check treats as "not mine".
  const id = numeric(parsed.id);

  const t1 = numeric(parsed.t1);
  const t2 = numeric(parsed.t2);
  if (t1 === null || t2 === null) return { kind: 'ping', sequence, t0, id };
  return { kind: 'reply', sequence, t0, t1, t2, id };
};

/* ------------------------------------------------------- availability and the store --------- */

/**
 * Why the probe cannot run here, or null when it can. Checked at call time, not import, so the
 * module still loads in a test environment with no RTCRtpSender.
 */
export const probeUnavailableReason = () => {
  const has = (constructor) => typeof constructor === 'function'
    && typeof constructor.prototype?.createEncodedStreams === 'function';

  if (typeof window === 'undefined') return 'The latency probe needs a browser.';
  if (!has(window.RTCRtpSender) || !has(window.RTCRtpReceiver)) {
    return 'Needs insertable streams (createEncodedStreams), which today means a Chromium '
      + 'browser: Chrome, Edge or Brave. This build does not use the RTCRtpScriptTransform '
      + 'route that other browsers offer.';
  }
  return null;
};

export const isProbeAvailable = () => probeUnavailableReason() === null;

/**
 * The same answer, shaped for the settings toggle and the readout. Kept here rather than in
 * LatencyGroup.jsx so that file exports only components and Fast Refresh keeps working.
 */
export const latencyProbeSupport = () => {
  const reason = probeUnavailableReason();
  return { supported: reason === null, reason };
};

/**
 * Adds the peer-connection flag the transforms need. encodedInsertableStreams can only be set
 * when the RTCPeerConnection is constructed, so the two start paths call this beforehand.
 * Returns whether the flag was set.
 */
export const configureEncodedStreams = (config, enabled) => {
  if (!config || !enabled || !isProbeAvailable()) return false;
  config.encodedInsertableStreams = true;
  return true;
};
