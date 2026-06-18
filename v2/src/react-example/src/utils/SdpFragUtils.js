// Helpers for WHIP/WHEP ICE restart over application/trickle-ice-sdpfrag (RFC 9725).
//
// The browser only exposes full-SDP APIs (createOffer / setRemoteDescription), while the wire format for an
// ICE restart is a partial SDP ("sdpfrag") carrying just the new ICE credentials and candidates. These helpers
// bridge between the two: extract credentials from an offer, build the outgoing fragment, parse the server's
// fragment, and splice the server's new ICE into the previously negotiated answer.

export const extractIceCredentials = (sdp) => {
  const ufrag = sdp.match(/^a=ice-ufrag:(.*)$/m);
  const pwd = sdp.match(/^a=ice-pwd:(.*)$/m);
  return {
    ufrag: ufrag ? ufrag[1].trim() : null,
    pwd: pwd ? pwd[1].trim() : null,
  };
};

// The ICE-restart fragment a WHIP/WHEP client PATCHes: just the fresh local ICE credentials.
export const buildIceRestartFragment = (ufrag, pwd) =>
  `a=ice-ufrag:${ufrag}\r\na=ice-pwd:${pwd}\r\n`;

export const parseIceFragment = (fragment) => {
  const { ufrag, pwd } = extractIceCredentials(fragment);
  const candidates = [];
  for (const line of fragment.split(/\r?\n/)) {
    const trimmed = line.trim();
    const idx = trimmed.indexOf("candidate:");
    if (idx >= 0) candidates.push(trimmed.substring(idx)); // "candidate:..." (the form addIceCandidate expects)
  }
  return { ufrag, pwd, candidates };
};

// Rebuild a full answer SDP from the current one by swapping in the server's new ICE credentials and dropping
// the stale candidates (the new ones are applied separately via addIceCandidate). setRemoteDescription needs a
// full SDP, so we patch the previously negotiated answer in place rather than reconstructing it from scratch.
export const applyServerIceToAnswer = (answerSdp, ufrag, pwd) =>
  answerSdp
    .replace(/^a=ice-ufrag:.*$/gm, `a=ice-ufrag:${ufrag}`)
    .replace(/^a=ice-pwd:.*$/gm, `a=ice-pwd:${pwd}`)
    .replace(/^a=candidate:.*\r?\n/gm, "")
    .replace(/^a=end-of-candidates\r?\n/gm, "");
