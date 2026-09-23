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
  findSeiPayload,
} from '../utils/frameStamp';
import attachDataChannel from '../webrtc/attachDataChannel';
import {
  CLOCK_GRANULARITY_MS,
  MAX_TRUSTED_UNCERTAINTY_MS,
  MIN_SAMPLES,
  WINDOW_SAMPLES,
  estimateOffset,
} from './clockSync';
import { logEvent } from './signalLog';

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

const createState = () => ({
  senderStatus: 'off', // off | stamping | refused
  senderReason: null,
  stampedOut: 0,
  receiverStatus: 'off', // off | reading
  receiverReason: null,
  receiver: null, // the RTCRtpReceiver already attached, so a repeat attach is recognized

  frames: [],
  byRtpTimestamp: new Map(),
  stampedFrames: 0,
  unstampedFrames: 0,
  missedFrames: 0,
  lastSequence: null,
  lastRung: null,
  lastFrameAt: null,
  joinedFrames: 0,
  clockSamples: [],
});

let state = createState();
let sample = summarizeProbe(state, Date.now());
const listeners = new Set();
let emitTimer = null;

// Emitted on a timer, not per frame, so a 60 fps stream does not mean 60 React renders a second.
const EMIT_INTERVAL_MS = 500;

/*
 * Nothing measured yet publishes null, not a sample of nulls, so a subscriber can tell silence
 * from a figure. A sample is published only when a stamped frame arrived since the last one;
 * repeating it would hide a stall, because the panel judges staleness by the sample's age.
 */
let lastPublishedFrames = -1;

const emit = ({ force = false } = {}) => {
  sample = summarizeProbe(state, Date.now());

  if (state.stampedFrames === 0) {
    if (force) for (const fn of listeners) fn(null);
    return;
  }
  if (!force && state.stampedFrames === lastPublishedFrames) return;

  lastPublishedFrames = state.stampedFrames;
  for (const fn of listeners) fn(sample);
};

const startEmitting = () => {
  if (emitTimer !== null) return;
  emitTimer = setInterval(emit, EMIT_INTERVAL_MS);
  emit({ force: true });
};

const stopEmitting = () => {
  if (emitTimer === null) return;
  clearInterval(emitTimer);
  emitTimer = null;
  emit({ force: true });
};

/**
 * Pub/sub as signalLog does it: the current value at once, and an unsubscribe back. The value
 * is null until a stamped frame has been read.
 */
export const subscribe = (fn) => {
  listeners.add(fn);
  fn(state.stampedFrames === 0 ? null : sample);
  return () => listeners.delete(fn);
};

/** The full state, never null, for a caller that wants the status and reason behind no figure. */
export const getSample = () => sample;

/*
 * Clears what was measured, and nothing else. Called when a receiver starts, so figures stay on
 * screen after a stop but never leak into a new session. Sender state is left alone: on the
 * split view the publisher is already stamping when the player starts.
 */
const resetMeasurements = () => {
  state.frames = [];
  state.byRtpTimestamp = new Map();
  state.stampedFrames = 0;
  state.unstampedFrames = 0;
  state.missedFrames = 0;
  state.lastSequence = null;
  state.lastRung = null;
  state.lastFrameAt = null;
  state.joinedFrames = 0;
  state.clockSamples = [];
  lastPublishedFrames = -1;
};

/** Back to nothing running and nothing measured. */
export const resetProbe = () => {
  state = createState();
  lastPublishedFrames = -1;
  emit({ force: true });
};

/* ---------------------------------------------------------------- browser plumbing ---------- */

/*
 * createEncodedStreams can be called once per sender or receiver and has no detach, so a
 * transform lives as long as the peer connection and stop() turns it into a pass-through. The
 * UI toggle therefore takes effect on the next connect.
 */

/** Said once per stream, because a broken transform would otherwise say it 60 times a second. */
const reportTransformFailure = (label, error, once) => {
  if (once.reported) return;
  once.reported = true;
  logEvent('error', 'pc', `latency probe ${label} failed; frames pass through untouched`,
    error?.message ?? String(error));
};

/*
 * Pipes the encoded stream through the transform, or reports why it could not. It runs inside
 * the publish and play paths and createEncodedStreams throws if already called or if the
 * connection lacks encodedInsertableStreams, so nothing may escape: a diagnostic must not break
 * publishing.
 */
const pipeEncodedStream = (endpoint, transformer, label, isStopped) => {
  const failure = { reported: false };
  try {
    const streams = endpoint.createEncodedStreams();
    streams.readable.pipeThrough(transformer).pipeTo(streams.writable).catch((error) => {
      // Expected when the connection closes; only worth a line when it happens mid-session.
      if (!isStopped()) reportTransformFailure(`${label} stream`, error, failure);
    });
    return { attached: true, reason: null };
  } catch (error) {
    const reason = `Could not read the ${label}'s encoded frames: ${error?.message ?? String(error)}`;
    logEvent('error', 'pc', 'latency probe could not attach', reason);
    return { attached: false, reason };
  }
};

/**
 * Keeps an encoded stream flowing, unchanged, that nothing wants to look at.
 *
 * encodedInsertableStreams applies to the whole peer connection, and an endpoint whose frames
 * nobody reads sends nothing (with the probe on, audio went out silent). So every endpoint
 * other than the probed video gets this pass-through.
 */
export const passThroughEncodedFrames = (endpoint, label) => {
  if (!endpoint || typeof endpoint.createEncodedStreams !== 'function') return { stop: () => {} };

  let stopped = false;
  const transformer = new TransformStream({
    transform(frame, controller) { controller.enqueue(frame); },
  });
  pipeEncodedStream(endpoint, transformer, label, () => stopped);
  return { stop: () => { stopped = true; } };
};

/**
 * Publisher: write the stamp into every encoded video frame. `videoCodec` is the page's codec
 * setting, used only until the negotiated parameters are readable. Returns { stop }.
 */
export const startSenderStamp = (videoSender, { videoCodec } = {}) => {
  const unavailable = probeUnavailableReason();
  if (unavailable || !videoSender || typeof videoSender.createEncodedStreams !== 'function') {
    state.senderStatus = 'refused';
    state.senderReason = unavailable
      || 'No video sender to stamp, so this publish carries no frame stamp.';
    logEvent('error', 'pc', 'latency probe not stamping', state.senderReason);
    emit();
    return { stop: () => {} };
  }

  let stopped = false;
  let decision = decideStamping(null, videoCodec);
  const sequences = new Map();
  // SSRC to the small index that goes in the stamp. See rungIndexFor.
  const rungIndices = new Map();
  const failure = { reported: false };

  const senderCodec = () => {
    try {
      const codecs = videoSender.getParameters()?.codecs;
      return Array.isArray(codecs) && codecs.length > 0 ? codecs[0].mimeType : null;
    } catch {
      // getParameters throws before the sender is negotiated, which is the unresolved case.
      return null;
    }
  };

  const transformer = new TransformStream({
    transform(frame, controller) {
      try {
        // Only re-read the codec while the answer is still provisional; this runs per frame.
        if (!decision.resolved) {
          const next = decideStamping(senderCodec(), videoCodec);
          if (next.resolved || next.stamp !== decision.stamp) {
            decision = next;
            state.senderStatus = next.stamp ? 'stamping' : 'refused';
            state.senderReason = next.reason;
            logEvent(next.stamp ? 'info' : 'error', 'pc',
              next.stamp ? 'latency probe stamping frames' : 'latency probe not stamping',
              next.reason);
          }
        }

        if (!stopped && decision.stamp) {
          // SSRC is the field that differs per rung (see nextSequenceFor); rid and
          // spatialIndex are fallbacks for a browser that fills them.
          const metadata = typeof frame.getMetadata === 'function' ? frame.getMetadata() : null;
          const rung = metadata?.synchronizationSource
            ?? metadata?.rid
            ?? metadata?.spatialIndex
            ?? 'single';

          frame.data = stampFrameBytes(frame.data, {
            sequence: nextSequenceFor(sequences, rung),
            sentAt: Date.now(),
            rung: rungIndexFor(rungIndices, rung),
          });
          state.stampedOut += 1;
        }
      } catch (error) {
        reportTransformFailure('sender', error, failure);
      }
      // The frame goes on in every case, stamped or not. A diagnostic must not drop media.
      controller.enqueue(frame);
    },
  });

  const attached = pipeEncodedStream(videoSender, transformer, 'sender', () => stopped);

  state.stampedOut = 0;
  if (attached.attached) {
    state.senderStatus = decision.stamp ? 'stamping' : 'refused';
    state.senderReason = decision.reason;
  } else {
    state.senderStatus = 'refused';
    state.senderReason = attached.reason;
  }
  emit();

  return {
    stop: () => {
      stopped = true;
      state.senderStatus = 'off';
      state.senderReason = null;
      emit();
    },
  };
};

/** Drops the oldest record once the window is full, keeping the join map in step with it. */
const remember = (record) => {
  state.frames.push(record);
  state.byRtpTimestamp.set(record.rtpTimestamp, record);
  while (state.frames.length > FRAME_WINDOW) {
    const dropped = state.frames.shift();
    // Only if it is still the record under that key: a repeated rtpTimestamp must not
    // delete the newer frame's entry and silently stop the join.
    if (state.byRtpTimestamp.get(dropped.rtpTimestamp) === dropped) {
      state.byRtpTimestamp.delete(dropped.rtpTimestamp);
    }
  }
};

/**
 * Player: read the stamp off every encoded video frame before it is decoded. The frame passes on
 * untouched, SEI included, since the decoder ignores a user_data_unregistered SEI.
 *
 * Returns { stop }.
 */
export const startReceiverProbe = (videoReceiver) => {
  const unavailable = probeUnavailableReason();
  if (unavailable || !videoReceiver || typeof videoReceiver.createEncodedStreams !== 'function') {
    state.receiverStatus = 'off';
    state.receiverReason = unavailable || 'No video receiver, so no frame stamp can be read.';
    logEvent('error', 'pc', 'latency probe not reading frames', state.receiverReason);
    emit();
    return { stop: () => {} };
  }

  /*
   * ontrack can fire more than once and the encoded stream can be taken only once per receiver,
   * so a repeat on the same receiver is a no-op. Keyed on the object, because a new play session
   * brings a new receiver that has to attach again.
   */
  if (state.receiver === videoReceiver) return { stop: () => {} };

  let stopped = false;
  const failure = { reported: false };
  resetMeasurements();
  state.receiver = videoReceiver;

  const transformer = new TransformStream({
    transform(frame, controller) {
      try {
        if (!stopped) {
          const arrivedAt = Date.now();
          const arrivedAtHighRes = performance.now();
          const stamp = findSeiPayload(frame.data);

          if (stamp === null) {
            state.unstampedFrames += 1;
          } else {
            /*
             * The join key: rtpTimestamp is the only field on both getMetadata() and
             * requestVideoFrameCallback's metadata. frame.timestamp is the older spelling of
             * the same value, read as a fallback so such a browser still joins.
             */
            const metadata = typeof frame.getMetadata === 'function' ? frame.getMetadata() : null;
            const rtpTimestamp = metadata?.rtpTimestamp ?? frame.timestamp ?? null;

            /*
             * A gap counts only between consecutive frames of the same rung. Sequences are per
             * rung, and the Engine re-originates every rendition under one SSRC, so only the
             * stamp says which rung a frame came from. A viewer joining a simulcast publish is
             * handed one rung before settling on another; a switch starts a new baseline rather
             * than counting false losses.
             */
            if (state.lastRung === stamp.rung && state.lastSequence !== null) {
              state.missedFrames += countMissedFrames(state.lastSequence, stamp.sequence);
            }
            state.lastRung = stamp.rung;
            state.lastSequence = stamp.sequence;
            state.lastFrameAt = arrivedAt;
            state.stampedFrames += 1;

            remember({
              sequence: stamp.sequence,
              sentAt: stamp.sentAt,
              arrivedAt,
              arrivedAtHighRes,
              rtpTimestamp,
              displayAtHighRes: null,
            });
          }
        }
      } catch (error) {
        reportTransformFailure('receiver', error, failure);
      }
      controller.enqueue(frame);
    },
  });

  const attached = pipeEncodedStream(videoReceiver, transformer, 'receiver', () => stopped);
  if (!attached.attached) {
    state.receiverStatus = 'off';
    state.receiverReason = attached.reason;
    // Forgotten again, so a later receiver on a fresh session is still allowed to try.
    state.receiver = null;
    emit();
    return { stop: () => {} };
  }

  state.receiverStatus = 'reading';
  state.receiverReason = null;
  startEmitting();

  return {
    stop: () => {
      stopped = true;
      state.receiverStatus = 'off';
      state.receiverReason = null;
      state.receiver = null;
      stopEmitting();
    },
  };
};

/**
 * Player: learn when each frame is put on screen.
 *
 * expectedDisplayTime is when the compositor intends to show the frame: a prediction, and the
 * last thing the browser can see. It shares the monotonic performance clock with the arrival
 * time, so the player leg needs no offset; do not mix in Date.now(). Returns { stop }.
 */
export const attachProbeVideoElement = (videoElement) => {
  if (!videoElement || typeof videoElement.requestVideoFrameCallback !== 'function') {
    logEvent('error', 'pc', 'latency probe cannot see presented frames',
      'requestVideoFrameCallback is unavailable, so the decode and display leg is not measured.');
    return { stop: () => {} };
  }

  let stopped = false;
  let handle = null;

  const onFrame = (_now, metadata) => {
    if (stopped) return;
    const rtpTimestamp = metadata?.rtpTimestamp ?? null;
    const record = rtpTimestamp === null ? undefined : state.byRtpTimestamp.get(rtpTimestamp);
    if (record && record.displayAtHighRes === null
        && typeof metadata.expectedDisplayTime === 'number') {
      record.displayAtHighRes = metadata.expectedDisplayTime;
      state.joinedFrames += 1;
    }
    handle = videoElement.requestVideoFrameCallback(onFrame);
  };

  handle = videoElement.requestVideoFrameCallback(onFrame);

  return {
    stop: () => {
      stopped = true;
      if (handle !== null && typeof videoElement.cancelVideoFrameCallback === 'function') {
        videoElement.cancelVideoFrameCallback(handle);
      }
    },
  };
};

/*
 * Wiring shared by both sides of the clock exchange. Arrival time is taken before parsing, so
 * JSON work is never counted as path delay. A channel that cannot open is logged, never thrown,
 * because both callers sit in the publish or play path; the player just shows no transport figure.
 */
const openClockChannel = (peerConnection, create, onMessage) => {
  try {
    return attachDataChannel(
      peerConnection,
      {
        onDataChannelMessage: ({ label, data }) => {
          if (label !== CLOCK_CHANNEL_LABEL) return;
          onMessage(data, Date.now());
        },
      },
      { label: CLOCK_CHANNEL_LABEL, create },
    );
  } catch (error) {
    logEvent('error', 'pc', 'latency probe clock channel unavailable',
      error?.message ?? String(error));
    return null;
  }
};

/**
 * Publisher: answer clock pings.
 *
 * The publisher creates the channel, because a data channel's m-line has to be in the first
 * offer and the Engine mirrors a publisher-created channel to every player (see
 * attachDataChannel). The reply carries arrival and send times so the player can subtract the
 * publisher's turnaround. Returns { close }.
 */
export const attachClockResponder = (peerConnection) => {
  const channel = openClockChannel(peerConnection, true, (data, arrivedAt) => {
    const ping = parseClockMessage(data);
    // A reply on this channel is our own echo coming back on a page running both arms.
    if (!ping || ping.kind !== 'ping') return;
    try {
      channel.send(buildClockReply({ ping, t1: arrivedAt, t2: Date.now() }));
    } catch (error) {
      logEvent('error', 'pc', 'latency probe clock reply failed', error?.message ?? String(error));
    }
  });

  return { close: () => channel?.close() };
};

// Ping cadence: fast until the estimator has MIN_SAMPLES, then slow. At one per second the
// 32-sample window holds half a minute.
const CLOCK_PING_FAST_MS = 250;
const CLOCK_PING_SLOW_MS = 1000;

/**
 * Player: run the clock exchange. The player needs the offset, so it asks and the publisher
 * answers, on the channel the Engine mirrors from the publisher. No transport figure until the
 * publisher also has the probe on. Returns { close }.
 */
export const attachClockInitiator = (peerConnection) => {
  let sequence = 0;
  let timer = null;
  let closed = false;
  const pending = new Map();
  const id = newClockSessionId();

  const channel = openClockChannel(peerConnection, false, (data, t3) => {
    const reply = parseClockMessage(data);
    // Only our own outstanding pings. Other viewers' replies arrive on this mirrored channel.
    if (!reply || reply.kind !== 'reply' || reply.id !== id) return;
    if (!pending.has(reply.sequence)) return;
    pending.delete(reply.sequence);

    // Oldest first, which is the order estimateOffset documents that it needs.
    state.clockSamples.push({ t0: reply.t0, t1: reply.t1, t2: reply.t2, t3 });
    if (state.clockSamples.length > WINDOW_SAMPLES) state.clockSamples.shift();
  });

  const tick = () => {
    if (closed || channel === null) return;
    // A closing or closed channel never answers; stop the timer chain even if nobody calls close().
    if (channel.readyState === 'closing' || channel.readyState === 'closed') return;
    try {
      const t0 = Date.now();
      channel.send(buildClockPing({ sequence, t0, id }));
      pending.set(sequence, t0);
      sequence += 1;
      // Unanswered pings must not accumulate; the window is all the history that matters.
      if (pending.size > WINDOW_SAMPLES) pending.delete(pending.keys().next().value);
    } catch {
      // Not open yet, or refused: retry. With no samples the clock already reports "cannot measure".
    }
    timer = setTimeout(tick,
      state.clockSamples.length < MIN_SAMPLES ? CLOCK_PING_FAST_MS : CLOCK_PING_SLOW_MS);
  };

  tick();

  return {
    close: () => {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      channel?.close();
    },
  };
};
