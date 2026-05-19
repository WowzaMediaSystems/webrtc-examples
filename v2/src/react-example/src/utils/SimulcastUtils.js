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

// User-facing copy. Lives here because it pairs with simulcastAcceptedInAnswer
// and the onSimulcastRejected callback — keep them co-located.
export const SIMULCAST_REJECTED_MESSAGE =
  "Simulcast was rejected by the server. Retrying without simulcast.";

// Returns the RTCRtpSender so callers match the contract of addTrack().
export const addSimulcastVideoSender = (peerConnection, videoTrack) => {
  const transceiver = peerConnection.addTransceiver(videoTrack, {
    direction: "sendonly",
    sendEncodings: SIMULCAST_ENCODINGS
  });
  return transceiver.sender;
};

// Safety net: Chrome/Firefox emit a=rid / a=simulcast lines automatically when
// sendEncodings is set, but older Safari versions don't. Ensure the wire SDP
// always advertises simulcast when the user opted in.
export const ensureSimulcastSDP = (sdp) => {
  if (!sdp || sdp.includes("a=simulcast:")) return sdp;

  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(/\r?\n/);
  const videoIndex = lines.findIndex((line) => line.startsWith("m=video"));
  if (videoIndex === -1) return sdp;

  let insertIndex = lines.length;
  for (let i = videoIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith("m=")) { insertIndex = i; break; }
  }

  const rids = SIMULCAST_ENCODINGS.map((e) => e.rid);
  const ridLines = rids.map((rid) => `a=rid:${rid} send`);
  lines.splice(insertIndex, 0, ...ridLines, `a=simulcast:send ${rids.join(";")}`);

  return lines.join(eol);
};

// RFC 8853: simulcast is accepted only when the answerer mirrors back an
// a=simulcast:recv line. Anything else (missing line, send-only, etc.) is
// treated as a rejection.
export const simulcastAcceptedInAnswer = (sdp) => {
  if (!sdp) return false;
  return /^a=simulcast:.*\brecv\b/m.test(sdp);
};
