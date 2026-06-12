// Utilities

import { addIceServers } from "../utils/IceServersUtils";
import { validateParams } from "../utils/ValidationUtils";

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
      const payload = {
        messageType: "OFFER",
        action: "PUBLISH",
        sdp: peerConnection.localDescription.sdp,
        applicationName: streamInfo.applicationName,
        streamName: streamInfo.streamName,
        connectionId: streamInfo.sessionId,
      };
      console.log("Sending offer:", JSON.stringify(payload));
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

    let audioSender = undefined;
    let videoSender = undefined;
    if (publishSettings.audioTrack != null)
      audioSender = peerConnection.addTrack(publishSettings.audioTrack);
    if (publishSettings.videoTrack != null)
      videoSender = peerConnection.addTrack(publishSettings.videoTrack);

    if (callbacks.onSetSenders)
      callbacks.onSetSenders({ audioSender: audioSender, videoSender: videoSender });

    websocket.addEventListener("message", (event) => { websocketOnMessage(event, websocket, peerConnection, callbacks, session, pendingCandidates); });

  }
  catch (e) {
    websocketOnError(e, callbacks);
  }
  if (callbacks.onSetPeerConnection)
    callbacks.onSetPeerConnection({ peerConnection: peerConnection });
}

const websocketOnMessage = (event, websocket, peerConnection, callbacks, session, pendingCandidates) => {

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
  const pendingCandidates = [];

  try {

    addIceServers(publishSettings, session);
    peerConnection = new RTCPeerConnection(session.peerConnectionConfig);

    peerConnection.onconnectionstatechange = (event) => {
      const connected = event.currentTarget.connectionState === "connected";
      if (callbacks.onConnectionStateChange)
        callbacks.onConnectionStateChange({ connected });
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

    if (publishSettings.videoTrack != null)
      videoSender = peerConnection.addTrack(publishSettings.videoTrack);

    if (callbacks.onSetSenders)
      callbacks.onSetSenders({ audioSender, videoSender });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    console.log("Sending WHIP Offer:");
    console.log(peerConnection.localDescription.sdp);

    const whipUrl = `${publishSettings.signalingURL}/${publishSettings.applicationName}/${publishSettings.streamName}/whip`;

    const response = await fetch(whipUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp", ...getAuthHeaders(publishSettings.authToken) },
      body: peerConnection.localDescription.sdp
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
