
// Utilities

import { waitForIceGathering } from "../utils/PeerConnectionUtils";

const getStreamInfo = (publishSettings) => {

  return {
    applicationName:publishSettings.applicationName,
    streamName:publishSettings.streamName,
    sessionId:"[empty]"
  };
}

const getUserData = (publishSettings) => {

  return { param1: 'value1' };
}

// PeerConnection Functions

const peerConnectionCreateOfferSuccess = (description, publishSettings, websocket, peerConnection, callbacks) => {

  console.log("peerConnectionCreateOfferSuccess: SDP:");
  console.log(description.sdp+'');

  let mungeData = {};

  if (publishSettings.audioBitrate != null)
    mungeData.audioBitrate = publishSettings.audioBitrate;
  if (publishSettings.videoBitrate != null)
    mungeData.videoBitrate = publishSettings.videoBitrate;
  if (publishSettings.videoFrameRate != null)
    mungeData.videoFrameRate = publishSettings.videoFrameRate;
  if (publishSettings.videoCodec != null)
    mungeData.videoCodec = publishSettings.videoCodec;
  if (publishSettings.audioCodec != null)
    mungeData.audioCodec = publishSettings.audioCodec;


  console.log("peerConnectionCreateOfferSuccess: Setting local description SDP: ");
  console.log(description.sdp);

  peerConnection
    .setLocalDescription(description)
    .then(() => websocket.send('{"direction":"publish", "command":"sendOffer", "streamInfo":' + JSON.stringify(getStreamInfo(publishSettings)) + ', "sdp":' + JSON.stringify(description) + ', "userData":' + JSON.stringify(getUserData(publishSettings)) + '}'))
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

const websocketOnOpen = (publishSettings, websocket, callbacks) => {

  let peerConnection;

  try {
    peerConnection = new RTCPeerConnection();

    peerConnection.onnegotiationneeded = (event) => {
      peerConnection.createOffer()
      .then((description) => {
        peerConnectionCreateOfferSuccess(description,publishSettings,websocket,peerConnection,callbacks);
      })
      .catch((e)=>{
        peerConnectionOnError(e,callbacks);
      })
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

    let audioSender = undefined;
    let videoSender = undefined;
    if (publishSettings.audioTrack != null)
      audioSender = peerConnection.addTrack(publishSettings.audioTrack);
    if (publishSettings.videoTrack != null)
      videoSender = peerConnection.addTrack(publishSettings.videoTrack);

    if (callbacks.onSetSenders)
      callbacks.onSetSenders({audioSender:audioSender,videoSender:videoSender});

    websocket.addEventListener ("message", (event) => { websocketOnMessage(event, publishSettings, peerConnection, callbacks); });

  }
  catch (e) {
    websocketOnError(e, callbacks);
  }
  if (callbacks.onSetPeerConnection)
    callbacks.onSetPeerConnection({peerConnection:peerConnection});
}

const websocketOnMessage = (event, publishSettings, peerConnection, callbacks) => {

  let msgJSON = JSON.parse(event.data);
  let msgStatus = Number(msgJSON['status']);

  if(msgStatus === 504) {
    // we need to swallow these because they happen as new streams join and we don't want to break the connection over it
    console.log("New stream connecting to Wowza Streaming Engine");
  }else if (msgStatus !== 200) {
    websocketOnError({message:msgJSON['statusDescription']},callbacks);
  }
  else {

    let sdpData = msgJSON['sdp'];
    if (sdpData !== undefined) {

      let mungeData = {};

      if (publishSettings.audioBitrate !== undefined)
        mungeData.audioBitrate = publishSettings.audioBitrate;
      if (publishSettings.videoBitrate !== undefined)
        mungeData.videoBitrate = publishSettings.videoBitrate;

      console.log("Setting remote description SDP:");
      console.log(sdpData.sdp);

      peerConnection
        .setRemoteDescription(new RTCSessionDescription(sdpData),
          () => {},
          (error) => { peerConnectionOnError(error,callbacks); }
        );
    }

    let iceCandidates = msgJSON['iceCandidates'];
    if (iceCandidates !== undefined) {
      for (let index in iceCandidates) {
        console.log('websocketOnMessage.iceCandidates: ' + iceCandidates[index]);
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

// startPublish
// callbacks:
// - onError({message:''})
// - onConnectionStateChange({connected:boolean})
// - onSetPeerConnection({peerConnection:obj})
// - onSetWebsocket({websocket:obj})
// - onSetSenders({audioSender:obj,videoSender:obj})

const validateStreamParams = (publishSettings) => {
  if (!publishSettings.signalingURL)
      throw { message: "WHIP URL required" };

  if (publishSettings.applicationName.length === 0)
    throw { message: "Application name required" };

  if (publishSettings.streamName.length === 0)
    throw { message: "Stream name required" };
}

const startPublish = (publishSettings, websocket, callbacks) =>
{
  try {
    if (publishSettings.useWhip) {
      startPublishWhip(publishSettings, callbacks);
    }
    else {
      validateStreamParams(publishSettings);
      if (websocket == null) {
        websocket = new WebSocket (publishSettings.signalingURL + "?appName=" + publishSettings.applicationName);
      }
      if (websocket != null)
      {
        console.log(publishSettings);
        websocket.binaryType = 'arraybuffer';

        websocket.addEventListener("open", () => { websocketOnOpen(publishSettings, websocket, callbacks); });
        websocket.addEventListener("error", (error) => { websocketOnError(error, callbacks); });

        if (callbacks.onSetWebsocket)
          callbacks.onSetWebsocket({ websocket: websocket });
      }
    }
  }
  catch (e)
  {
    if (callbacks.onError)
      callbacks.onError(e);
  }

}

const startPublishWhip = async (publishSettings, callbacks) => {
  let peerConnection;
  let sessionUrl;

  try {
    validateStreamParams(publishSettings);

    peerConnection = new RTCPeerConnection();

    peerConnection.onconnectionstatechange = (event) => {
      const connected = event.currentTarget.connectionState === "connected";
      if (callbacks.onConnectionStateChange)
        callbacks.onConnectionStateChange({ connected });
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

    await waitForIceGathering(peerConnection);

    console.log("Sending WHIP Offer:");
    console.log(peerConnection.localDescription.sdp);

    const whipUrl = `${publishSettings.signalingURL}/${publishSettings.applicationName}/${publishSettings.streamName}/whip`

    const response = await fetch(whipUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/sdp"
      },
      body: peerConnection.localDescription.sdp
    });

    if (!response.ok) {
      throw { message: `WHIP failed: ${response.status}` };
    }

    const locationHeader = response.headers.get("Location");
    sessionUrl = new URL(locationHeader, publishSettings.signalingURL).toString();

    const answerSDP = await response.text();

    console.log("Received WHIP Answer:");
    console.log(answerSDP);

    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: answerSDP
    });

    if (callbacks.onSetPeerConnection)
      callbacks.onSetPeerConnection({ peerConnection });

    // Store session URL for deleting on stop
    peerConnection._whipSessionUrl = sessionUrl;

  } catch (e) {
    console.log(e.message)
    if (callbacks.onError)
      callbacks.onError(e);
  }
};


export default startPublish;
