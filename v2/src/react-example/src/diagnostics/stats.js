/*
 * Samples RTCPeerConnection.getStats() on an interval and reduces it to the handful of
 * numbers worth putting on screen.
 *
 * On the latency figure, which is the easiest thing here to get wrong or overstate:
 *
 *   estimatedLatencyMs = (RTT / 2) + jitter buffer delay
 *
 * That is a *receiver-side* estimate. It covers the network leg from the Engine to this
 * browser plus the time frames wait in the jitter buffer. It does NOT include camera
 * capture, encode, any processing inside the Engine, decode, or the compositor and display
 * pipeline. Real glass-to-glass latency is higher, and the only way to measure that
 * honestly is a clock in front of the camera. Label it as an estimate wherever it is shown.
 *
 * RTT itself is measured, not estimated: it is currentRoundTripTime on the active ICE
 * candidate pair, which browsers derive from STUN request/response timing.
 */

const KIND = "video";

const pickCandidatePair = (report) => {
  let best = null;
  report.forEach((s) => {
    if (s.type !== "candidate-pair") return;
    // A connection can hold several pairs; the nominated succeeded one is the live path.
    const usable = s.state === "succeeded" && (s.nominated || s.selected || best === null);
    if (usable) {
      if (!best || (s.nominated && !best.nominated)) best = s;
    }
  });
  return best;
};

const findBy = (report, type, predicate) => {
  let found = null;
  report.forEach((s) => {
    if (s.type === type && (!predicate || predicate(s)) && !found) found = s;
  });
  return found;
};

const collect = (report, type, predicate) => {
  const found = [];
  report.forEach((s) => {
    if (s.type === type && (!predicate || predicate(s))) found.push(s);
  });
  return found;
};

const perSecond = (current, previous, field, nowMs, thenMs) => {
  if (!previous || previous[field] === undefined || current[field] === undefined) return null;
  const dt = (nowMs - thenMs) / 1000;
  if (dt <= 0) return null;
  const delta = current[field] - previous[field];
  return delta < 0 ? null : delta / dt;
};

/**
 * Reduces one getStats() report to a flat summary.
 * `previous` is the raw report from the last sample, used for rate calculations.
 */
export const summarizeStats = (report, previous, nowMs, thenMs) => {
  const pair = pickCandidatePair(report);
  // Prefer the video stream, but fall back to audio. A connection can legitimately carry
  // audio only, and when it does the receiver still has a jitter buffer and still has a
  // latency worth reporting - keying purely on video made both disappear.
  const inboundVideo = findBy(report, "inbound-rtp", (s) => s.kind === KIND);
  const outboundVideo = findBy(report, "outbound-rtp", (s) => s.kind === KIND);
  const inboundAudio = findBy(report, "inbound-rtp", (s) => s.kind === "audio");
  const outboundAudio = findBy(report, "outbound-rtp", (s) => s.kind === "audio");

  const inbound = inboundVideo || inboundAudio;
  const outbound = outboundVideo || outboundAudio;
  const remoteInbound = findBy(report, "remote-inbound-rtp", (s) => s.kind === KIND);

  // Prefer the ICE pair RTT. A publisher with no pair RTT yet can fall back to the RTT the
  // receiver reports back over RTCP.
  const rttSeconds =
    pair && typeof pair.currentRoundTripTime === "number"
      ? pair.currentRoundTripTime
      : remoteInbound && typeof remoteInbound.roundTripTime === "number"
        ? remoteInbound.roundTripTime
        : null;

  /*
   * The buffer over this interval, not over the session.
   *
   * jitterBufferDelay and jitterBufferEmittedCount are both cumulative for the life of the
   * connection, so dividing one by the other gives the mean since the session began. Ten
   * minutes in, a buffer that has just doubled moves that mean by almost nothing, and the
   * watcher that reports drift reads this figure, so a real regression stayed invisible.
   *
   * Both counters are differenced against the previous sample instead. The first sample has
   * nothing to difference against and falls back to the cumulative value, which is the right
   * answer there: at that point the session is the interval.
   */
  const jitterBufferMsFrom = (delay, count) =>
    (typeof delay === "number" && typeof count === "number" && count > 0
      ? (delay / count) * 1000
      : null);

  let jitterBufferMs = null;
  if (inbound) {
    const before = previous
      ? findBy(previous, "inbound-rtp", (entry) => entry.kind === KIND)
      : null;
    const emitted = before
      ? inbound.jitterBufferEmittedCount - before.jitterBufferEmittedCount
      : null;

    jitterBufferMs = emitted !== null && emitted > 0
      ? jitterBufferMsFrom(inbound.jitterBufferDelay - before.jitterBufferDelay, emitted)
      : jitterBufferMsFrom(inbound.jitterBufferDelay, inbound.jitterBufferEmittedCount);
  }

  const rttMs = rttSeconds === null ? null : rttSeconds * 1000;
  const estimatedLatencyMs =
    rttMs === null && jitterBufferMs === null
      ? null
      : (rttMs === null ? 0 : rttMs / 2) + (jitterBufferMs === null ? 0 : jitterBufferMs);

  const prevInbound = previous ? findBy(previous, "inbound-rtp", (s) => s.kind === KIND) : null;
  const prevOutbound = previous ? findBy(previous, "outbound-rtp", (s) => s.kind === KIND) : null;

  const inboundBps = inbound && prevInbound
    ? perSecond(inbound, prevInbound, "bytesReceived", nowMs, thenMs)
    : null;
  /*
   * The whole outbound rate, summed across every encoding. Reading a single outbound-rtp
   * made the headline bitrate smaller than the simulcast total shown beneath it, which is
   * the kind of internal contradiction that makes a diagnostic panel untrustworthy.
   */
  const outboundBps = (() => {
    const all = collect(report, "outbound-rtp", (s) => s.kind === (outboundVideo ? KIND : "audio"));
    if (all.length === 0 || !previous) return null;
    const before = new Map(
      collect(previous, "outbound-rtp", (s) => s.kind === (outboundVideo ? KIND : "audio"))
        .map((s) => [s.id, s])
    );
    let total = null;
    all.forEach((current) => {
      const prior = before.get(current.id);
      const rate = prior ? perSecond(current, prior, "bytesSent", nowMs, thenMs) : null;
      if (rate !== null) total = (total ?? 0) + rate;
    });
    return total;
  })();

  // The codec is a separate stat referenced by codecId. Without it the panel cannot answer
  // "what is actually being sent", which is the first question when video looks wrong.
  const rtp = inboundVideo || outboundVideo;
  let codec = null;
  if (rtp && rtp.codecId) {
    report.forEach((s) => {
      if (s.type === 'codec' && s.id === rtp.codecId && s.mimeType) {
        codec = s.mimeType.replace(/^video\//i, '').replace(/^audio\//i, '');
      }
    });
  }

  /*
   * Simulcast sends several encodings at once, and getStats reports one outbound-rtp per
   * encoding. Reading only the first hid the whole point of simulcast: on a real publish the
   * page showed 640x360 at 541 kbps while two other layers sat at zero, and there was no way
   * to tell that from the panel.
   *
   * A layer at zero bytes is not a bug in itself. Chromium turns layers off when the
   * bandwidth estimate will not carry them, and refuses sizes below its own floor, so
   * qualityLimitationReason is carried through: "configured but not sending, because
   * bandwidth" is the answer to the question this panel exists to answer.
   */
  const outboundVideoAll = collect(report, "outbound-rtp", (s) => s.kind === KIND);
  const prevOutboundById = new Map(
    previous ? collect(previous, "outbound-rtp", (s) => s.kind === KIND).map((s) => [s.id, s]) : []
  );

  const outboundLayers = outboundVideoAll
    .filter((s) => s.rid !== undefined && s.rid !== null)
    .map((s) => {
      const before = prevOutboundById.get(s.id);
      const bps = before ? perSecond(s, before, "bytesSent", nowMs, thenMs) : null;
      return {
        rid: s.rid,
        frameWidth: s.frameWidth ?? null,
        frameHeight: s.frameHeight ?? null,
        framesPerSecond: s.framesPerSecond ?? null,
        kbps: bps === null ? null : (bps * 8) / 1000,
        bytesSent: s.bytesSent ?? 0,
        framesEncoded: s.framesEncoded ?? 0,
        // active is the encoding being asked for; sending is whether anything came out.
        active: s.active !== false,
        sending: (s.bytesSent ?? 0) > 0,
        limitedBy: s.qualityLimitationReason && s.qualityLimitationReason !== 'none'
          ? s.qualityLimitationReason
          : null,
      };
    })
    // Stable by rid only. The ladder order belongs to whoever knows the configuration:
    // Chromium does not report scaleResolutionDownBy on outbound-rtp (checked against a live
    // browser on 2026-09-17), so an idle rung has no size and nothing here to rank it by.
    // SimulcastLayers orders for display from the configured renditions.
    .sort((a, b) => String(a.rid).localeCompare(String(b.rid)));

  /*
   * Loss needs a denominator, and the two directions have different ones. A receiver divides
   * by what it should have received; a sender has no inbound stream at all and has to divide
   * by what it sent, with the loss count coming back over RTCP in remote-inbound-rtp.
   *
   * Only the receiver half existed, so a publisher's packet loss was permanently a dash.
   * Both halves are summed across encodings, because simulcast reports one of each per rung.
   */
  const remoteInboundAll = collect(report, "remote-inbound-rtp", (s) => s.kind === KIND);
  const sum = (list, field) =>
    list.reduce((total, s) => (typeof s[field] === "number" ? total + s[field] : total), 0);

  let packetsLost = null;
  let packetsTotal = null;

  if (inbound && typeof inbound.packetsReceived === "number") {
    packetsLost = inbound.packetsLost ?? 0;
    packetsTotal = inbound.packetsReceived + packetsLost;
  } else if (remoteInboundAll.length > 0 && outboundVideoAll.length > 0) {
    packetsLost = sum(remoteInboundAll, "packetsLost");
    packetsTotal = sum(outboundVideoAll, "packetsSent");
  } else if (remoteInbound && typeof remoteInbound.packetsLost === "number") {
    packetsLost = remoteInbound.packetsLost;
  }

  return {
    at: nowMs,
    rttMs,
    jitterBufferMs,
    estimatedLatencyMs,
    // Only meaningful when the estimate has both halves; the UI uses it to add a caveat.
    latencyIsPartial: rttMs === null || jitterBufferMs === null,
    jitterMs: typeof inbound?.jitter === "number" ? inbound.jitter * 1000 : null,
    packetsLost,
    packetLossPct:
      packetsTotal && packetsTotal > 0 && packetsLost !== null
        ? (packetsLost / packetsTotal) * 100
        : null,
    inboundKbps: inboundBps === null ? null : (inboundBps * 8) / 1000,
    outboundKbps: outboundBps === null ? null : (outboundBps * 8) / 1000,
    framesPerSecond: inboundVideo?.framesPerSecond ?? outboundVideo?.framesPerSecond ?? null,
    frameWidth: inboundVideo?.frameWidth ?? outboundVideo?.frameWidth ?? null,
    frameHeight: inboundVideo?.frameHeight ?? outboundVideo?.frameHeight ?? null,
    codec,
    framesDecoded: inboundVideo?.framesDecoded ?? null,
    framesDropped: inboundVideo?.framesDropped ?? null,
    keyFramesDecoded: inboundVideo?.keyFramesDecoded ?? null,
    framesEncoded: outboundVideo?.framesEncoded ?? null,
    // Why the encoder is holding back, when it is: 'bandwidth', 'cpu', 'other'. This is the
    // single most useful field for explaining a bitrate or resolution drop after the fact.
    // Audio is carried alongside, and a stream that has lost its audio looks identical to
    // one that never had any unless it is reported separately.
    audioCodec: (() => {
      const rtp = inboundAudio || outboundAudio;
      if (!rtp || !rtp.codecId) return null;
      let found = null;
      report.forEach((entry) => {
        if (entry.type === 'codec' && entry.id === rtp.codecId && entry.mimeType) {
          found = entry.mimeType.replace(/^audio\//i, '');
        }
      });
      return found;
    })(),
    audioKbps: (() => {
      const current = inboundAudio || outboundAudio;
      if (!current || !previous) return null;
      const field = inboundAudio ? 'bytesReceived' : 'bytesSent';
      const before = findBy(previous, inboundAudio ? 'inbound-rtp' : 'outbound-rtp',
        (entry) => entry.kind === 'audio');
      if (!before) return null;
      const bps = perSecond(current, before, field, nowMs, thenMs);
      return bps === null ? null : (bps * 8) / 1000;
    })(),
    audioLevel: typeof inboundAudio?.audioLevel === 'number' ? inboundAudio.audioLevel : null,
    qualityLimitation:
      outboundVideo?.qualityLimitationReason && outboundVideo.qualityLimitationReason !== 'none'
        ? outboundVideo.qualityLimitationReason
        : null,
    // Empty unless the publish is actually simulcast; one unnamed encoding is not a layer list.
    outboundLayers: outboundLayers.length > 1 ? outboundLayers : [],
    // The total across every layer, which is what is really leaving this browser.
    outboundTotalKbps: outboundLayers.length > 1
      ? outboundLayers.reduce((sum, l) => sum + (l.kbps ?? 0), 0)
      : null,
    // A publisher has no receive path, so a receiver-side latency figure is meaningless
    // there. The UI uses this to hide those tiles rather than show a misleading number.
    isReceiving: Boolean(inbound),
    isSending: Boolean(outbound),
    hasVideo: Boolean(inboundVideo || outboundVideo),
    hasAudio: Boolean(inboundAudio || outboundAudio),
    /*
     * The type, resolved through the id. The field used to hold pair.localCandidateId, which
     * is an opaque string like "ICAAA1", so anything reading it as "host" or "relay" was
     * reading nonsense. Nothing consumes it yet; it is corrected rather than removed because
     * "which candidate won" is the first question asked when a connection takes an odd route.
     */
    localCandidateType: (() => {
      if (!pair || !pair.localCandidateId) return null;
      let found = null;
      report.forEach((entry) => {
        if (entry.id === pair.localCandidateId && entry.type === 'local-candidate') {
          found = entry.candidateType ?? null;
        }
      });
      return found;
    })(),
    availableOutgoingKbps:
      pair && typeof pair.availableOutgoingBitrate === "number"
        ? pair.availableOutgoingBitrate / 1000
        : null,
  };
};

/**
 * Polls until the returned stop() is called. Safe to call with a null peer connection,
 * which is the state between "page loaded" and "stream started".
 */
export const startStatsPolling = (peerConnection, onSample, intervalMs = 1000) => {
  if (!peerConnection || typeof peerConnection.getStats !== "function") return () => {};

  let stopped = false;
  let previous = null;
  let previousAt = 0;

  const tick = async () => {
    if (stopped) return;
    try {
      const report = await peerConnection.getStats(null);
      const now = Date.now();
      onSample(summarizeStats(report, previous, now, previousAt));
      previous = report;
      previousAt = now;
    } catch {
      // A connection closed mid-poll throws; the next tick stops or recovers on its own.
    }
  };

  tick();
  const handle = setInterval(tick, intervalMs);

  return () => {
    stopped = true;
    clearInterval(handle);
  };
};