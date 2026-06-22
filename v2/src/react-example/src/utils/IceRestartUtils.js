// ICE restart recovery utilities, shared by the publish (startPublish.js) and play
// (startPlay.js) flows.
//
// When the network path changes (NAT rebinding, interface switch, Wi-Fi/cellular handoff)
// the ICE connection drops to "disconnected" or "failed". restartIce() flags the next
// negotiation for fresh ICE credentials and fires onnegotiationneeded, which re-sends an
// OFFER over the existing connection so the session recovers without being torn down and
// re-established.

const ICE_RESTART_GRACE_PERIOD_MS = 3000;

// Attaches an oniceconnectionstatechange handler that requests an ICE restart when the
// connection drops, automatically recovering the session in place.
export const attachIceRestartRecovery = (peerConnection) => {
  let iceRestartGraceTimer = null;
  let iceRestartInProgress = false;

  const requestIceRestart = (reason) => {
    if (iceRestartInProgress) return; // one restart at a time; the engine rejects concurrent restarts
    if (typeof peerConnection.restartIce !== 'function') {
      console.warn('ICE restart needed but restartIce() is not supported in this browser.');
      return;
    }
    iceRestartInProgress = true;
    console.log(`Requesting ICE restart (${reason}).`);
    peerConnection.restartIce();
  };

  peerConnection.oniceconnectionstatechange = () => {
    const iceState = peerConnection.iceConnectionState;
    console.log(`ICE connection state: ${iceState}`);

    switch (iceState) {
      case 'failed':
        // Hard failure - recover immediately.
        if (iceRestartGraceTimer) { clearTimeout(iceRestartGraceTimer); iceRestartGraceTimer = null; }
        requestIceRestart('iceConnectionState=failed');
        break;
      case 'disconnected':
        // Often transient - give it a moment to self-heal before forcing a restart.
        if (!iceRestartGraceTimer && !iceRestartInProgress) {
          iceRestartGraceTimer = setTimeout(() => {
            iceRestartGraceTimer = null;
            const current = peerConnection.iceConnectionState;
            if (current === 'disconnected' || current === 'failed') {
              requestIceRestart(`iceConnectionState=${current} after grace period`);
            }
          }, ICE_RESTART_GRACE_PERIOD_MS);
        }
        break;
      case 'connected':
      case 'completed':
        // Recovered (or initial connect): clear pending work and re-arm for the next change.
        if (iceRestartGraceTimer) { clearTimeout(iceRestartGraceTimer); iceRestartGraceTimer = null; }
        iceRestartInProgress = false;
        break;
      default:
        // 'new' / 'checking' / 'closed' - no recovery action needed; log just in case.
        console.log(`ICE connection state ${iceState}: no ICE-restart action taken.`);
        break;
    }
  };

  // For transports that drive the restart from outside this module (WHIP/WHEP renegotiate via
  // onnegotiationneeded): if that restart attempt fails, ICE stays failed/disconnected and no
  // further state-change event fires, so the "one restart at a time" guard would block every
  // retry forever. notifyRestartFailed() clears the guard so a later transition can try again.
  return {
    notifyRestartFailed: () => { iceRestartInProgress = false; },
  };
};

// Test aid: manually trigger an ICE restart on an active peer connection. restartIce()
// flags the next negotiation for fresh ICE credentials and fires onnegotiationneeded,
// which the signaling flow handles by re-sending an OFFER with a new ufrag/pwd over the
// same connectionId. The engine detects the credential change and renegotiates ICE
// without recreating the session.
export const triggerIceRestart = (peerConnection) => {
  if (peerConnection && typeof peerConnection.restartIce === 'function') {
    console.log('[ICE restart] Calling peerConnection.restartIce(); a new offer with fresh ICE credentials will be sent.');
    peerConnection.restartIce();
  } else {
    console.warn('[ICE restart] No active peer connection, or restartIce() is unsupported in this browser.');
  }
};
