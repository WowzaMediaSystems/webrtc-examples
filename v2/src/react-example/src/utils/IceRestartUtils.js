// ICE restart recovery utilities, shared by the publish (startPublish.js) and play
// (startPlay.js) flows.
//
// When the network path changes (NAT rebinding, interface switch, Wi-Fi/cellular handoff)
// the ICE connection drops to "disconnected" or "failed". restartIce() flags the next
// negotiation for fresh ICE credentials and fires onnegotiationneeded, which re-sends an
// OFFER over the existing connection so the session recovers without being torn down and
// re-established.

const ICE_RESTART_GRACE_PERIOD_MS = 3000;

// Peer connections we have asked for an ICE restart on and still owe a re-offer for. Kept at module
// level rather than inside attachIceRestartRecovery's closure so that everything which requests a
// restart can arm it and every onnegotiationneeded handler can consume it, without either side
// having to hold the recovery handle: the WebSocket flows discard it, and the "Restart ICE" buttons
// only have the peer connection from the store.
const pendingRestartOffers = new WeakSet();

const markRestartRequested = (peerConnection) => pendingRestartOffers.add(peerConnection);

// True once per restart we asked for, and false otherwise. Every onnegotiationneeded handler must
// gate its re-offer on this: the browser also raises negotiationneeded on every return to "stable"
// when a data channel exists but the server refused the SCTP m-line, and answering those
// renegotiates forever without ICE ever settling. It has to be one-shot rather than a plain "is a
// restart in flight" flag, because a restart stays in flight until ICE recovers - and a restart
// that never recovers would otherwise hold the gate open for exactly those spurious events.
export const consumeIceRestartOffer = (peerConnection) => {
  if (!peerConnection || !pendingRestartOffers.has(peerConnection)) {
    console.log('negotiationneeded raised without a pending ICE restart: no re-offer sent.');
    return false;
  }
  pendingRestartOffers.delete(peerConnection);
  return true;
};

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
    markRestartRequested(peerConnection);
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
    // Arm the gate here too, otherwise consumeIceRestartOffer() returns false and the signaling
    // flow drops the negotiationneeded this restart raises - the restart would never leave the
    // browser.
    markRestartRequested(peerConnection);
    peerConnection.restartIce();
  } else {
    console.warn('[ICE restart] No active peer connection, or restartIce() is unsupported in this browser.');
  }
};
