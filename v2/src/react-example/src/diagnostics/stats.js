/*
 * Samples RTCPeerConnection.getStats() on an interval and reduces it to on-screen numbers.
 *
 *   estimatedLatencyMs = (RTT / 2) + jitter buffer delay
 *
 * A receiver-side estimate only: it excludes capture, encode, Engine processing, decode and
 * display, so glass-to-glass latency is higher. Label it as an estimate wherever shown.
 * RTT is measured: currentRoundTripTime on the active ICE candidate pair.
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
  // Prefer video, fall back to audio: an audio-only connection still has a jitter buffer
  // and a latency worth reporting.
  const inboundVideo = findBy(report, "inbound-rtp", (s) => s.kind === KIND);
  const outboundVideo = findBy(report, "outbound-rtp", (s) => s.kind === KIND);
  const inboundAudio = findBy(report, "inbound-rtp", (s) => s.kind === "audio");
  const outboundAudio = findBy(report, "outbound-rtp", (s) => s.kind === "audio");

  const inbound = inboundVideo || inboundAudio;
  const outbound = outboundVideo || outboundAudio;
  const remoteInbound = findBy(report, "remote-inbound-rtp", (s) => s.kind === KIND);

  // Prefer the ICE pair RTT; fall back to the RTT the receiver reports over RTCP.
  const rttSeconds =
    pair && typeof pair.currentRoundTripTime === "number"
      ? pair.currentRoundTripTime
      : remoteInbound && typeof remoteInbound.roundTripTime === "number"
        ? remoteInbound.roundTripTime
        : null;

  /*
   * The buffer over this interval, not the session. Both counters are cumulative, so they
   * are differenced against the previous sample; otherwise the drift watcher misses changes.
   * The first sample has no previous and uses the cumulative value.
   */
  const jitterBufferMsFrom = (delay, count) =>
    (typeof delay === "number" && typeof count === "number" && count > 0
      ? (delay / count) * 1000
      : null);

  let jitterBufferMs = null;
  if (inbound) {
    const before = previous
      ? findBy(previous, "inbound-rtp", (entry) => entry.kind === inbound.kind)
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

  const prevInbound = previous && inbound
    ? findBy(previous, "inbound-rtp", (s) => s.kind === inbound.kind)
    : null;
  const prevOutbound = previous ? findBy(previous, "outbound-rtp", (s) => s.kind === KIND) : null;

  const inboundBps = inbound && prevInbound
    ? perSecond(inbound, prevInbound, "bytesReceived", nowMs, thenMs)
    : null;
  // Summed across every encoding, so it matches the simulcast total shown beneath it.
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

  // The codec is a separate stat referenced by codecId.
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
   * One outbound-rtp per simulcast encoding. A layer at zero bytes is not a bug: Chromium
   * turns layers off when bandwidth will not carry them and refuses sizes below its floor,
   * so qualityLimitationReason is carried through to say why.
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
    // Sorted by rid only: Chromium omits scaleResolutionDownBy on outbound-rtp, so an idle
    // rung has nothing to rank by. SimulcastLayers orders from the configured renditions.
    .sort((a, b) => String(a.rid).localeCompare(String(b.rid)));

  /*
   * A receiver divides loss by what it should have received; a sender divides by what it
   * sent, with the loss count from RTCP remote-inbound-rtp. Summed across simulcast rungs.
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
    // Audio reported separately, so lost audio is distinguishable from none.
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
    // Why the encoder is holding back: 'bandwidth', 'cpu', 'other'.
    qualityLimitation:
      outboundVideo?.qualityLimitationReason && outboundVideo.qualityLimitationReason !== 'none'
        ? outboundVideo.qualityLimitationReason
        : null,
    // Empty unless the publish is actually simulcast; one unnamed encoding is not a layer list.
    outboundLayers: outboundLayers.length > 1 ? outboundLayers : [],
    outboundTotalKbps: outboundLayers.length > 1
      ? outboundLayers.reduce((sum, l) => sum + (l.kbps ?? 0), 0)
      : null,
    // A publisher has no receive path; the UI hides receiver-side latency tiles.
    isReceiving: Boolean(inbound),
    isSending: Boolean(outbound),
    hasVideo: Boolean(inboundVideo || outboundVideo),
    hasAudio: Boolean(inboundAudio || outboundAudio),
    // Resolved through the id: localCandidateId itself is opaque. Not consumed yet.
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