import stopPlay from './stopPlay';
import getSecureToken from './SecureToken';
import { waitForIceGathering } from '../utils/PeerConnectionUtils';

// Utilities



const getStreamInfo = (playSettings, session) => {

  return {
    applicationName:playSettings.applicationName,
    streamName:playSettings.streamName,
    sessionId: session.sessionId
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
        payload.sdp = description.sdp;
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

const websocketOnOpen = (playSettings, websocket, callbacks, session) => {

  let peerConnection;
  
  try {
    peerConnection = new RTCPeerConnection();
    peerConnection.addTransceiver('video', { direction: 'recvonly' });
    peerConnection.addTransceiver('audio', { direction: 'recvonly' });
    peerConnection.ontrack = (event) => {
      if (callbacks.onPeerConnectionOnTrack)
        callbacks.onPeerConnectionOnTrack(event);
    };

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

    websocket.addEventListener ("message", (event) => { websocketOnMessage(event, playSettings, peerConnection, websocket, callbacks, session); });

    websocketSendPlayGetOffer(playSettings, websocket, peerConnection, callbacks, session);

  }
  catch (e) {
    websocketOnError(e, callbacks);
  }
  if (callbacks.onSetPeerConnection)
    callbacks.onSetPeerConnection({peerConnection:peerConnection});
}

const websocketOnMessage = (event, playSettings, peerConnection, websocket, callbacks, session) => {

  let msgJSON = JSON.parse(event.data);
  console.log(`Websocket Response: ${JSON.stringify(msgJSON)}`);
  let msgStatus = Number(msgJSON['statusCode']);
  console.log(`Status: ${msgStatus}`);
  if (msgStatus === 514 || msgStatus === 504) // repeater stream not ready
  {
    session.repeaterRetryCount++;

    if (session.repeaterRetryCount < 10) {
      setTimeout(() => { websocketSendPlayGetOffer(playSettings, websocket, peerConnection, callbacks) }, 1000);
    } else {
      websocketOnError({message:'Live stream repeater timeout: ' + playSettings.streamName}, callbacks);
      stopPlay(peerConnection, websocket, callbacks);
    }

  } else if (msgStatus !== 200) {

    websocketOnError({message:msgJSON['statusDescription']},callbacks);
    stopPlay(peerConnection, websocket, callbacks);

  } else {
    if (msgJSON.message) {
      const message = msgJSON.message;
      if (message.connectionId) {
        session.sessionId = message.connectionId;
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

    await waitForIceGathering(peerConnection);
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

const waitForIceGathering = (pc) => {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
    } else {
      const checkState = () => {
        if (pc.iceGatheringState === "complete") {
          pc.removeEventListener("icegatheringstatechange", checkState);
          resolve();
        }
      };
      pc.addEventListener("icegatheringstatechange", checkState);
    }
  });
};

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
    
    if (playSettings.useWhep) 
    {
      startPlayWhep(playSettings,callbacks);
    }else
    {
      if (websocket == null)
      {
        websocket = new WebSocket (playSettings.signalingURL + "?webrtcImplementation=modern");
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
  }
  catch (e)
  {
    if (callbacks.onError)
      callbacks.onError(e);
  }

}

const startPlayWhep = async (playSettings, callbacks) => {
  let peerConnection;

  try {
    peerConnection = new RTCPeerConnection();

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

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await waitForIceGathering(peerConnection);

    const whepUrl = `${playSettings.signalingURL}/${playSettings.applicationName}/${playSettings.streamName}/whep`;

    const response = await fetch(whepUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/sdp"
      },
      body: peerConnection.localDescription.sdp
    });

    if (!response.ok) {
      throw new Error(`WHEP request failed: ${response.status}`);
    }

    const answerSdp = await response.text();

    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: answerSdp
    });

    const locationHeader = response.headers.get("Location");
    if (locationHeader) {
      const baseUrl = new URL(whepUrl);
      playSettings._whepSessionUrl = new URL(locationHeader, baseUrl).toString();
    }

    if (callbacks.onSetPeerConnection)
      callbacks.onSetPeerConnection({ peerConnection });

  } catch (error) {
    if (callbacks.onError)
      callbacks.onError(error);
  }
};
export default startPlay;