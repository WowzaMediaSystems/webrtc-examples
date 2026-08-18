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

// Resolves once the browser has finished gathering, so the offer SDP can carry
// every candidate and no trickling is needed. The timeout is a safety net: with
// a relay-only policy and an unreachable TURN server, gathering can stall for a
// long time - better to POST an offer with whatever we have than to hang.
export const waitForIceGathering = (peerConnection, timeoutMs = 5000) =>
  new Promise((resolve) => {
    if (peerConnection.iceGatheringState === 'complete') return resolve();

    const done = () => {
      clearTimeout(timer);
      peerConnection.removeEventListener('icegatheringstatechange', onStateChange);
      resolve();
    };

    const onStateChange = () => {
      if (peerConnection.iceGatheringState === 'complete') {
        console.log('ICE gathering complete');
        done();
      }
    };

    const timer = setTimeout(() => {
      console.warn(`ICE gathering did not complete within ${timeoutMs}ms, sending the offer as-is`);
      done();
    }, timeoutMs);

    peerConnection.addEventListener('icegatheringstatechange', onStateChange);
  });

// TEMPORARY: forces every publish/play session through this TURN server with a
// relay-only transport policy, ignoring the STUN/TURN fields in the UI. Delete
// FORCED_ICE_CONFIG and the early return below to restore normal behavior.
const FORCED_ICE_CONFIG = {
  iceServers: [{
    // ?transport=tcp forces the browser->TURN hop over TCP. Add a second
    // 'turn:50.18.54.99:3478?transport=udp' entry to offer both; ICE then
    // prefers the UDP relay candidate and falls back to TCP.
    urls: 'turn:50.18.54.99:3478',
    username: 'wowza',
    credential: 'wowza123'
  }],
  iceTransportPolicy: 'relay'   // browser gathers ONLY relay candidates
};

const isRelayCandidate = (line) => / typ relay/.test(line);

// TEMPORARY: companion to FORCED_ICE_CONFIG. iceTransportPolicy only filters
// the candidates WE gather, so the remote host/srflx candidates have to be
// dropped as well - otherwise ICE nominates a pair that bypasses the TURN
// server. Both entry points matter: the answer SDP and the trickled candidates
// that arrive after it. No-ops when FORCED_ICE_CONFIG is removed.
export const stripNonRelayCandidates = (sdp) => {
  if (!FORCED_ICE_CONFIG || !sdp) return sdp;

  const lines = sdp.split(/\r\n|\n/);
  const kept = lines.filter(line => !line.startsWith('a=candidate:') || isRelayCandidate(line));

  if (kept.length !== lines.length)
    console.log(`Stripped ${lines.length - kept.length} non-relay candidate(s) from the remote SDP`);

  if (!kept.some(isRelayCandidate))
    console.warn('Remote SDP carries no relay candidate: the connection can only come up if the remote trickles one');

  return kept.join('\r\n');
}

export const isAllowedRemoteCandidate = (candidate) => {
  if (!FORCED_ICE_CONFIG || !candidate) return true;   // '' is end-of-candidates, always keep it

  if (isRelayCandidate(candidate)) return true;

  console.log(`Ignoring non-relay remote candidate: ${candidate}`);
  return false;
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