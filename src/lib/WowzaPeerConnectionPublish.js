/*
 * This code and all components (c) Copyright 2019-2020, Wowza Media Systems, LLC. All rights reserved.
 * This code is licensed pursuant to the BSD 3-Clause License.
 */

let browserDetails = window.adapter.browserDetails;

// munge plug-in
let mungeSDP = undefined;

// callbacks
let onconnectionstatechange = undefined;
let onstop = undefined;
let onerror = undefined;

// local state
let localStream = undefined;
let streamInfo = undefined;
let mediaInfo = {
  videoBitrate: "",
  audioBitrate: "",
  videoFrameRate: "30",
  videoCodec: "42e01f",
  audioCodec: "opus"
}
let userData = undefined;

let wsConnection = undefined;
let peerConnection = undefined;
let peerConnectionConfig = { 'iceServers': [] };
peerConnectionConfig = null;


function gotIceCandidate(event) {
  if (event.candidate != null) {
    console.log('WowzaPeerConnectionPublish.gotIceCandidate: ' + JSON.stringify({ 'ice': event.candidate }));
  }
}

function gotDescription(description) {
  console.log("WowzaPeerConnectionPublish.gotDescription: SDP:");
  console.log(description.sdp+'');

  let mungeData = new Object();

  if (mediaInfo.audioBitrate != null)
    mungeData.audioBitrate = mediaInfo.audioBitrate;
  if (mediaInfo.videoBitrate != null)
    mungeData.videoBitrate = mediaInfo.videoBitrate;
  if (mediaInfo.videoFrameRate != null)
    mungeData.videoFrameRate = mediaInfo.videoFrameRate;
  if (mediaInfo.videoCodec != null)
    mungeData.videoCodec = mediaInfo.videoCodec;
  if (mediaInfo.audioCodec != null)
    mungeData.audioCodec = mediaInfo.audioCodec;

  if (mungeSDP != null)
  {
    description.sdp = mungeSDP(description.sdp, mungeData);
  }

  console.log("WowzaPeerConnectionPublish.gotDescription: Setting local description SDP: ");
  console.log(description.sdp);


  peerConnection
    .setLocalDescription(description)
    .then(() => wsConnection.send('{"direction":"publish", "command":"sendOffer", "streamInfo":' + JSON.stringify(streamInfo) + ', "sdp":' + JSON.stringify(description) + ', "userData":' + JSON.stringify(userData) + '}'))
    .catch((error)=>{
      let newError = {message:"Peer connection failed",...error};
      errorHandler(newError);
    });
}

// START STATS

function statsInterval() {
  console.log('WowzaPeerConnectionPublish.statsInterval');
  if (peerConnection != null)
  {
    peerConnection.getStats(null)
    .then(showLocalStats, err => console.log(err));
  }
}

function showLocalStats(results) {
  results.forEach(res => {
    console.log(res);
  });
}

function dumpStats(results) {
  let statsString = '';
  results.forEach(res => {
    statsString += '<h3>Report type=';
    statsString += res.type;
    statsString += '</h3>\n';
    statsString += `id ${res.id}<br>`;
    statsString += `time ${res.timestamp}<br>`;
    Object.keys(res).forEach(k => {
      if (k !== 'timestamp' && k !== 'type' && k !== 'id') {
        statsString += `${k}: ${res[k]}<br>`;
      }
    });
  });
  return statsString;
}

// END STATS

function wsConnect(url) {
  try
  {
    wsConnection = new WebSocket(url);
  }
  catch(e)
  {
    errorHandler(e);
    return;
  }

  wsConnection.binaryType = 'arraybuffer';

  wsConnection.onopen = function () {
    console.log("WowzaPeerConnectionPublish.wsConnection.onopen");

    peerConnection = new RTCPeerConnection(peerConnectionConfig);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate != null) {
        console.log('WowzaPeerConnectionPublish.gotIceCandidate: ' + JSON.stringify({ 'ice': event.candidate }));
      }
    }

    peerConnection.onconnectionstatechange = (event) => {
      if (onconnectionstatechange != null)
      {
        onconnectionstatechange(event);
      }
    }

    var localTracks = localStream.getTracks();
    for (let localTrack in localTracks) {
      peerConnection.addTrack(localTracks[localTrack], localStream);
    }

    peerConnection.createOffer(gotDescription, errorHandler);

  }

  wsConnection.onmessage = function (evt) {
    console.log("WowzaPeerConnectionPublish.wsConnection.onmessage: " + evt.data);

    var msgJSON = JSON.parse(evt.data);

    var msgStatus = Number(msgJSON['status']);
    var msgCommand = msgJSON['command'];

    if (msgStatus != 200) {
      stop();
      errorHandler({message:msgJSON['statusDescription']});
    }
    else {
      var sdpData = msgJSON['sdp'];
      if (sdpData !== undefined) {

        var mungeData = new Object();

        if (mediaInfo.audioBitrate !== undefined)
          mungeData.audioBitrate = mediaInfo.audioBitrate;
        if (mediaInfo.videoBitrate !== undefined)
          mungeData.videoBitrate = mediaInfo.videoBitrate;

        console.log("WowzaPeerConnectionPublish.wsConnection.onmessage: Setting remote description SDP:");
        console.log(sdpData.sdp);

        peerConnection
          .setRemoteDescription(new RTCSessionDescription(sdpData),
            () => { },
            errorHandler
          );
      }

      var iceCandidates = msgJSON['iceCandidates'];
      if (iceCandidates !== undefined) {
        for (var index in iceCandidates) {
          console.log('WowzaPeerConnectionPublish.wsConnection.iceCandidates: ' + iceCandidates[index]);
          peerConnection.addIceCandidate(new RTCIceCandidate(iceCandidates[index]));
        }
      }
    }

    if (wsConnection != null)
      wsConnection.close();
    wsConnection = null;
  }

  wsConnection.onclose = function () {
    console.log("WowzaPeerConnectionPublish.wsConnection.onclose");
  }

  wsConnection.onerror = function (error) {
    console.log('wsConnection.onerror');
    console.log(error);
    let message = "Websocket connection failed: " + url;
    console.log(message);
    let newError = {message:message,...error};
    stop();
    errorHandler(newError);
  }
}

// startProps:
//   wsURL: string
//   localStream: MediaStream
//   streamInfo: { applicationName, streamName }
//   mediaInfo: { videoBitrate, audioBitrate, videoFrameRate, videoCodec, audioCodec }
//   userData: any
//   mungeSDP: function (sdpStr, mungeData)
//   onconnectionstatechange: function
//   onerror: function 

function start (props)
{
  let wsURL = props.wsURL;
  localStream = props.localStream;
  if (props.streamInfo != null)
    streamInfo = props.streamInfo;
  if (props.mediaInfo != null)
    mediaInfo = props.mediaInfo;
  if (props.userData != null)
    userData = props.userData;

  if (props.mungeSDP != null)
    mungeSDP = props.mungeSDP;

  if (props.onconnectionstatechange != null)
    onconnectionstatechange = props.onconnectionstatechange;
  if (props.onstop != null)
    onstop = props.onstop;
  if (props.onerror != null)
    onerror = props.onerror;

  if (peerConnection == null)
  {
    console.log("WowzaPeerConnectionPublish.start: wsURL:" + wsURL + " streamInfo:" + JSON.stringify(streamInfo));
    wsConnect(wsURL);
  }
  else
  {
    console.log('WowzaPeerConnectionPublish.start: peerConnection already in use, not starting');
  }
}

function stop ()
{
  if (peerConnection != null)
    peerConnection.close();
  peerConnection = null;

  if (wsConnection != null)
    wsConnection.close();
  wsConnection = null;

  if (onstop != null)
  {
    onstop();
  }
}

function errorHandler(error) {
  console.trace();
  if (onerror != null)
  {
    onerror(error);
  }
}

// To display peer connection stats, uncomment this line
// setInterval(statsInterval,5000);

export default {
  connect: wsConnect,
  start: start,
  stop: stop
};