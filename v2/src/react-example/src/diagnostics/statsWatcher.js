/*
 * Turns stat samples into log entries about what changed. Every entry names the old and new
 * value ("latency 84 ms -> 610 ms"), and only transitions are logged, never steady state.
 */

const band = (value, good, fair) => {
  if (value === null || value === undefined) return null;
  if (value <= good) return 'good';
  if (value <= fair) return 'fair';
  return 'poor';
};

const ms = (value) => (value === null || value === undefined ? '\u2014' : `${Math.round(value)} ms`);
const kbps = (value) => (value === null || value === undefined ? '\u2014' : `${Math.round(value)} kbps`);
const pct = (value) => (value === null || value === undefined ? '\u2014' : `${value.toFixed(2)} %`);

/** A change big enough to be worth a line: both relative and absolute, so idle noise is quiet. */
const movedEnough = (before, after, ratio, floor) => {
  if (before === null || before === undefined || after === null || after === undefined) return false;
  if (Math.abs(after - before) < floor) return false;
  if (before === 0) return after >= floor;
  return Math.abs(after - before) / before >= ratio;
};

/**
 * Pure comparison of two summaries. `reference` is the sample that last produced an entry,
 * not the previous sample, so slow drift is caught without a jittery connection repeating.
 *
 * @returns {Array<{level, label, detail, metric}>}
 */
export const diffSamples = (before, after, reference = before) => {
  if (!before || !after) return [];
  const events = [];
  const add = (level, label, metric, detail = null) => events.push({ level, label, detail, metric });
  const from = reference || before;

  // Latency: a band crossing, or enough drift since the last thing said about it.
  const latencyBefore = band(from.estimatedLatencyMs, 150, 400);
  const latencyAfter = band(after.estimatedLatencyMs, 150, 400);
  const latencyCrossed = latencyBefore && latencyAfter && latencyBefore !== latencyAfter;
  const latencyDrifted = movedEnough(from.estimatedLatencyMs, after.estimatedLatencyMs, 0.5, 25);

  if (latencyCrossed || latencyDrifted) {
    add(
      latencyAfter === 'poor' ? 'error' : 'info',
      latencyCrossed
        ? `latency ${latencyBefore} \u2192 ${latencyAfter}: ${ms(from.estimatedLatencyMs)} \u2192 ${ms(after.estimatedLatencyMs)}`
        : `latency ${ms(from.estimatedLatencyMs)} \u2192 ${ms(after.estimatedLatencyMs)}`,
      'latency',
      {
        roundTripMs: { from: from.rttMs, to: after.rttMs },
        jitterBufferMs: { from: from.jitterBufferMs, to: after.jitterBufferMs },
        note: 'Estimate = half the round trip plus the jitter buffer delay.',
      }
    );
  }

  const rttBefore = band(from.rttMs, 60, 150);
  const rttAfter = band(after.rttMs, 60, 150);
  if ((rttBefore && rttAfter && rttBefore !== rttAfter)
      || movedEnough(from.rttMs, after.rttMs, 0.5, 20)) {
    add(rttAfter === 'poor' ? 'error' : 'info',
      `round trip ${ms(from.rttMs)} \u2192 ${ms(after.rttMs)}`, 'rtt');
  }

  const lossBefore = band(before.packetLossPct, 0.5, 2);
  const lossAfter = band(after.packetLossPct, 0.5, 2);
  if (lossBefore && lossAfter && lossBefore !== lossAfter) {
    add(lossAfter === 'poor' ? 'error' : 'info',
      `packet loss ${lossBefore} \u2192 ${lossAfter}: ${pct(before.packetLossPct)} \u2192 ${pct(after.packetLossPct)}`,
      'loss');
  }

  // Throughput, in whichever direction this side has one.
  const rateBefore = from.isReceiving ? from.inboundKbps : from.outboundKbps;
  const rateAfter = after.isReceiving ? after.inboundKbps : after.outboundKbps;
  if (movedEnough(rateBefore, rateAfter, 0.4, 50)) {
    add(rateAfter < rateBefore ? 'error' : 'info',
      `bitrate ${kbps(rateBefore)} \u2192 ${kbps(rateAfter)}`,
      'bitrate',
      after.availableOutgoingKbps !== null
        ? { availableOutgoingKbps: after.availableOutgoingKbps }
        : null);
  }

  // Why the encoder is holding back; usually the cause of the changes above.
  if (before.qualityLimitation !== after.qualityLimitation) {
    add(after.qualityLimitation ? 'error' : 'info',
      after.qualityLimitation
        ? `encoder limited by ${after.qualityLimitation}`
        : `encoder no longer limited (was ${before.qualityLimitation})`,
      'limitation');
  }

  const sizeBefore = before.frameWidth && before.frameHeight ? `${before.frameWidth}\u00d7${before.frameHeight}` : null;
  const sizeAfter = after.frameWidth && after.frameHeight ? `${after.frameWidth}\u00d7${after.frameHeight}` : null;
  if (sizeBefore && sizeAfter && sizeBefore !== sizeAfter) {
    add('info', `frame size ${sizeBefore} \u2192 ${sizeAfter}`, 'size');
  }

  if (before.codec && after.codec && before.codec !== after.codec) {
    add('info', `codec ${before.codec} \u2192 ${after.codec}`, 'codec');
  }

  // A simulcast rung starting or stopping, with the reason the browser gave.
  const layerState = (sample) =>
    new Map((sample.outboundLayers || []).map((l) => [l.rid, l]));
  const wasSending = layerState(before);
  const nowSending = layerState(after);
  nowSending.forEach((layer, rid) => {
    const previous = wasSending.get(rid);
    if (!previous || previous.sending === layer.sending) return;
    add(layer.sending ? 'info' : 'error',
      layer.sending
        ? `simulcast rung "${rid}" started sending`
        : `simulcast rung "${rid}" stopped sending${layer.limitedBy ? ` (${layer.limitedBy})` : ''}`,
      `layer:${rid}`);
  });

  return events;
};

const DRIFTING = ['latency', 'rtt', 'bitrate'];

/** Stateful wrapper: feed it each sample, it logs the transitions through the injected `log`. */
export const createStatsWatcher = (role, log) => {
  let previous = null;
  // Per metric, the sample that last produced a line.
  let references = {};

  return (sample) => {
    if (!sample) {
      previous = null;
      references = {};
      return;
    }

    const emit = (event) =>
      log(event.level === 'error' ? 'error' : 'info', 'pc', `${role} ${event.label}`, event.detail);

    const reported = new Set();

    DRIFTING.forEach((metric) => {
      diffSamples(previous, sample, references[metric] || previous)
        .filter((event) => event.metric === metric)
        .forEach((event) => {
          reported.add(metric);
          emit(event);
        });
    });

    // The rest are state changes, compared against the previous sample.
    diffSamples(previous, sample)
      .filter((event) => !DRIFTING.includes(event.metric))
      .forEach(emit);

    DRIFTING.forEach((metric) => {
      if (reported.has(metric) || !references[metric]) references[metric] = sample;
    });

    previous = sample;
  };
};
