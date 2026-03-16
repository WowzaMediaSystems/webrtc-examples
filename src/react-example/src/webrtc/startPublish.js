// Utilities

const getStreamInfo = (publishSettings, session) => {
  return {
    applicationName: publishSettings.applicationName,
    streamName: publishSettings.streamName,
    sessionId: session.sessionId
  };
}

const getUserData = (publishSettings) => {
  return { param1: 'value1' };
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

  try {
    peerConnection = new RTCPeerConnection();

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        const candidatePayload = {
          messageType: "CANDIDATE",
          action: "PUBLISH",
          applicationName: publishSettings.applicationName,
          streamName: publishSettings.streamName,
          connectionId: session.sessionId,
          candidate: event.candidate.candidate,
        };
        console.log('Sending ICE candidate:', JSON.stringify(candidatePayload));
        websocket.send(JSON.stringify(candidatePayload));
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
        console.log('Sending end of candidates:', JSON.stringify(endOfCandidatesPayload));
        websocket.send(JSON.stringify(endOfCandidatesPayload));
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

    websocket.addEventListener("message", (event) => { websocketOnMessage(event, publishSettings, peerConnection, callbacks, session); });

  }
  catch (e) {
    websocketOnError(e, callbacks);
  }
  if (callbacks.onSetPeerConnection)
    callbacks.onSetPeerConnection({ peerConnection: peerConnection });
}

const websocketOnMessage = (event, publishSettings, peerConnection, callbacks, session) => {

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

const startPublish = (publishSettings, websocket, callbacks) => {
  try {
    if (publishSettings.useWhip) {
      startPublishWhip();
    } else {
      if (publishSettings.applicationName.length === 0) {
        throw { message: "Application name required" }
      }
      if (publishSettings.streamName.length === 0) {
        throw { message: "Stream name required" }
      }

      const session = {
        sessionId: '[empty]'
      };

      if (websocket == null) {
        websocket = new WebSocket(publishSettings.signalingURL + "?webrtcImplementation=modern");
      }

      if (websocket != null) {
        console.log(publishSettings);
        websocket.binaryType = 'arraybuffer';

        websocket.addEventListener("open", () => { websocketOnOpen(publishSettings, websocket, callbacks, session); });
        websocket.addEventListener("error", (error) => { websocketOnError(error, callbacks); });

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

const startPublishWhip = () => {
  console.log("Not implemented");
}

export default startPublish;