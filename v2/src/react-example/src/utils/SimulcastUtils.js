// Simulcast Utilities
//
// Everything the publisher needs to negotiate, validate and update simulcast
// on the wire: encoding layers, transceiver setup, defensive SDP munging,
// RFC 8853 answer detection and mid-stream parameter updates.

export const MAX_SIMULCAST_RENDITIONS = 3;

// Browsers (Chrome in particular) reject longer RIDs in addTransceiver.
export const MAX_RID_LENGTH = 16;

// Stable identity for UI rows; never sent to WebRTC or validated.
let nextRenditionId = 0;
const withRenditionId = (rendition) => ({ ...rendition, id: ++nextRenditionId });

// Three-layer simulcast: high (full), medium (1/2 res), low (1/4 res).
// rid/scaleResolutionDownBy/maxBitrate is what the browser turns into
// a=rid / a=simulcast lines in the offer SDP.
export const DEFAULT_SIMULCAST_RENDITIONS = [
  { rid: "h", maxBitrate: 2500000, scaleResolutionDownBy: 1.0 },
  { rid: "m", maxBitrate: 700000, scaleResolutionDownBy: 2.0 },
  { rid: "l", maxBitrate: 200000, scaleResolutionDownBy: 4.0 }
].map(withRenditionId);

export const createSimulcastRendition = () => {
  return withRenditionId({ rid: "", scaleResolutionDownBy: 1, maxBitrate: 500000 });
};

// RFC 8851 rid-id: letters, digits, "-" and "_"
const RID_PATTERN = /^[A-Za-z0-9_-]+$/;

// User-facing copy. Lives here because it pairs with simulcastAcceptedInAnswer —
// keep the wire-level detection and the message it triggers co-located.
export const SIMULCAST_REJECTED_MESSAGE =
  "Simulcast was rejected by the server. Disable Simulcast and try again.";

// Returns an error message, or null when the renditions are publishable.
// Numeric fields may arrive as strings (form inputs), so coerce before checking.
export const getSimulcastRenditionsError = (renditions) => {
  if (!Array.isArray(renditions) || renditions.length === 0)
    return "At least one simulcast rendition is required";
  if (renditions.length > MAX_SIMULCAST_RENDITIONS)
    return `A maximum of ${MAX_SIMULCAST_RENDITIONS} simulcast renditions is supported`;

  const rids = new Set();
  for (const rendition of renditions) {
    if (!RID_PATTERN.test(rendition.rid))
      return `Invalid RID "${rendition.rid}": use only letters, numbers, - and _`;
    if (rendition.rid.length > MAX_RID_LENGTH)
      return `Invalid RID "${rendition.rid}": maximum length is ${MAX_RID_LENGTH}`;
    if (rids.has(rendition.rid))
      return `Duplicate RID: ${rendition.rid}`;
    rids.add(rendition.rid);

    if (!(Number(rendition.scaleResolutionDownBy) >= 1))
      return `Invalid resolution scale down for "${rendition.rid}": must be 1 or greater`;
    if (!(Number(rendition.maxBitrate) > 0))
      return `Invalid max bitrate for "${rendition.rid}": must be greater than 0`;
  }
  return null;
};

// Preference order is derived from quality: lowest scale down (highest
// resolution) first, so the highest scale down lands last.
export const sortSimulcastRenditions = (renditions) => {
  return [...renditions].sort(
    (a, b) => Number(a.scaleResolutionDownBy) - Number(b.scaleResolutionDownBy)
  );
};

// Restores renditions persisted in the cookie (array) or a URL query
// parameter (JSON string). Returns null for anything not publishable.
export const parseSimulcastRenditions = (value) => {
  let renditions = value;
  if (typeof value === "string") {
    try { renditions = JSON.parse(value); } catch (_) { return null; }
  }
  if (!Array.isArray(renditions)) return null;

  const normalized = renditions.map((rendition) => withRenditionId({
    rid: String(rendition?.rid ?? ""),
    scaleResolutionDownBy: Number(rendition?.scaleResolutionDownBy) || 1,
    maxBitrate: Number(rendition?.maxBitrate) || 0
  }));

  return getSimulcastRenditionsError(normalized) ? null : sortSimulcastRenditions(normalized);
};

const buildSendEncodings = (renditions) => {
  return sortSimulcastRenditions(renditions).map((rendition) => {
    const encoding = { rid: rendition.rid };
    const scale = Number(rendition.scaleResolutionDownBy);
    if (scale > 1) encoding.scaleResolutionDownBy = scale;
    const maxBitrate = Number(rendition.maxBitrate);
    if (maxBitrate > 0) encoding.maxBitrate = maxBitrate;
    return encoding;
  });
};

// Returns the RTCRtpSender so callers match the contract of addTrack().
export const addSimulcastVideoSender = (peerConnection, videoTrack, renditions) => {
  const transceiver = peerConnection.addTransceiver(videoTrack, {
    direction: "sendonly",
    sendEncodings: buildSendEncodings(renditions)
  });
  return transceiver.sender;
};

// Applies the scale down values, which may change mid-stream, to the
// negotiated encodings, matched by rid. Renditions that were not negotiated
// are ignored.
export const applySimulcastParameters = (videoSender, renditions) => {
  if (videoSender == null || typeof videoSender.getParameters !== "function")
    return Promise.resolve();

  const parameters = videoSender.getParameters();
  if (!parameters.encodings || parameters.encodings.length === 0)
    return Promise.resolve();

  const renditionsByRid = new Map(renditions.map((rendition) => [rendition.rid, rendition]));
  parameters.encodings.forEach((encoding) => {
    const rendition = renditionsByRid.get(encoding.rid);
    if (!rendition) return;
    const scale = Number(rendition.scaleResolutionDownBy);
    if (scale >= 1) encoding.scaleResolutionDownBy = scale;
  });

  return videoSender.setParameters(parameters);
};

// RFC 8851 per-RID restriction string for one encoding. Only max-br today —
// extend here (max-width, max-height, max-fps, …) if we want more layer
// hints later.
const ridRestrictions = (encoding) => {
  const parts = [];
  if (encoding.maxBitrate != null) parts.push(`max-br=${encoding.maxBitrate}`);
  return parts.join(";");
};

export const ensureSimulcastSDP = (sdp, renditions) => {
  if (!sdp) return sdp;

  const encodings = buildSendEncodings(renditions);
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(/\r?\n/);
  const videoIndex = lines.findIndex((line) => line.startsWith("m=video"));
  if (videoIndex === -1) return sdp;

  let sectionEnd = lines.length;
  for (let i = videoIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith("m=")) { sectionEnd = i; break; }
  }

  // Strip any existing a=rid:* send and a=simulcast: lines in the video
  // section so we can re-emit them with restrictions in the preferred order.
  const filtered = [];
  for (let i = 0; i < lines.length; i++) {
    if (i >= videoIndex && i < sectionEnd) {
      if (/^a=rid:\S+\s+send\b/.test(lines[i])) continue;
      if (/^a=simulcast:/.test(lines[i])) continue;
    }
    filtered.push(lines[i]);
  }

  const newVideoIndex = filtered.findIndex((line) => line.startsWith("m=video"));
  let insertIndex = filtered.length;
  for (let i = newVideoIndex + 1; i < filtered.length; i++) {
    if (filtered[i].startsWith("m=")) { insertIndex = i; break; }
  }

  const ridLines = encodings.map((enc) => {
    const restrictions = ridRestrictions(enc);
    return restrictions
      ? `a=rid:${enc.rid} send ${restrictions}`
      : `a=rid:${enc.rid} send`;
  });
  const rids = encodings.map((enc) => enc.rid);

  filtered.splice(
    insertIndex, 0,
    ...ridLines,
    `a=simulcast:send ${rids.join(";")}`
  );

  return filtered.join(eol);
};

// RFC 8853: simulcast is accepted only when the answerer mirrors back an
// a=simulcast:recv line. Anything else (missing line, send-only, etc.) is
// treated as a rejection.
export const simulcastAcceptedInAnswer = (sdp) => {
  if (!sdp) return false;
  return /^a=simulcast:.*\brecv\b/m.test(sdp);
};
