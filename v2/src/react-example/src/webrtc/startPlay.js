import stopPlay from './stopPlay';
import getSecureToken from './SecureToken';
import { validateParams } from '../utils/ValidationUtils';
import { addIceServers } from '../utils/IceServersUtils';

const getAuthHeaders = (authToken) =>
  authToken ? { "Authorization": `Bearer ${authToken}` } : {};


// Utilities



const getStreamInfo = (playSettings, session) => {

  return {
    applicationName:playSettings.applicationName,
    streamName:playSettings.streamName,
    sessionId: session.sessionId
  };
}

const getSecureTokenData = (playSettings) => {
  // Only return secure token data if secret is provided
  if (!playSettings.secret) {
    return null;
  }

  return {
    secret: playSettings.secret,
    timeout: playSettings.timeout ? parseInt(playSettings.timeout) : 0,
    prefix: playSettings.prefix || 'wowzatoken',
    isIp: playSettings.isIp || false,
    ip: playSettings.ip || '',
    applicationName: playSettings.applicationName,
    streamName: playSettings.streamName
  };
}

// PeerConnection Functions

const peerConnectionOnError = (error, callbacks) => {
  console.log('peerConnectionOnError');
  console.log(error);
  if (callbacks.onError)
    callbacks.onError({message:'PeerConnection Error: '+error.message});
}


// Websocket Functions

const websocketOnOpen = async (playSettings, websocket, callbacks, session) => {

  let peerConnection;
  const pendingCandidates = [];
  const secureTokenData = getSecureTokenData(playSettings);
  const secureToken = await getSecureToken(secureTokenData);
  
  try {
    addIceServers(playSettings, session);
    peerConnection = new RTCPeerConnection(session.peerConnectionConfig);
    peerConnection.addTransceiver('video', { direction: 'recvonly' });
    peerConnection.addTransceiver('audio', { direction: 'recvonly' });
    peerConnection.ontrack = (event) => {
      if (callbacks.onPeerConnectionOnTrack)
        callbacks.onPeerConnectionOnTrack(event);
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        const candidatePayload = {
          messageType: "CANDIDATE",
          action: "VIEW",
          applicationName: playSettings.applicationName,
          streamName: playSettings.streamName,
          connectionId: session.sessionId,
          candidate: event.candidate.candidate,
        };

        if (secureToken) {
          candidatePayload.secureToken = secureToken;
        }

        if (session.sessionId === '[empty]') {
          pendingCandidates.push(candidatePayload);
        } else {
          console.log('Sending ICE candidate:', JSON.stringify(candidatePayload));
          websocket.send(JSON.stringify(candidatePayload));
        }
      } else {
        const endOfCandidatesPayload = {
          messageType: "CANDIDATE",
          action: "VIEW",
          applicationName: playSettings.applicationName,
          streamName: playSettings.streamName,
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

    peerConnection.onconnectionstatechange = (event) => {
      if (event.currentTarget.connectionState === 'connected') {
        if (callbacks.onConnectionStateChange)
          callbacks.onConnectionStateChange({connected:true});
      } else {
        if (callbacks.onConnectionStateChange)
          callbacks.onConnectionStateChange({connected:false});
      }
    }

    websocket.addEventListener("message", (event) => { websocketOnMessage(event, playSettings, peerConnection, websocket, callbacks, session, pendingCandidates); });

    websocketSendPlayGetOffer(playSettings, websocket, peerConnection, callbacks, session);

  }
  catch (e) {
    websocketOnError(e, callbacks);
  }
  if (callbacks.onSetPeerConnection)
    callbacks.onSetPeerConnection({peerConnection:peerConnection});
}

const websocketOnMessage = (event, playSettings, peerConnection, websocket, callbacks, session, pendingCandidates) => {

  let msgJSON = JSON.parse(event.data);
  console.log(`Websocket Response: ${JSON.stringify(msgJSON)}`);

  if (msgJSON.messageType?.toLowerCase() === "candidate") {
    peerConnection.addIceCandidate(new RTCIceCandidate({ candidate: msgJSON.candidate, sdpMLineIndex: 0 }));
    return;
  }

  let msgStatus = Number(msgJSON['statusCode']);
  console.log(`Status: ${msgStatus}`);

  if (msgStatus === 514 || msgStatus === 504) {
    session.repeaterRetryCount++;

    if (session.repeaterRetryCount < 10) {
      setTimeout(() => { websocketSendPlayGetOffer(playSettings, websocket, peerConnection, callbacks) }, 1000);
    } else {
      websocketOnError({message:'Live stream repeater timeout: ' + playSettings.streamName}, callbacks);
      stopPlay(playSettings, peerConnection, websocket, callbacks);
    }

  } else if (msgStatus !== 200) {

    websocketOnError({message:msgJSON['statusDescription']}, callbacks);
    stopPlay(playSettings, peerConnection, websocket, callbacks);

  } else {
    if (msgJSON.message) {
      const message = msgJSON.message;
      if (message.connectionId) {
        session.sessionId = message.connectionId;

        for (const candidate of pendingCandidates) {
          candidate.connectionId = session.sessionId;
          console.log('Sending queued ICE candidate:', JSON.stringify(candidate));
          websocket.send(JSON.stringify(candidate));
        }
        pendingCandidates.length = 0;
      }
      if (message.sdp) {
        console.log("SDP Data: " + message.sdp);
        let sdpData = {
          "sdp" : message.sdp,
          "type": "answer"
        }
        peerConnection
          .setRemoteDescription(new RTCSessionDescription(sdpData))
          .then(() => {
            console.log("Remote Description Set Successfully.");
          })
          .catch((err) => peerConnectionOnError(err, callbacks));
      }
    }
  }
}

const websocketOnError = (error, callbacks) => {
  console.log('Websocket Error');
  console.log(error);
  if (callbacks.onError)
    callbacks.onError({message:'Websocket Error: '+error.message});
}

const createOfferPayload = (playSettings, session, secureToken = null) => {
  const streamInfo = getStreamInfo(playSettings, session);
  const offerPayload = {
      messageType: "OFFER",
      action: "VIEW",
      applicationName: streamInfo.applicationName,
      streamName: streamInfo.streamName,
      connectionId: streamInfo.sessionId,
      // userData: getUserData(playSettings), Do we need this?
    };
    if (secureToken) {
      offerPayload.secureToken = secureToken;
    }
    return offerPayload;
}

const websocketSendPlayGetOffer = async (playSettings, websocket, peerConnection, callbacks, session) => {
  try {
    const secureTokenData = getSecureTokenData(playSettings);
    const secureToken = await getSecureToken(secureTokenData);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    console.log('Local SDP:', peerConnection.localDescription.sdp);

    const offerPayload = createOfferPayload(playSettings, session, secureToken);
    offerPayload.sdp = peerConnection.localDescription.sdp;

    console.log("sendPlayGetOffer: " + JSON.stringify(offerPayload));
    websocket.send(JSON.stringify(offerPayload));
  } catch (error) {
    console.error('Error generating secure token:', error);
    if (callbacks.onError) {
      callbacks.onError({ message: 'Failed to generate secure token: ' + error.message });
    }
  }
}

// startPlay
// callbacks:
// - onError({message:''})
// - onPeerConnectionOnTrack({event:obj})
// - onConnectionStateChange({connected:boolean})
// - onSetPeerConnection({peerConnection:obj})
// - onSetWebsocket({websocket:obj})

const startPlay = (playSettings, callbacks) => 
{
  try {
    validateParams(playSettings);

    const session = {
      sessionId: '[empty]',
      repeaterRetryCount: 0,
      peerConnectionConfig: {iceServers: []}
    };

    if (playSettings.useWhep) 
    {
      startPlayWhep(playSettings, session, callbacks);
    } else {
      
      const websocket = new WebSocket (playSettings.signalingURL + "?webrtcImplementation=v2");

      if (websocket != null)
      {

        websocket.binaryType = 'arraybuffer';

        websocket.addEventListener ("open", () => { websocketOnOpen(playSettings, websocket, callbacks, session); });
        websocket.addEventListener ("error", (error) => { websocketOnError(error, callbacks); });

        if (callbacks.onSetWebsocket)
          callbacks.onSetWebsocket({websocket:websocket});
      }
    }
  }
  catch (e)
  {
    if (callbacks.onError)
      callbacks.onError(e);
  }

}

const startPlayWhep = async (playSettings, session, callbacks) => {
  let peerConnection;
  let sessionUrl;
  const pendingCandidates = [];

  try {
    addIceServers(playSettings, session);
    peerConnection = new RTCPeerConnection(session.peerConnectionConfig);

    peerConnection.addTransceiver("video", { direction: "recvonly" });
    peerConnection.addTransceiver("audio", { direction: "recvonly" });

    peerConnection.ontrack = (event) => {
      if (callbacks.onPeerConnectionOnTrack) {
        callbacks.onPeerConnectionOnTrack(event);
      }
    };

    peerConnection.onconnectionstatechange = (event) => {
      if (callbacks.onConnectionStateChange) {
        callbacks.onConnectionStateChange({
          connected: event.currentTarget.connectionState === "connected"
        });
      }
    };

    peerConnection.onicecandidate = async (event) => {
      const candidate = event.candidate ? event.candidate.candidate : "";

      if (!sessionUrl) {
        pendingCandidates.push(candidate);
        return;
      }

      await fetch(sessionUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/trickle-ice-sdpfrag", ...getAuthHeaders(playSettings.authToken) },
        body: candidate
      });
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const whepUrl = `${playSettings.signalingURL}/${playSettings.applicationName}/${playSettings.streamName}/whep`;

    const response = await fetch(whepUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp", ...getAuthHeaders(playSettings.authToken) },
      body: peerConnection.localDescription.sdp
    });

    if (!response.ok) {
      throw new Error(`WHEP request failed: ${response.status}`);
    }

    const locationHeader = response.headers.get("Location");
    if (locationHeader) {
      const baseUrl = new URL(whepUrl);
      sessionUrl = new URL(locationHeader, baseUrl).toString();
      playSettings._whepSessionUrl = sessionUrl;

      for (const candidate of pendingCandidates) {
        await fetch(sessionUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/trickle-ice-sdpfrag", ...getAuthHeaders(playSettings.authToken) },
          body: candidate
        });
      }
      pendingCandidates.length = 0;
    }

    const answerSdp = await response.text();

    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: answerSdp
    });

    if (callbacks.onSetPeerConnection)
      callbacks.onSetPeerConnection({ peerConnection });

  } catch (error) {
    if (callbacks.onError)
      callbacks.onError(error);
  }
};
export default startPlay;