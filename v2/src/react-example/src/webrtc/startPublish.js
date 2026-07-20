// Utilities

import { addIceServers } from "../utils/IceServersUtils";
import { validateParams } from "../utils/ValidationUtils";
import {
  SIMULCAST_REJECTED_MESSAGE,
  addSimulcastVideoSender,
  ensureSimulcastSDP,
  simulcastAcceptedInAnswer
} from "../utils/SimulcastUtils";
import { attachIceRestartRecovery } from "../utils/IceRestartUtils";
import { sendWhipWhepIceRestart } from "../utils/SdpFragUtils";
import attachDataChannel from "./attachDataChannel";

// Orchestration dispatcher: simulcast vs. single-track is a publish-flow
// decision, so it lives here. The simulcast mechanics live in SimulcastUtils.
const addVideoSender = (peerConnection, videoTrack, publishSettings) => {
  if (videoTrack == null) return undefined;
  if (publishSettings.useSimulcast)
    return addSimulcastVideoSender(peerConnection, videoTrack, publishSettings.simulcastRenditions);
  return peerConnection.addTrack(videoTrack);
};

// Detach handlers before closing so the stale PC/WS don't fire "closed" /
// error events into the next attempt's callbacks
const tearDownConnection = (peerConnection, websocket) => {
  if (peerConnection) {
    peerConnection.onicecandidate = null;
    peerConnection.onnegotiationneeded = null;
    peerConnection.onconnectionstatechange = null;
    try { peerConnection.close(); } catch (_) {}
  }
  if (websocket) {
    try { websocket.close(); } catch (_) {}
  }
};

// Single owner of "abandon this attempt and surface the failure". WS and
// WHIP both route through here (and the WHIP-only DELETE lives alongside
// the rest of the cleanup, not orphaned in the caller).
const reportSimulcastRejection = ({
  callbacks, peerConnection, websocket, whipSessionUrl
}) => {
  tearDownConnection(peerConnection, websocket);
  if (whipSessionUrl) {
    fetch(whipSessionUrl, { method: "DELETE" }).catch(() => {});
  }
  if (callbacks.onError) {
    callbacks.onError({ message: SIMULCAST_REJECTED_MESSAGE });
  }
};

const getAuthHeaders = (authToken) =>
  authToken ? { "Authorization": `Bearer ${authToken}` } : {};

const getStreamInfo = (publishSettings, session) => {
  return {
    applicationName: publishSettings.applicationName,
    streamName: publishSettings.streamName,
    sessionId: session.sessionId
  };
}

// PeerConnection Functions

const peerConnectionCreateOfferSuccess = (description, publishSettings, websocket, peerConnection, callbacks, session) => {
  console.log("peerConnectionCreateOfferSuccess: Setting local description SDP: ");

  peerConnection
    .setLocalDescription(description)
    .then(() => {
      const streamInfo = getStreamInfo(publishSettings, session);
      const offerSdp = publishSettings.useSimulcast
        ? ensureSimulcastSDP(peerConnection.localDescription.sdp, publishSettings.simulcastRenditions)
        : peerConnection.localDescription.sdp;
      // After the initial negotiation, a re-offer is an ICE restart and must be signaled as ICE_RESTART.
      // The engine no longer auto-detects a restart from a plain OFFER (it would reject one); instead the
      // full offer SDP is sent under ICE_RESTART and the engine normalizes it to a trickle-ice-sdpfrag,
      // the same representation the WHIP/WHEP PATCH path delivers.
      const payload = {
        messageType: session.negotiationEstablished ? "ICE_RESTART" : "OFFER",
        action: "PUBLISH",
        sdp: offerSdp,
        applicationName: streamInfo.applicationName,
        streamName: streamInfo.streamName,
        connectionId: streamInfo.sessionId,
      };
      console.log(`Sending ${payload.messageType}:`, JSON.stringify(payload));
      websocket.send(JSON.stringify(payload));
    })
    .catch((error) => {
      const newError = { message: "Peer connection failed", ...error };
      peerConnectionOnError(newError, callbacks);
    });
}

const peerConnectionOnError = (error, callbacks) => {
  console.log('peerConnectionOnError');
  console.log(error);
  if (callbacks.onError)
    callbacks.onError({ message: 'PeerConnection Error: ' + error.message });
}

// Websocket Functions

const websocketOnOpen = (publishSettings, websocket, callbacks, session) => {

  let peerConnection;
  const pendingCandidates = [];

  try {

    addIceServers(publishSettings, session);
    peerConnection = new RTCPeerConnection(session.peerConnectionConfig);

    peerConnection.onicecandidate = (event) => {
      if (websocket.readyState !== WebSocket.OPEN) return;

      if (event.candidate) {
        const candidatePayload = {
          messageType: "CANDIDATE",
          action: "PUBLISH",
          applicationName: publishSettings.applicationName,
          streamName: publishSettings.streamName,
          connectionId: session.sessionId,
          candidate: event.candidate.candidate,
        };
        
        if (session.sessionId === '[empty]') {
          pendingCandidates.push(candidatePayload);
        } else {
          console.log('Sending ICE candidate:', JSON.stringify(candidatePayload));
          websocket.send(JSON.stringify(candidatePayload));
        }
      } else {
        // End of candidates
        const endOfCandidatesPayload = {
          messageType: "CANDIDATE",
          action: "PUBLISH",
          applicationName: publishSettings.applicationName,
          streamName: publishSettings.streamName,
          connectionId: session.sessionId,
          candidate: ""
        };
         if (session.sessionId === '[empty]') {
          pendingCandidates.push(endOfCandidatesPayload);
         } else {
          console.log('Sending end of candidates:', JSON.stringify(endOfCandidatesPayload));
          websocket.send(JSON.stringify(endOfCandidatesPayload));
         }
      }
    };

    peerConnection.onnegotiationneeded = (event) => {
      peerConnection.createOffer()
        .then((description) => {
          peerConnectionCreateOfferSuccess(description, publishSettings, websocket, peerConnection, callbacks, session);
        })
        .catch((e) => {
          peerConnectionOnError(e, callbacks);
        })
    }

    peerConnection.onconnectionstatechange = (event) => {
      if (event.currentTarget.connectionState === 'connected') {
        if (callbacks.onConnectionStateChange)
          callbacks.onConnectionStateChange({ connected: true });
      } else {
        if (callbacks.onConnectionStateChange)
          callbacks.onConnectionStateChange({ connected: false });
      }
    }

    // ICE restart recovery: re-establishes the ICE connection in place when the network
    // path changes, without tearing down the publish session. See IceRestartUtils.
    attachIceRestartRecovery(peerConnection);

    // The data channel must be created before the first offer (we never renegotiate). The publisher
    // opens the channel; it broadcasts on it and receives what players send back over the same channel.
    if (publishSettings.dataChannelsEnabled)
      attachDataChannel(peerConnection, callbacks, { label: publishSettings.dataChannelLabel });

    let audioSender = undefined;
    let videoSender = undefined;
    if (publishSettings.audioTrack != null)
      audioSender = peerConnection.addTrack(publishSettings.audioTrack);
    videoSender = addVideoSender(peerConnection, publishSettings.videoTrack, publishSettings);

    if (callbacks.onSetSenders)
      callbacks.onSetSenders({ audioSender: audioSender, videoSender: videoSender });

    websocket.addEventListener("message", (event) => { websocketOnMessage(event, publishSettings, websocket, peerConnection, callbacks, session, pendingCandidates); });

  }
  catch (e) {
    websocketOnError(e, callbacks);
  }
  if (callbacks.onSetPeerConnection)
    callbacks.onSetPeerConnection({ peerConnection: peerConnection });
}

const websocketOnMessage = (event, publishSettings, websocket, peerConnection, callbacks, session, pendingCandidates) => {

  let msgJSON = JSON.parse(event.data);

  if (msgJSON.messageType === "CANDIDATE") {
    peerConnection.addIceCandidate(new RTCIceCandidate({ candidate: msgJSON.candidate, sdpMLineIndex: 0 }));
    return;
  }

  let msgStatus = Number(msgJSON['statusCode']);

  if (msgStatus === 504) {
    console.log("New stream connecting to Wowza Streaming Engine");
  } else if (msgStatus !== 200) {
    websocketOnError({ message: msgJSON['statusDescription'] }, callbacks);
  } else {

    if (msgJSON.message?.connectionId) {
      session.sessionId = msgJSON.message.connectionId;

      for (const candidate of pendingCandidates) {
        candidate.connectionId = session.sessionId;
        console.log('Sending queued ICE candidate:', JSON.stringify(candidate));
        websocket.send(JSON.stringify(candidate));
      }
      pendingCandidates.length = 0;
    }

    if (msgJSON.message?.sdp) {
      let sdpData = {
        "sdp": msgJSON.message.sdp,
        "type": "answer"
      }

      console.log("Setting remote description SDP:");
      console.log(sdpData.sdp);

      peerConnection
        .setRemoteDescription(new RTCSessionDescription(sdpData))
        .then(() => {
          // Initial offer/answer is complete; from here any re-offer is an ICE restart.
          session.negotiationEstablished = true;
          if (publishSettings.useSimulcast && !simulcastAcceptedInAnswer(sdpData.sdp)) {
            reportSimulcastRejection({
              callbacks, peerConnection, websocket
            });
          }
        })
        .catch((error) => { peerConnectionOnError(error, callbacks); });
    }
  }
}

const websocketOnError = (error, callbacks) => {
  console.log('Websocket Error');
  console.log(error);
  if (callbacks.onError)
    callbacks.onError({ message: 'Websocket Error: ' + error.message });
}

// startPublish
// callbacks:
// - onError({message:''})
// - onConnectionStateChange({connected:boolean})
// - onSetPeerConnection({peerConnection:obj})
// - onSetWebsocket({websocket:obj})
// - onSetSenders({audioSender:obj,videoSender:obj})

const startPublish = (publishSettings, websocket, callbacks) =>
{
  try {
    
    const session = {
        sessionId: '[empty]',
        // false until the initial offer/answer completes; afterwards every re-offer is an ICE restart.
        negotiationEstablished: false,
        peerConnectionConfig: {iceServers: []}
      };

    validateParams(publishSettings);

    if (publishSettings.useWhip) {
      startPublishWhip(publishSettings, session, callbacks);
    }
    else {
      
      if (websocket == null) {
        websocket = new WebSocket(publishSettings.signalingURL + "?webrtcImplementation=v2");
      }

      if (websocket != null) {
        console.log(publishSettings);
        websocket.binaryType = 'arraybuffer';

        
        const connectionTimeout = setTimeout(() => {
          if (websocket.readyState !== WebSocket.OPEN) {
            websocket.close();
          }
        }, 10000);

        websocket.addEventListener("open", () => {
          clearTimeout(connectionTimeout);
          websocketOnOpen(publishSettings, websocket, callbacks, session);
        });

        websocket.addEventListener("error", (error) => {
          clearTimeout(connectionTimeout);
          websocketOnError(error, callbacks);
        });

        if (callbacks.onSetWebsocket)
          callbacks.onSetWebsocket({ websocket: websocket });
      }
    }
  }
  catch (e) {
    if (callbacks.onError)
      callbacks.onError(e);
  }
}

const startPublishWhip = async (publishSettings, session, callbacks) => {
  let peerConnection;
  let sessionUrl;
  let negotiationEstablished = false; // gate onnegotiationneeded so only ICE restarts (not the initial offer) re-offer
  const pendingCandidates = [];

  try {

    addIceServers(publishSettings, session);
    peerConnection = new RTCPeerConnection(session.peerConnectionConfig);

    peerConnection.onconnectionstatechange = (event) => {
      const connected = event.currentTarget.connectionState === "connected";
      if (callbacks.onConnectionStateChange)
        callbacks.onConnectionStateChange({ connected });
    };

    // Auto-recovery: when ICE drops, restartIce() flags fresh credentials and fires
    // onnegotiationneeded (handled below). Reuses the same recovery state machine as the
    // WebSocket path so the heuristics stay in one place.
    const iceRestartRecovery = attachIceRestartRecovery(peerConnection);

    // ICE restart over WHIP (RFC 9725): on onnegotiationneeded we PATCH only the new credentials
    // to the resource URL as an application/trickle-ice-sdpfrag; the engine renegotiates ICE on
    // the existing session and returns its new ICE parameters as an sdpfrag, which we splice into
    // the current answer so media recovers without a teardown.
    peerConnection.onnegotiationneeded = () => {
      if (!negotiationEstablished || !sessionUrl) return; // the initial WHIP offer is sent manually below
      sendWhipWhepIceRestart(peerConnection, sessionUrl, {
        authHeaders: getAuthHeaders(publishSettings.authToken),
        label: "WHIP",
      }).catch((e) => {
        iceRestartRecovery.notifyRestartFailed(); // a failed restart leaves ICE down; let a later transition retry
        peerConnectionOnError(e, callbacks);
      });
    };

    peerConnection.onicecandidate = async (event) => {
      const candidate = event.candidate ? event.candidate.candidate : "";

      if (!sessionUrl) {
        pendingCandidates.push(candidate);
        return;
      }

      await fetch(sessionUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/trickle-ice-sdpfrag", ...getAuthHeaders(publishSettings.authToken) },
        body: candidate
      });
    };

    let audioSender;
    let videoSender;

    if (publishSettings.audioTrack != null)
      audioSender = peerConnection.addTrack(publishSettings.audioTrack);

    videoSender = addVideoSender(peerConnection, publishSettings.videoTrack, publishSettings);

    if (callbacks.onSetSenders)
      callbacks.onSetSenders({ audioSender, videoSender });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const offerSdp = publishSettings.useSimulcast
      ? ensureSimulcastSDP(peerConnection.localDescription.sdp, publishSettings.simulcastRenditions)
      : peerConnection.localDescription.sdp;

    console.log("Sending WHIP Offer:");
    console.log(offerSdp);

    const whipUrl = `${publishSettings.signalingURL}/${publishSettings.applicationName}/${publishSettings.streamName}/whip`;

    const response = await fetch(whipUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp", ...getAuthHeaders(publishSettings.authToken) },
      body: offerSdp
    });

    if (!response.ok) {
      throw new Error(`WHIP failed: ${response.status}`);
    }

    const locationHeader = response.headers.get("Location");
    sessionUrl = new URL(locationHeader, publishSettings.signalingURL).toString();

    for (const candidate of pendingCandidates) {
      await fetch(sessionUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/trickle-ice-sdpfrag", ...getAuthHeaders(publishSettings.authToken) },
        body: candidate
      });
    }
    pendingCandidates.length = 0;

    const answerSDP = await response.text();

    console.log("Received WHIP Answer:");
    console.log(answerSDP);

    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: answerSDP
    });
    negotiationEstablished = true; // from here, onnegotiationneeded means an ICE restart

    if (publishSettings.useSimulcast && !simulcastAcceptedInAnswer(answerSDP)) {
      reportSimulcastRejection({
        callbacks, peerConnection, whipSessionUrl: sessionUrl
      });
      return;
    }

    if (callbacks.onSetPeerConnection)
      callbacks.onSetPeerConnection({ peerConnection });

    peerConnection._whipSessionUrl = sessionUrl;
    peerConnection._whipAuthToken = publishSettings.authToken;

  } catch (e) {
    console.log(e.message);
    if (callbacks.onError)
      callbacks.onError(e);
  }
};


export default startPublish;
