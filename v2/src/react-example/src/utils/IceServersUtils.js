export const isValidStunUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'stun:';
  } catch {
    return false;
  }
}

export const isValidTurnUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'turn:' || parsed.protocol === 'turns:';
  } catch {
    return false;
  }
}

// TEMPORARY: forces every publish/play session through this TURN server with a
// relay-only transport policy, ignoring the STUN/TURN fields in the UI. Set
// FORCED_ICE_CONFIG to null to restore normal behavior - the helpers below all
// no-op then.
const FORCED_ICE_CONFIG = {
  iceServers: [{
    // Append '?transport=tcp' to pin the browser->TURN hop to TCP, or add a
    // second entry to offer both; ICE then prefers the UDP relay candidate.
    urls: 'turn:50.18.54.99:3478',
    username: 'wowza',
    credential: 'qua123'
  }],
  iceTransportPolicy: 'relay'   // browser gathers ONLY relay candidates
};

const isRelayCandidate = (line) => / typ relay/.test(line);

const stripNonRelayCandidates = (sdp) => {
  if (!FORCED_ICE_CONFIG || !sdp) return sdp;

  const lines = sdp.split(/\r\n|\n/);
  const kept = lines.filter(line => !line.startsWith('a=candidate:') || isRelayCandidate(line));

  if (kept.length !== lines.length)
    console.log(`Stripped ${lines.length - kept.length} non-relay candidate(s) from the remote SDP`);

  if (!kept.some(isRelayCandidate))
    console.warn('Remote SDP carries no relay candidate: the connection can only come up if the remote trickles one');

  return kept.join('\r\n');
}

const isAllowedRemoteCandidate = (candidate) => {
  if (!FORCED_ICE_CONFIG || !candidate) return true;   // '' is end-of-candidates, always keep it

  if (isRelayCandidate(candidate)) return true;

  console.log(`Ignoring non-relay remote candidate: ${candidate}`);
  return false;
}

// Companion to FORCED_ICE_CONFIG: install it on every peer connection we create.
// iceTransportPolicy keeps OUR gathering relay-only, but it says nothing about the
// remote candidates we accept, and ICE will happily nominate a pair built from a
// remote host/srflx candidate. Filtering at the call sites missed the ICE-restart
// path (SdpFragUtils.sendWhipWhepIceRestart re-adds the engine's candidates from
// the sdpfrag), so the publisher slipped past the relay on every restart. Wrapping
// the two entry points the browser exposes covers every path at once - initial
// answer, re-offers, ICE restarts, and anything added later.
export const enforceRelayOnly = (peerConnection) => {
  if (!FORCED_ICE_CONFIG || !peerConnection) return peerConnection;

  const setRemoteDescription = peerConnection.setRemoteDescription.bind(peerConnection);
  peerConnection.setRemoteDescription = (description) =>
    setRemoteDescription(description?.sdp
      ? { type: description.type, sdp: stripNonRelayCandidates(description.sdp) }
      : description);

  const addIceCandidate = peerConnection.addIceCandidate.bind(peerConnection);
  peerConnection.addIceCandidate = (candidate) =>
    // '' / null is end-of-candidates: always let it through.
    isAllowedRemoteCandidate(candidate?.candidate ?? candidate)
      ? addIceCandidate(candidate)
      : Promise.resolve();

  return peerConnection;
}

export const addIceServers = (settings, session) => {
  if (FORCED_ICE_CONFIG) {
    session.peerConnectionConfig = {
      ...session.peerConnectionConfig,
      ...FORCED_ICE_CONFIG,
      iceServers: FORCED_ICE_CONFIG.iceServers.map(server => ({ ...server }))
    };
    console.log(`Forced ICE configuration: ${JSON.stringify(session.peerConnectionConfig)}`);
    return;
  }

  const { iceServers } = session.peerConnectionConfig;

  if (settings.stunServerURL !== '') {
    settings.stunServerURL
      .split(',').map(url => url.trim()).filter(Boolean)
      .forEach(url =>  {
        iceServers.push({ urls: url });
        console.log(`STUN server URL: ${url}`);
      });
  }

  if (settings.turnServerURL !== '') {
    settings.turnServerURL
      .split(',').map(url => url.trim()).filter(Boolean)
      .forEach(url => {
        iceServers.push({
          urls: url,
          username: settings.turnUsername,
          credential: settings.turnPassword
        });
        console.log(`TURN server URL: ${url}`);
      });
  }

  console.log(`Session: ${JSON.stringify(session)}`);
}

export const STUN_SERVER_PLACEHOLDER = "stun:<host>:<port>, stun:<host>:<port>";
export const TURN_SERVER_PLACEHOLDER = "turn:<host>:<port>";