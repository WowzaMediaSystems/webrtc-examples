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
export const applyServerIceToAnswer = (answerSdp, ufrag, pwd) => {
  let sdp = answerSdp;
  // Only swap a credential the server actually sent; otherwise we'd write the literal "null"
  // into the SDP and corrupt the very answer we're trying to recover with.
  if (ufrag) sdp = sdp.replace(/^a=ice-ufrag:.*$/gm, `a=ice-ufrag:${ufrag}`);
  if (pwd) sdp = sdp.replace(/^a=ice-pwd:.*$/gm, `a=ice-pwd:${pwd}`);
  return sdp
    .replace(/^a=candidate:.*\r?\n/gm, "")
    .replace(/^a=end-of-candidates\r?\n/gm, "");
};

// Performs a WHIP/WHEP ICE restart over the established session (RFC 9725): create an offer
// (restartIce() must already have flagged fresh local ICE credentials), PATCH just those
// credentials to the resource URL as an application/trickle-ice-sdpfrag, then splice the
// server's returned ICE parameters into the active answer so media recovers in place. Throws on
// a non-OK response or any negotiation failure so the caller can surface the error and recover.
export const sendWhipWhepIceRestart = async (peerConnection, sessionUrl, { authHeaders = {}, label = "" } = {}) => {
  const offer = await peerConnection.createOffer(); // restartIce() already flagged new ICE creds
  await peerConnection.setLocalDescription(offer);

  const { ufrag, pwd } = extractIceCredentials(peerConnection.localDescription.sdp);
  const fragment = buildIceRestartFragment(ufrag, pwd);
  console.log(`Sending ${label} ICE-restart sdpfrag:\n${fragment}`);

  const restartResponse = await fetch(sessionUrl, {
    method: "PATCH",
    headers: { "Content-Type": "application/trickle-ice-sdpfrag", ...authHeaders },
    body: fragment,
  });

  if (!restartResponse.ok) {
    throw new Error(`${label} ICE restart failed: ${restartResponse.status}`);
  }

  const answerFragment = await restartResponse.text();
  console.log(`Received ${label} ICE-restart sdpfrag:\n${answerFragment}`);

  const server = parseIceFragment(answerFragment);
  const currentAnswer = (peerConnection.currentRemoteDescription || peerConnection.remoteDescription).sdp;
  const patchedAnswer = applyServerIceToAnswer(currentAnswer, server.ufrag, server.pwd);

  await peerConnection.setRemoteDescription({ type: "answer", sdp: patchedAnswer });
  for (const candidate of server.candidates) {
    try {
      await peerConnection.addIceCandidate({ candidate, sdpMLineIndex: 0 });
    } catch (err) {
      console.warn("Failed to add server ICE candidate:", err);
    }
  }
};
