import { mungeSDPPlay } from './mungeSDP';
import stopPlay from './stopPlay';

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

// PeerConnection Functions

const peerConnectionSetRemoteDescriptionSuccess = (description, playSettings, websocket, peerConnection, callbacks) => {

  peerConnection
    .setLocalDescription(description)
    .then(() => {
      websocket.send('{"direction":"play", "command":"sendResponse", "streamInfo":' + JSON.stringify(getStreamInfo(playSettings)) + ', "sdp":' + JSON.stringify(description) + ', "userData":' + JSON.stringify(getUserData(playSettings)) + '}');
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

    websocketSendPlayGetOffer (playSettings, websocket);

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

  if (msgStatus === 514) // repeater stream not ready
  {
    repeaterRetryCount++;

    if (repeaterRetryCount < 10) {
      setTimeout(websocketSendPlayGetOffer(playSettings, websocket), 500);
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

      msgJSON.sdp.sdp = mungeSDPPlay(msgJSON.sdp.sdp);

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

const websocketSendPlayGetOffer = (playSettings, websocket) => {
  websocket.send('{"direction":"play", "command":"getOffer", "streamInfo":' + JSON.stringify(getStreamInfo(playSettings)) + ', "userData":' + JSON.stringify(getUserData(playSettings)) + '}');
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