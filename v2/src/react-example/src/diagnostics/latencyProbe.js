/*
 * The latency probe: how long a frame takes from the publisher's encoder to the player's
 * screen, and how much of that the Engine owns.
 *
 * The instrument is a sequence number and a send time written into every encoded frame as an
 * H.264 SEI NAL (see utils/frameStamp.js), read back on the receiver before decode, and joined
 * to the frame the compositor actually presented through rtpTimestamp. Three timestamps come
 * out of that:
 *
 *   camera -> encode ->| SEI written |-> Engine -> depacketize |<- SEI read ->| decode -> display
 *                            t0                                      t1                     t2
 *
 *   t1 - t0   transport: packetize, network, the Engine, network, jitter buffer, depacketize.
 *             This is the Engine figure, and it is the number nothing on this page could
 *             answer before. Measured at 107 to 109 ms p50 through the Engine on 2026-09-17
 *             against 7 ms p50 with the Engine removed from the path.
 *   t2 - t1   the player's own cost: decode, compositor, and the wait until the frame is
 *             scheduled for display.
 *   t2 - t0   end to end, minus capture and encode.
 *
 * What is deliberately NOT in the number: camera sensor and ISP delay before the browser sees
 * a frame, the encoder's own queue, and actual photon emission on the panel.
 * requestVideoFrameCallback's expectedDisplayTime is a prediction, not an observation. The
 * README states this next to the figure rather than in a footnote.
 *
 * Structure: everything above the "browser plumbing" line is pure and unit tested. The
 * plumbing below holds the two encoded-stream transforms, the video-frame callback and the
 * clock data channel, and each is kept thin enough to read in one go.
 *
 * Chromium only. createEncodedStreams is not standard; RTCRtpScriptTransform is the standards
 * path and is the follow-up, not this build. When the API is missing the probe reports itself
 * unavailable with the reason, and never half-works.
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

/*
 * Its own channel, not the chat channel. The clock exchange runs at a fixed cadence for the
 * life of the session and would otherwise interleave with whatever the user is typing, and a
 * dedicated label also means a page with chat switched off still measures.
 */
export const CLOCK_CHANNEL_LABEL = 'wz-clock';

// The sequence space the stamp's 32-bit field can carry, used for wrap-safe gap counting.
const SEQUENCE_SPACE = MAX_SEQUENCE + 1;

/*
 * How many received frames the medians are taken over. At 30 to 60 fps this is 2 to 4 seconds,
 * long enough to be stable and short enough that a figure on screen describes now. It also has
 * to outlast the join: requestVideoFrameCallback reports a frame only after it has been decoded
 * and scheduled, so a record must still be in the window when its display time arrives.
 */
export const FRAME_WINDOW = 120;

/*
 * A stamped frame older than this means the picture has stopped, so the medians describe a
 * stream that is no longer running. Held deliberately short: a stall must show as stale rather
 * than as a latency figure that has quietly stopped moving.
 */
export const STALE_MS = 1000;

/* ------------------------------------------------------------------ pure logic ------------- */

/**
 * Whether to write the stamp into this sender's frames.
 *
 * SEI is an H.264 construct. Prepending an SEI NAL to a VP8, VP9 or AV1 frame does not read as
 * "no stamp" at the far end, it corrupts the frame, so the codec has to be known before the
 * first byte is written and an unknown codec means do not stamp.
 *
 * `mimeType` comes from the negotiated sender parameters, which is the codec actually in use.
 * `wanted` is the page's codec setting and covers only the window before those parameters are
 * populated, which is why a decision made from it is returned unresolved and taken again.
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
 * Frames lost between two received sequence numbers.
 *
 * Reordering and duplicates count as zero rather than as a negative gap: the receiver sees what
 * it sees, and a re-ordered pair has not lost anything. The modulo keeps the count right across
 * the 32-bit wrap, which at 60 fps happens after 2.2 years and so would otherwise be a defect
 * nobody ever reproduces.
 */
export const countMissedFrames = (previous, sequence) => {
  if (!Number.isInteger(previous) || !Number.isInteger(sequence)) return 0;
  const gap = (sequence - previous + SEQUENCE_SPACE) % SEQUENCE_SPACE;
  // More than half the space forward is a wrap seen backwards: reordering, not lost frames.
  if (gap === 0 || gap > SEQUENCE_SPACE / 2) return 0;
  return gap - 1;
};

/**
 * The next sequence number for one simulcast rung, counted per rung.
 *
 * A single counter across a simulcast sender is wrong in a way that shows up as a wrong number
 * rather than as a blank: the sender's encoded stream carries the frames of every rung, the
 * player receives one rung, so a shared counter arrives at the player full of gaps and the
 * missed-frame count reports a publisher stalling when nothing is wrong. Counting per rung
 * makes the sequence the player sees contiguous again.
 *
 * `counters` is mutated, and the key is whatever identifies the rung, with a single stream
 * falling back to one shared key.
 *
 * Which field identifies a rung was settled by measurement on 2026-09-17, because the obvious
 * two do not. On a three-rung sender Chromium reported rid undefined and spatialIndex 0 on
 * every frame of every rung, so keying on those gave one counter for all of them: the player
 * receiving a single rung then saw a sequence full of holes and the panel reported 216 missed
 * frames on a session that had lost nothing. synchronizationSource is distinct per rung and
 * tracks the sizes (320x240 and 640x480 arrived under different SSRCs), so that is the key.
 */
export const nextSequenceFor = (counters, key) => {
  const value = counters.get(key) ?? 0;
  counters.set(key, (value + 1) % SEQUENCE_SPACE);
  return value;
};

/**
 * A small number standing for one rung, assigned in order of first appearance.
 *
 * This is what travels in the stamp, rather than the SSRC it is derived from. The receiver
 * only has to tell one rung from another within a session, so a byte is enough, and a byte is
 * what the stamp has room for. `indices` is mutated.
 *
 * Beyond 256 rungs it stops assigning and everything further shares the last index. A sender
 * with 256 simulcast rungs does not exist; the clamp is here so an unexpected key never writes
 * a value the stamp cannot hold.
 */
export const rungIndexFor = (indices, key) => {
  const existing = indices.get(key);
  if (existing !== undefined) return existing;
  const next = Math.min(indices.size, MAX_RUNG);
  indices.set(key, next);
  return next;
};

/**
 * An encoded frame with the stamp in front of it, as a fresh ArrayBuffer.
 *
 * Prepending rather than inserting: the SEI is a NAL of its own, so nothing inside the existing
 * bitstream is touched and the decoder reads it as a message it may ignore. Measured on
 * 2026-09-17, a stamped stream and a baseline stream had identical framesDropped, freezeCount
 * and pliCount.
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
 * The middle observed value, not the mean.
 *
 * Per-frame latency is long tailed: research on 2026-09-17 saw a p90 of 1,137 ms against a p50
 * of 107 ms on the same session, so a mean describes neither the typical frame nor the tail. On
 * an even-length window this returns the lower of the two middle values, so every figure shown
 * is a latency some frame actually had rather than an average of two.
 */
export const median = (values) => {
  const usable = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};

/**
 * What the clock exchange currently supports, and what to say when it supports nothing.
 *
 * Zero is never a stand-in for "unknown" in here. A genuine same-machine session reports an
 * offset of zero, so the two have to stay distinguishable: state 'ok' with offsetMs 0 is a
 * measurement, state 'unknown' is a refusal.
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
   * One page that both stamps and reads is reading one clock, and the uncertainty bound does
   * not describe that clock: it describes the round trip the samples took, which on the
   * combined page still goes out to the Engine and back. Measured on 2026-09-18 that came to
   * ± 34 ms, past the trusted bound, so the combined page refused to show any figure at all.
   * That page is the one most testing runs on.
   *
   * The offset is still required to be zero, and that is what makes this safe rather than an
   * assumption: the combined page can be pointed at somebody else's stream, and if it is, the
   * frames carry a different machine's clock and the measured offset says so. A wide bound
   * around a zero offset is a slow exchange. A non-zero offset is a different clock, whatever
   * this page happens to be publishing.
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
   * Two browser processes on one machine read the same OS clock, so both the offset and its
   * bound collapse to the clock's own resolution. Saying "exact" there is worth the extra
   * branch: it is the mode most testing actually runs in, and a displayed "0 ms plus or minus
   * 0 ms" reads like a missing value rather than like certainty.
   *
   * Only 'same-context' is a topology this code can actually verify: it means the publisher is
   * stamping in this very page, so there is one clock by construction. A near-zero offset alone
   * does not prove one machine, so that case is named for what was measured, one clock, and the
   * display is left to say "exact" without claiming where the far end runs.
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
 * `sentAt` is on the publisher's clock and `arrivedAt` on ours, so the transport leg is only
 * available once the offset is known: farTime - offsetMs converts it to local time. The player
 * leg is entirely local and subtracts two readings of the same monotonic clock, so it stands on
 * its own and is reported even when the clock exchange has refused.
 *
 * A negative transport figure is returned as measured. It means the clock estimate is wrong,
 * and hiding it would remove the only evidence of that.
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
 * Turns the probe's accumulated state into the object the UI subscribes to.
 *
 * Pure, and `now` is a parameter, so every status below is reachable from a unit test without a
 * peer connection.
 *
 *   off        nothing is running on this page
 *   waiting    the receiver is attached but no video frame has arrived yet
 *   no-stamp   frames are arriving and none carry a stamp
 *   stalled    stamped frames arrived and then stopped
 *   measuring  there is a figure
 */
export const summarizeProbe = (state, now) => {
  // The publisher stamping in this same page is the one clock relationship that is provable
  // here rather than inferred, so it is passed in instead of guessed at inside describeClock.
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
      /*
       * Three different causes, one symptom, and the message has to name them all. An operator
       * who sees this on a transcoding application would otherwise read it as a broken feature.
       */
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

/*
 * One JSON object per message, tagged, because the label is not a guarantee. Anything on this
 * channel that is not ours is ignored rather than parsed hopefully.
 */
const CLOCK_MESSAGE_TAG = 'wz-clock';
const CLOCK_MESSAGE_VERSION = 1;

/*
 * Who asked.
 *
 * The publisher answers on a channel the Engine mirrors to every viewer, so one viewer's reply
 * reaches all of them. Sequence numbers start at zero on each player, so two viewers watching
 * one stream hand each other replies that look outstanding and the offset is estimated from
 * another machine's clock. The id says whose ping a reply belongs to; anything else is dropped.
 *
 * Random rather than counted: there is nowhere to keep a counter that both ends agree on, and
 * a collision only matters between viewers alive at the same moment.
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
 * Reads one clock message, or returns null for anything that is not one.
 *
 * kind is 'ping' for a request and 'reply' for an answer, so the responder cannot be tricked
 * into answering its own reply on a page that runs both arms in one browser, which is exactly
 * what the split-view test does.
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

  // Null for a message from before the id existed, which every check below treats as "not
  // mine" rather than trusting it.
  const id = numeric(parsed.id);

  const t1 = numeric(parsed.t1);
  const t2 = numeric(parsed.t2);
  if (t1 === null || t2 === null) return { kind: 'ping', sequence, t0, id };
  return { kind: 'reply', sequence, t0, t1, t2, id };
};

/* ------------------------------------------------------- availability and the store --------- */

/**
 * Why the probe cannot run here, or null when it can.
 *
 * Checked at call time rather than at import, because a unit test environment has no
 * RTCRtpSender at all and the module still has to load.
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
 * The same question, in the shape the settings toggle and the readout want.
 *
 * It used to be a second implementation living in LatencyGroup.jsx, which is how the panel and
 * the probe came to describe the same missing API in two different sentences. It also made that
 * component file export something that is not a component, which switches Fast Refresh off for
 * it: every edit reloaded the page instead of the component.
 */
export const latencyProbeSupport = () => {
  const reason = probeUnavailableReason();
  return { supported: reason === null, reason };
};

/**
 * Adds the peer-connection flag the transforms need.
 *
 * encodedInsertableStreams can only be set when the RTCPeerConnection is constructed: a
 * connection built without it throws on createEncodedStreams, and there is no way to add it
 * afterwards. So the decision to measure has to be made before the connection exists, which is
 * why this is called from the two start paths and not from the probe itself.
 *
 * Returns whether the flag was set, so a caller can log a probe that was asked for and is not
 * going to happen.
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

/*
 * Emission is on a timer, not per frame. A 60 fps stream would otherwise push 60 renders a
 * second into React to move a median that barely changes between frames.
 */
const EMIT_INTERVAL_MS = 500;

/*
 * Two rules the subscriber depends on, both about telling silence from a figure:
 *
 * - Nothing measured yet publishes null, not a sample full of nulls. A subscriber then knows
 *   the difference between "no stamped frame has ever arrived" and "here is a latency", and
 *   cannot render an empty object as though it were a measurement.
 * - A sample is published only when a stamped frame has arrived since the last one. Repeating
 *   the same figure every half second would make a stalled publisher invisible, because the
 *   panel judges staleness by the age of what it last received.
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
 * Pub/sub as signalLog does it: the current value straight away, and an unsubscribe back.
 *
 * The value is null until a stamped frame has been read. See the note above emit.
 */
export const subscribe = (fn) => {
  listeners.add(fn);
  fn(state.stampedFrames === 0 ? null : sample);
  return () => listeners.delete(fn);
};

/**
 * The full state, always an object, including when nothing has been measured.
 *
 * Unlike a subscription this never hands back null: it is for a caller that wants to know why
 * there is no figure, which is what the status and reason fields are for.
 */
export const getSample = () => sample;

/*
 * Clears what was measured, and nothing else.
 *
 * Called when a receiver starts rather than when one stops, so the figures from the previous
 * session stay on screen after a stop instead of blanking, and a new session can never inherit
 * them. The sender's own state is deliberately left alone: on the split-view page the publisher
 * is already stamping when the player starts, and wiping it there would report a stamping
 * publisher as off.
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
 * Lifetime of everything below: a transform stays attached for the life of the peer connection.
 * createEncodedStreams can be called only once per sender or receiver and there is no detach, so
 * stop() flips a flag that makes the transform a pass-through and the streams end when the
 * connection closes. Anything else would mean tearing the session down to switch the probe off,
 * which is also why the UI toggle only takes effect on the next connect, exactly as the data
 * channel settings already do.
 */

/** Said once per stream, because a broken transform would otherwise say it 60 times a second. */
const reportTransformFailure = (label, error, once) => {
  if (once.reported) return;
  once.reported = true;
  logEvent('error', 'pc', `latency probe ${label} failed; frames pass through untouched`,
    error?.message ?? String(error));
};

/*
 * Takes the encoded stream and runs it through the transform, or reports why it could not.
 *
 * Wrapped because the two callers sit inside the publish and play paths: createEncodedStreams
 * throws if it has already been called on this sender or receiver, or if the peer connection was
 * built without encodedInsertableStreams, and an exception escaping here would take down the
 * session. A diagnostic that breaks publishing is worse than no diagnostic, and an earlier
 * attempt at a related feature did exactly that.
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
 * Keeps an encoded stream flowing that nothing wants to look at.
 *
 * encodedInsertableStreams is a property of the whole peer connection, not of one sender, and
 * once it is on, every sender and receiver hands its encoded frames to script and sends nothing
 * until script hands them back. The probe only ever wanted the video, so the audio sender's
 * frames were collected by a stream nobody read: measured against a live Engine, a publish with
 * the probe on sent 0 audio bytes and 0 audio packets while the video went out normally, and the
 * player showed "Audio codec: none" on a session whose SDP had negotiated opus.
 *
 * So every other endpoint on the connection gets this: read a frame, enqueue the same frame,
 * unchanged and uninspected. It is not a measurement, it is the cost of the flag.
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
 * Publisher: write the stamp into every encoded video frame.
 *
 * `videoCodec` is the page's codec setting, used only until the negotiated parameters are
 * readable. Returns { stop }.
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
          // See nextSequenceFor: the SSRC is the only field measured to differ per rung on the
          // sender. rid and spatialIndex are kept as fallbacks for a browser that fills them.
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
 * Player: read the stamp off every encoded video frame before it is decoded.
 *
 * The frame is passed on untouched, SEI included. Stripping it would be work to no end: a
 * user_data_unregistered SEI is ignored by the decoder, and a baseline-against-stamped
 * comparison on 2026-09-17 measured identical framesDropped, freezeCount and pliCount.
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
   * ontrack can fire more than once over a session's life and the encoded stream can be taken
   * only once per receiver, so a repeat attach on the same receiver is a no-op. Keyed on the
   * receiver object rather than on a flag, because a new play session brings a new receiver and
   * has to attach again.
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
             * The join key. rtpTimestamp is the only field that appears on both
             * RTCEncodedVideoFrame.getMetadata() and requestVideoFrameCallback's metadata,
             * which is what makes the encoded frame and the presented frame the same frame.
             * frame.timestamp is the older spelling of the same value and is read as a
             * fallback, so a browser carrying one but not the other still joins rather than
             * silently dropping the player leg.
             */
            const metadata = typeof frame.getMetadata === 'function' ? frame.getMetadata() : null;
            const rtpTimestamp = metadata?.rtpTimestamp ?? frame.timestamp ?? null;

            /*
             * Only while the rung has not changed under us.
             *
             * The sender counts its sequence per rung, so two rungs are two unrelated counters
             * and the step between them is not a distance. The Engine re-originates every
             * rendition under one SSRC, so the frame's own metadata cannot say which rung it
             * came from; the stamp can, which is why the rung travels in it.
             *
             * Measured on 2026-09-18 against a live Engine. A viewer joining a running
             * simulcast publish is handed one rung for its first twenty frames or so and then
             * settles on the one it asked for. Counting across that step reported 235 lost
             * frames. Counting per rung but across the switch still reported 19, because the
             * rung being settled on carried on advancing while the other one was forwarded.
             * Neither number is loss, and the second is the one that looks plausible enough to
             * be believed.
             *
             * So a gap counts only between consecutive frames of the same rung. That makes the
             * figure "frames lost while watching one rung without interruption", which is the
             * question worth asking. A switch starts a new baseline and says nothing.
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
 * Player: learn when each frame is actually put on screen.
 *
 * requestVideoFrameCallback fires once per presented frame and carries expectedDisplayTime,
 * which is when the compositor intends to show it. That is a prediction rather than an
 * observation, and it is the last thing this instrument can see: photon emission on the panel
 * is beyond the browser.
 *
 * expectedDisplayTime and the arrival time recorded above are both on the monotonic performance
 * clock, so the player leg subtracts two readings of one clock and needs no offset and no
 * conversion. Mixing in Date.now() here would import that clock's slew into a figure that does
 * not need it.
 *
 * Returns { stop }.
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
 * The two sides of the clock exchange differ only in who creates the channel and what they do
 * with a message, so the wiring is shared. The arrival time is taken before the message is
 * parsed, so JSON work is never counted as path delay.
 *
 * createDataChannel can throw and both callers sit inside the publish or play path, so a
 * channel that cannot be opened costs the session nothing: the player ends up with no samples,
 * reports that it cannot measure the clock, and shows no transport figure.
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
 * attachDataChannel). The publisher only ever echoes: it stamps when the ping arrived and when
 * it replied, so the player can subtract the far end's own turnaround out of the round trip.
 *
 * Returns { close }.
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

/*
 * Ping cadence. Fast until the estimator has the minimum it needs, because until then the
 * player has no transport figure at all, then slow enough to be free for the rest of the
 * session. The window holds 32 samples, so one per second keeps half a minute of history.
 */
const CLOCK_PING_FAST_MS = 250;
const CLOCK_PING_SLOW_MS = 1000;

/**
 * Player: run the clock exchange.
 *
 * The player is the side that needs the offset, because the stamp it reads is on the
 * publisher's clock, so the player asks and the publisher answers. The channel is the mirrored
 * one the Engine opens toward us, which means a player cannot measure the transport leg until
 * the publisher also has the probe on. The player-to-publisher return path through the Engine
 * was verified working on 2026-09-17.
 *
 * Returns { close }.
 */
export const attachClockInitiator = (peerConnection) => {
  let sequence = 0;
  let timer = null;
  let closed = false;
  const pending = new Map();
  const id = newClockSessionId();

  const channel = openClockChannel(peerConnection, false, (data, t3) => {
    const reply = parseClockMessage(data);
    // Only a reply to one of our own pings, and one still outstanding. Another viewer's reply
    // arrives on this same mirrored channel and carries another machine's clock.
    if (!reply || reply.kind !== 'reply' || reply.id !== id) return;
    if (!pending.has(reply.sequence)) return;
    pending.delete(reply.sequence);

    // Oldest first, which is the order estimateOffset documents that it needs.
    state.clockSamples.push({ t0: reply.t0, t1: reply.t1, t2: reply.t2, t3 });
    if (state.clockSamples.length > WINDOW_SAMPLES) state.clockSamples.shift();
  });

  const tick = () => {
    if (closed || channel === null) return;
    /*
     * A channel that is closing or closed will never answer, and rescheduling against it just
     * keeps a timer chain alive for the life of the tab. close() below is the ordinary way out;
     * this is for the session that ends without anyone calling it.
     */
    if (channel.readyState === 'closing' || channel.readyState === 'closed') return;
    try {
      const t0 = Date.now();
      channel.send(buildClockPing({ sequence, t0, id }));
      pending.set(sequence, t0);
      sequence += 1;
      // Unanswered pings must not accumulate; the window is all the history that matters.
      if (pending.size > WINDOW_SAMPLES) pending.delete(pending.keys().next().value);
    } catch {
      /*
       * Not open yet, or refused by the application. Retrying is the whole response: the
       * refusal is already visible, because with no samples the clock reports "cannot measure"
       * and no transport figure is shown.
       */
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
