// Utilities

import { addIceServers } from "../utils/IceServersUtils";
import { applyVideoCodecPreference, isVideoCodecOfferable } from "../utils/CodecUtils";
import { describeRejectedVideo, videoWasRejected } from "../utils/SdpAnswerUtils";
import { describeSignalingError, instrumentPeerConnection, instrumentTrack, instrumentWebSocket, isWebSocketClosing, logEvent, loggedFetch } from "../diagnostics/signalLog";
import { validateParams } from "../utils/ValidationUtils";
import { keepUntilStopped, releaseSessionHandles } from "./sessionHandles";
import { releasePeerConnection } from "../diagnostics/connections";
import {
  SIMULCAST_REJECTED_MESSAGE,
  addSimulcastVideoSender,
  ensureSimulcastSDP,
  simulcastAcceptedInAnswer
} from "../utils/SimulcastUtils";
import { attachIceRestartRecovery, consumeIceRestartOffer } from "../utils/IceRestartUtils";
import { sendWhipWhepIceRestart } from "../utils/SdpFragUtils";
import attachDataChannel, {
  CHAT_CHANNEL_LABEL,
  dataChannelsAcceptedInAnswer,
  ensureApplicationSectionInAnswer
} from "./attachDataChannel";
import { startCaptionBroadcast } from "./captions";
import {
  armAnswerTimeout,
  clearAnswerTimeout,
  getAnswerTimeoutMessage,
  getWhipWhepFailureMessage
} from "../utils/NegotiationFailureUtils";
import {
  attachClockResponder,
  configureEncodedStreams,
  passThroughEncodedFrames,
  probeUnavailableReason,
  startSenderStamp
} from "../diagnostics/latencyProbe";

// Bring up the enabled publisher data channels: the full-duplex chat channel and/or the one-way
// captions broadcast, each gated by its own setting. `onCaption` (if provided) mirrors each sent
// caption line to the UI. Returns a handle to shut them down if the server refuses the SCTP section.
const attachPublishDataChannels = (peerConnection, callbacks, publishSettings) => {
  if (!publishSettings.chatEnabled && !publishSettings.captionsEnabled && !publishSettings.latencyProbe)
    return null;
  const stops = [];
  if (publishSettings.chatEnabled) {
    const chat = attachDataChannel(peerConnection, callbacks, { label: CHAT_CHANNEL_LABEL, create: true });
    stops.push(() => chat.close());
  }
  if (publishSettings.captionsEnabled)
    stops.push(startCaptionBroadcast(peerConnection, (text) => {
      if (callbacks.onCaption) callbacks.onCaption({ text });
    }));
  // The probe's clock channel; the publisher only answers pings on it.
  if (publishSettings.latencyProbe) {
    const clock = attachClockResponder(peerConnection);
    stops.push(() => clock.close());
  }
  return { close: () => stops.forEach((stop) => stop()) };
};

// The SCTP section shares the offer/answer with media but is optional: give up on the channels, tell
// the UI, leave the session alone. Returns the handle to keep - null once refused, so a later
// ICE-restart answer doesn't report it twice.
const handleRefusedDataChannels = (answerSdp, dataChannels, callbacks) => {
  if (!dataChannels || dataChannelsAcceptedInAnswer(answerSdp)) return dataChannels;
  console.log("Data channels were refused by the server; continuing with media only.");
  dataChannels.close();
  if (callbacks.onDataChannelsUnavailable)
    callbacks.onDataChannelsUnavailable();
  return null;
};

// A server that will not accept any offered video codec answers m=video 0 / a=inactive.
// The connection still succeeds on audio, so this has to be surfaced or it is invisible.
const reportRejectedVideo = (answerSdp, publishSettings, callbacks, session) => {
  // Only meaningful when video was offered: an audio-only publish gets no video answer,
  // and that is not a rejection (carried over from ENG-5135).
  if (publishSettings.videoTrack == null) return;

  const offerable = isVideoCodecOfferable(publishSettings.videoCodec);
  const message = describeRejectedVideo(answerSdp, publishSettings.videoCodec, offerable);
  if (!message) return;

  // Report once per session, and only latch when there is something to report. Every ICE
  // restart brings another answer; a clean first answer must not swallow a rejection
  // that arrives on a later one.
  if (session.videoRejectionReported) return;
  session.videoRejectionReported = true;
  logEvent('error', 'pc', 'server rejected the video m-line', {
    videoCodec: publishSettings.videoCodec,
    browserCanOfferCodec: offerable,
  });
  // Deliberately not onError: that tears the publish down, and audio is still flowing.
  // This is a degraded publish, not a failed one. The callback gets its own try here so
  // a throw in a warning handler reads the same on the WebSocket and WHIP paths and
  // never surfaces as a connection failure.
  try {
    if (callbacks && callbacks.onWarning) callbacks.onWarning({ message });
  } catch (error) {
    logEvent('error', 'pc', 'could not deliver the rejected-video warning',
      error?.message ?? String(error));
  }
};

// encodedInsertableStreams can only be set at RTCPeerConnection construction, so this runs
// before one exists, and logs why if the probe cannot run.
const armEncodedStreams = (session, publishSettings) => {
  if (!publishSettings.latencyProbe) return;
  if (!configureEncodedStreams(session.peerConnectionConfig, true))
    logEvent('error', 'pc', 'latency probe unavailable', probeUnavailableReason());
};

const addVideoSender = (peerConnection, videoTrack, publishSettings) => {
  // A publish with no video still reaches "connected" and shows LIVE, so say so here.
  // Error only when a camera was chosen and no track came out; "None" is a choice.
  const cameraChosen = Boolean(publishSettings.videoTrack1DeviceId);
  logEvent(
    videoTrack == null && cameraChosen ? 'error' : 'info',
    'pc',
    videoTrack == null
      ? (cameraChosen ? 'publish has NO video track - audio only' : 'publish is audio only: no camera selected')
      : 'publish video track attached: ' + (videoTrack.label || videoTrack.kind) + ' (' + videoTrack.readyState + ')',
    { hasVideoTrack: videoTrack != null, hasAudioTrack: publishSettings.audioTrack != null }
  );

  if (videoTrack == null) return undefined;

  // A muted or ended capture track is the usual cause of a quiet publish; see instrumentTrack.
  keepUntilStopped(peerConnection, instrumentTrack(videoTrack, 'publish', 'outbound'));

  const sender = publishSettings.useSimulcast
    ? addSimulcastVideoSender(peerConnection, videoTrack, publishSettings.simulcastRenditions)
    : peerConnection.addTrack(videoTrack);

  // Filter the offer down to the wanted codec. Engine picks from the offer rather than
  // honoring its order, so reordering alone does not make the choice stick.
  // The outcome is logged so a surprising negotiated codec can be traced.
  const applied = applyVideoCodecPreference(peerConnection, sender, publishSettings.videoCodec);

  // "auto" is no preference, so leaving the order to the browser is not an error.
  const noPreferenceAsked = !publishSettings.videoCodec || publishSettings.videoCodec === 'auto';
  logEvent(
    (applied || noPreferenceAsked) ? 'info' : 'error',
    'pc',
    // eslint-disable-next-line no-nested-ternary
    applied
      ? `publish codec preference applied: ${applied}`
      : (noPreferenceAsked
        ? 'publish codec order left to the browser'
        : `publish codec preference NOT applied (wanted ${publishSettings.videoCodec})`),
    { requested: publishSettings.videoCodec, applied }
  );

  // The stamp is written after encode, on the sender; the track is never touched.
  if (publishSettings.latencyProbe)
    keepUntilStopped(peerConnection,
      startSenderStamp(sender, { videoCodec: publishSettings.videoCodec }));

  return sender;
};

// Detach handlers before closing so the stale PC/WS don't fire "closed" /
// error events into the next attempt's callbacks
const tearDownConnection = (peerConnection, websocket) => {
  // Release only this attempt's connection, so a late failure cannot deregister a newer one.
  releasePeerConnection('publish', peerConnection);
  releaseSessionHandles(peerConnection);
  if (peerConnection) {
    peerConnection.onicecandidate = null;
    peerConnection.onnegotiationneeded = null;
    peerConnection.onconnectionstatechange = null;
    try { peerConnection.close(); } catch { /* already closed or closing */ }
  }
  if (websocket) {
    try { websocket.close(); } catch { /* already closed or closing */ }
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
    loggedFetch(whipSessionUrl, { method: "DELETE" }).catch(() => {});
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

      // An engine that doesn't understand the offer (see NegotiationFailureUtils) never replies, so
      // without this the page would sit in "starting" forever. Only the initial offer is guarded: an
      // ICE restart has a session behind it and its own recovery.
      if (payload.messageType === "OFFER") {
        armAnswerTimeout(session, () => {
          // Something else already ended this attempt (and reported it) if the socket is gone.
          if (websocket.readyState !== WebSocket.OPEN) return;
          tearDownConnection(peerConnection, websocket);
          if (callbacks.onError)
            callbacks.onError({ message: getAnswerTimeoutMessage(publishSettings) });
        });
      }
    })
    .catch((error) => {
      const newError = { message: "Peer connection failed", ...error };
      peerConnectionOnError(newError, callbacks);
    });
}

const peerConnectionOnError = (error, callbacks) => {
  // Not console.log(error); see websocketOnError.
  const message = describeSignalingError(error);
  logEvent('error', 'pc', 'publish peer connection failed', message);
  if (callbacks.onError)
    callbacks.onError({ message: 'PeerConnection Error: ' + message });
}

// Websocket Functions

const websocketOnOpen = (publishSettings, websocket, callbacks, session) => {

  let peerConnection;
  const pendingCandidates = [];

  try {

    addIceServers(publishSettings, session);
    armEncodedStreams(session, publishSettings);
    peerConnection = new RTCPeerConnection(session.peerConnectionConfig);
    instrumentPeerConnection(peerConnection, 'publish');

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
      // This sends the initial offer; afterwards only for a restart we asked for - see
      // consumeIceRestartOffer.
      if (session.negotiationEstablished && !consumeIceRestartOffer(peerConnection)) return;
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

    // The data channels must be created before the first offer (we never renegotiate). The
    // publisher opens whichever of chat / captions are enabled up front.
    // The clock responder rides in here, so closing this is what releases its channel.
    session.dataChannels = keepUntilStopped(
      peerConnection, attachPublishDataChannels(peerConnection, callbacks, publishSettings));

    let audioSender = undefined;
    let videoSender = undefined;
    if (publishSettings.audioTrack != null) {
      keepUntilStopped(peerConnection, instrumentTrack(publishSettings.audioTrack, 'publish', 'outbound'));
      audioSender = peerConnection.addTrack(publishSettings.audioTrack);
    }
    videoSender = addVideoSender(peerConnection, publishSettings.videoTrack, publishSettings);


    // encodedInsertableStreams covers the whole connection, so audio frames must be passed on.
    if (publishSettings.latencyProbe && audioSender)
      passThroughEncodedFrames(audioSender, 'publish audio sender');

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

  // Any status reply means the engine saw the offer; only silence is a timeout.
  clearAnswerTimeout(session);

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
        "sdp": ensureApplicationSectionInAnswer(peerConnection.localDescription.sdp, msgJSON.message.sdp),
        "type": "answer"
      }

      console.log("Setting remote description SDP:");
      console.log(sdpData.sdp);

      peerConnection
        .setRemoteDescription(new RTCSessionDescription(sdpData))
        .then(() => {
          /*
           * The flag first. reportRejectedVideo catches around its warning callback, so a
           * throw there cannot land in the shared catch as a connection failure and turn
           * the next re-offer into an initial offer instead of an ICE restart.
           */
          session.negotiationEstablished = true;
          reportRejectedVideo(sdpData && sdpData.sdp, publishSettings, callbacks, session);
          // Order matters. A refused video m-line has no simulcast attribute in it either,
          // so testing simulcast first blames simulcast for a codec problem. The rejection
          // has already been reported above; there is nothing more to say here.
          if (publishSettings.useSimulcast
              && !videoWasRejected(sdpData && sdpData.sdp)
              && !simulcastAcceptedInAnswer(sdpData.sdp)) {
            reportSimulcastRejection({
              callbacks, peerConnection, websocket
            });
            return;
          }
          session.dataChannels = handleRefusedDataChannels(sdpData.sdp, session.dataChannels, callbacks);
        })
        .catch((error) => { peerConnectionOnError(error, callbacks); });
    }
  }
}

const websocketOnError = (error, callbacks) => {
  /*
   * Not console.log(error): the event references the socket and window, and the console keeps
   * that whole graph alive for expansion. The log panel takes a string.
   */
  const message = describeSignalingError(error);
  logEvent('error', 'ws', 'publish signalling failed', message);
  if (callbacks.onError)
    callbacks.onError({ message: 'Websocket Error: ' + message });
}

// startPublish
// callbacks:
// - onError({message:''})
// - onConnectionStateChange({connected:boolean})
// - onSetPeerConnection({peerConnection:obj})
// - onSetWebsocket({websocket:obj})
// - onSetSenders({audioSender:obj,videoSender:obj})
// - onWarning({message:string})

const startPublish = (publishSettings, websocket, callbacks) =>
{
  try {
    
    const session = {
        sessionId: '[empty]',
        // false until the initial offer/answer completes; afterwards every re-offer is an ICE restart.
        negotiationEstablished: false,
        // A rejected video m-line is reported once, not on every ICE-restart answer.
        videoRejectionReported: false,
        // handle to the enabled data channels, cleared once the server refuses them.
        dataChannels: null,
        // pending timer waiting for the answer to the initial offer, see NegotiationFailureUtils.
        answerTimeout: null,
        peerConnectionConfig: {iceServers: []}
      };

    validateParams(publishSettings);

    if (publishSettings.useWhip) {
      startPublishWhip(publishSettings, session, callbacks);
    }
    else {
      
      if (websocket == null) {
        websocket = instrumentWebSocket(new WebSocket(publishSettings.signalingURL + "?webrtcImplementation=v2"), 'publish');
      }

      if (websocket != null) {
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
          clearAnswerTimeout(session);
          // Errors that arrive because we are shutting down are not failures to report.
          if (isWebSocketClosing(websocket)) return;
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
    armEncodedStreams(session, publishSettings);
    peerConnection = new RTCPeerConnection(session.peerConnectionConfig);
    instrumentPeerConnection(peerConnection, 'publish');

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
      // Initial WHIP offer is sent manually below; otherwise only for a restart we asked for.
      if (!negotiationEstablished || !sessionUrl || !consumeIceRestartOffer(peerConnection)) return;
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

      await loggedFetch(sessionUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/trickle-ice-sdpfrag", ...getAuthHeaders(publishSettings.authToken) },
        body: candidate
      });
    };

    let audioSender;
    let videoSender;

    if (publishSettings.audioTrack != null) {
      keepUntilStopped(peerConnection, instrumentTrack(publishSettings.audioTrack, 'publish', 'outbound'));
      audioSender = peerConnection.addTrack(publishSettings.audioTrack);
    }

    // See the WebSocket path above: with the probe on, an untouched encoded stream sends nothing.
    if (publishSettings.latencyProbe && audioSender)
      passThroughEncodedFrames(audioSender, 'publish audio sender');

    videoSender = addVideoSender(peerConnection, publishSettings.videoTrack, publishSettings);

    if (callbacks.onSetSenders)
      callbacks.onSetSenders({ audioSender, videoSender });

    // Same as the WebSocket path: create the channels before the offer so their m-lines are
    // negotiated up front (we never renegotiate). onnegotiationneeded is gated until
    // negotiationEstablished, so creating them here does not trigger a spurious WHIP re-offer.
    const dataChannels = attachPublishDataChannels(peerConnection, callbacks, publishSettings);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const offerSdp = publishSettings.useSimulcast
      ? ensureSimulcastSDP(peerConnection.localDescription.sdp, publishSettings.simulcastRenditions)
      : peerConnection.localDescription.sdp;

    console.log("Sending WHIP Offer:");
    console.log(offerSdp);

    const whipUrl = `${publishSettings.signalingURL}/${publishSettings.applicationName}/${publishSettings.streamName}/whip`;

    const response = await loggedFetch(whipUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp", ...getAuthHeaders(publishSettings.authToken) },
      body: offerSdp
    });

    if (!response.ok) {
      throw new Error(getWhipWhepFailureMessage("WHIP", response.status, publishSettings));
    }

    const locationHeader = response.headers.get("Location");
    sessionUrl = new URL(locationHeader, publishSettings.signalingURL).toString();

    for (const candidate of pendingCandidates) {
      await loggedFetch(sessionUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/trickle-ice-sdpfrag", ...getAuthHeaders(publishSettings.authToken) },
        body: candidate
      });
    }
    pendingCandidates.length = 0;

    const answerSDP = ensureApplicationSectionInAnswer(
      peerConnection.localDescription.sdp,
      await response.text()
    );

    console.log("Received WHIP Answer:");
    console.log(answerSDP);

    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: answerSDP
    });
    negotiationEstablished = true; // from here, onnegotiationneeded means an ICE restart

    // Same ordering as the WebSocket path: a refused video line is a codec problem, and
    // the missing simulcast attribute is a symptom of it rather than a separate fault.
    reportRejectedVideo(answerSDP, publishSettings, callbacks, session);

    if (publishSettings.useSimulcast
        && !videoWasRejected(answerSDP)
        && !simulcastAcceptedInAnswer(answerSDP)) {
      reportSimulcastRejection({
        callbacks, peerConnection, whipSessionUrl: sessionUrl
      });
      return;
    }

    handleRefusedDataChannels(answerSDP, dataChannels, callbacks);

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
