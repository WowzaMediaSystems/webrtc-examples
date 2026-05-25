// Simulcast Utilities
//
// Everything the publisher needs to negotiate and validate simulcast on the
// wire: encoding layers, transceiver setup, defensive SDP munging, and
// RFC 8853 answer detection. Kept cohesive so future iterations (different
// presets, additional layers, codec preference) land in one place.

// Three-layer simulcast: high (full), medium (1/2 res), low (1/4 res).
// rid/scaleResolutionDownBy/maxBitrate here is what the browser turns into
// a=rid / a=simulcast lines in the offer SDP.
export const SIMULCAST_ENCODINGS = [
  { rid: "h", maxBitrate: 2500000 },
  { rid: "m", maxBitrate: 700000, scaleResolutionDownBy: 2.0 },
  { rid: "l", maxBitrate: 200000, scaleResolutionDownBy: 4.0 }
];

// User-facing copy. Lives here because it pairs with simulcastAcceptedInAnswer —
// keep the wire-level detection and the message it triggers co-located.
export const SIMULCAST_REJECTED_MESSAGE =
  "Simulcast was rejected by the server. Disable Simulcast and try again.";

// Returns the RTCRtpSender so callers match the contract of addTrack().
export const addSimulcastVideoSender = (peerConnection, videoTrack) => {
  const transceiver = peerConnection.addTransceiver(videoTrack, {
    direction: "sendonly",
    sendEncodings: SIMULCAST_ENCODINGS
  });
  return transceiver.sender;
};

// RFC 8851 per-RID restriction string for one encoding. Only max-br today —
// extend here (max-width, max-height, max-fps, …) if we want more layer
// hints later.
const ridRestrictions = (encoding) => {
  const parts = [];
  if (encoding.maxBitrate != null) parts.push(`max-br=${encoding.maxBitrate}`);
  return parts.join(";");
};

export const ensureSimulcastSDP = (sdp) => {
  if (!sdp) return sdp;

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

  const ridLines = SIMULCAST_ENCODINGS.map((enc) => {
    const restrictions = ridRestrictions(enc);
    return restrictions
      ? `a=rid:${enc.rid} send ${restrictions}`
      : `a=rid:${enc.rid} send`;
  });
  const rids = SIMULCAST_ENCODINGS.map((enc) => enc.rid);

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
