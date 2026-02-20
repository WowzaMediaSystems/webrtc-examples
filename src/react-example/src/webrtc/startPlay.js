import stopPlay from './stopPlay';
import getSecureToken from './SecureToken';

// Utilities

let repeaterRetryCount = 0;
let sessionId = '[empty]';

const getStreamInfo = (playSettings) => {

  return {
    applicationName:playSettings.applicationName,
    streamName:playSettings.streamName,
    sessionId:sessionId
  };
}

const getUserData = (playSettings) => {

  return { param1: 'value1' };
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

const peerConnectionSetRemoteDescriptionSuccess = (description, playSettings, websocket, peerConnection, callbacks) => {

  peerConnection
    .setLocalDescription(description)
    .then(() => {
      const payload = createOfferPayload(playSettings);
      if (description) {
        payload.sdp = description;
      }
      websocket.send(JSON.stringify(payload));
    })
    .catch((error)=>{
      let newError = {message:"Peer connection failed",...error};
      peerConnectionOnError(newError,callbacks);
    });
}

const peerConnectionOnError = (error, callbacks) => {
  console.log('peerConnectionOnError');
  console.log(error);
  if (callbacks.onError)
    callbacks.onError({message:'PeerConnection Error: '+error.message});
}


// Websocket Functions

const websocketOnOpen = (playSettings, websocket, callbacks) => {

  let peerConnection;
  
  try {
    peerConnection = new RTCPeerConnection();

    peerConnection.ontrack = (event) => {
      if (callbacks.onPeerConnectionOnTrack)
        callbacks.onPeerConnectionOnTrack(event);
    }

    peerConnection.onconnectionstatechange = (event) => {
      if (event.currentTarget.connectionState === 'connected')
      {
        if (callbacks.onConnectionStateChange)
          callbacks.onConnectionStateChange({connected:true});
      }
      else
      {
        if (callbacks.onConnectionStateChange)
          callbacks.onConnectionStateChange({connected:false});
      }
    }

    websocket.addEventListener ("message", (event) => { websocketOnMessage(event, playSettings, peerConnection, websocket, callbacks); });

    websocketSendPlayGetOffer(playSettings, websocket, callbacks);

  }
  catch (e) {
    websocketOnError(e, callbacks);
  }
  if (callbacks.onSetPeerConnection)
    callbacks.onSetPeerConnection({peerConnection:peerConnection});
}

const websocketOnMessage = (event, playSettings, peerConnection, websocket, callbacks) => {

  let msgJSON = JSON.parse(event.data);
  let msgStatus = Number(msgJSON['status']);
  console.log("websocketOnMessage:"+msgStatus);
  console.log(msgJSON);
  if (msgStatus === 514 || msgStatus === 504) // repeater stream not ready
  {
    repeaterRetryCount++;

    if (repeaterRetryCount < 10) {
      setTimeout(() => { websocketSendPlayGetOffer(playSettings, websocket, callbacks) }, 1000);
    } else {
      websocketOnError({message:'Live stream repeater timeout: ' + playSettings.streamName}, callbacks);
      stopPlay(peerConnection, websocket, callbacks);
    }

  } else if (msgStatus !== 200) {

    websocketOnError({message:msgJSON['statusDescription']},callbacks);
    stopPlay(peerConnection, websocket, callbacks);

  } else {

    let streamInfoResponse = msgJSON['streamInfo'];
    if (streamInfoResponse !== undefined) {
      sessionId = streamInfoResponse.sessionId;
    }

    if (msgJSON['sdp'] != null) {

      console.log("SDP Data: " + msgJSON.sdp.sdp);

      peerConnection
      .setRemoteDescription(new RTCSessionDescription(msgJSON.sdp))
      .then(() => peerConnection
        .createAnswer()
        .then((description) => peerConnectionSetRemoteDescriptionSuccess(description, playSettings, websocket, peerConnection, callbacks))
        .catch((err) => peerConnectionOnError(err,callbacks))
      )
      .catch((err) => peerConnectionOnError(err,callbacks));

    }
    let iceCandidates = msgJSON['iceCandidates'];
    if (iceCandidates != null) {
      for (let index in iceCandidates) {
        console.log('iceCandidates: ' + JSON.stringify(iceCandidates[index]));
        peerConnection.addIceCandidate(new RTCIceCandidate(iceCandidates[index]));
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

const createOfferPayload = (playSettings, secureToken = null) => {
  const streamInfo = getStreamInfo(playSettings);
  const offerPayload = {
      messageType: "OFFER",
      applicationName: streamInfo.applicationName,
      streamName: streamInfo.streamName,
      sessionId: streamInfo.sessionId,
      // userData: getUserData(playSettings), Do we need this?
    };
    if (secureToken) {
      offerPayload.secureToken = secureToken;
    }
    return offerPayload;
}

const websocketSendPlayGetOffer = async (playSettings, websocket, callbacks) => {
  try {
    const secureTokenData = getSecureTokenData(playSettings);
    const secureToken = await getSecureToken(secureTokenData);

    const offerPayload = createOfferPayload(playSettings, secureToken);

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

const startPlay = (playSettings, websocket, callbacks) => 
{
  try {
    if (websocket == null)
    {
      websocket = new WebSocket (playSettings.signalingURL);
    }
    if (websocket != null)
    {
      repeaterRetryCount = 0;

      websocket.binaryType = 'arraybuffer';

      websocket.addEventListener ("open", () => { websocketOnOpen(playSettings, websocket, callbacks); });
      websocket.addEventListener ("error", (error) => { websocketOnError(error, callbacks); });

      if (callbacks.onSetWebsocket)
        callbacks.onSetWebsocket({websocket:websocket});
    }
  }
  catch (e)
  {
    if (callbacks.onError)
      callbacks.onError(e);
  }

}
export default startPlay;