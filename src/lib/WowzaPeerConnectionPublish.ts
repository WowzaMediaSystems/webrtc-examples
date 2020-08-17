/*
 * This code and all components (c) Copyright 2019-2020, Wowza Media Systems, LLC. All rights reserved.
 * This code is licensed pursuant to the BSD 3-Clause License.
 * 
 * Typescript migration by @farandal - Francisco Aranda - farandal@gmail.com - http://linkedin.com/in/farandal
 * 
 */

import {IStreamInfo,IMediaInfo} from "./interfaces";


interface IProps {
  wsURL: any;
  localStream: MediaStream;
  streamInfo?:IStreamInfo,
  mediaInfo?:{
    videoBitrate: string,
    audioBitrate: string,
    videoFrameRate: string,
    videoCodec: string,
    audioCodec: string
  },
  userData: any;
  mungeSDP: Function; //  mungeSDP: function (sdpStr, mungeData)
  onconnectionstatechange: Function;
  onstop: Function;
  onerror: Function;
  onstats: Function;

}


// munge plug-in
let mungeSDP: Function;

// callbacks
let onconnectionstatechange: Function;
let onstop: Function;
let onerror: Function;

// local state
let localStream:MediaStream;
let streamInfo:IStreamInfo;
let mediaInfo:IMediaInfo = {
  videoBitrate: "",
  audioBitrate: "",
  videoFrameRate: "30",
  videoCodec: "42e01f",
  audioCodec: "opus"
}
let userData:any;
let statsInterval:ReturnType<typeof setTimeout>;

let wsConnection:WebSocket;
let peerConnection:RTCPeerConnection;
//let peerConnectionConfig:{iceServers: any[]} = { 'iceServers': [] };
let peerConnectionConfig:{iceServers: any[]} = null;
let videoSender: RTCRtpSender = undefined;
let audioSender: RTCRtpSender = undefined;


const gotIceCandidate = (event:RTCPeerConnectionIceEvent) => {
  if (event.candidate != null) {
    console.log('WowzaPeerConnectionPublish.gotIceCandidate: ' + JSON.stringify({ 'ice': event.candidate }));
  }
}

const gotDescription = (description: RTCSessionDescriptionInit) => {
  console.log("WowzaPeerConnectionPublish.gotDescription: SDP:");
  console.log(description.sdp+'');

  // TODO! improve mungeData Interface
  let mungeData:any = new Object();

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
// TODO! onstats type should be (value: RTCStatsReport) => RTCStatsReport | PromiseLike<RTCStatsReport>'.
const createOnStats = (onStats:any) => {
  return () => {
    if (peerConnection != null)
    {
      peerConnection.getStats(null)
      .then(onStats, err => console.log(err));
    }
  }
}

const wsConnect = (url:string) => {
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
    videoSender = undefined;
    audioSender = undefined;

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

    // Experimental API, no type defined for event in mozilla
    peerConnection.onnegotiationneeded = (event:any) => {
      // peerConnection createOffer, doesn not allo error Handler, consider implementing try catch strategy.
      // gotDescription returns void
      // instead RTCOfferOptions object must be passed. 
      // TODO! 
      //peerConnection.createOffer(gotDescription);
      peerConnection.createOffer();
    }

    let localTracks = localStream.getTracks();
    for (let localTrack in localTracks) {
      let sender = peerConnection.addTrack(localTracks[localTrack], localStream);
      if (localTracks[localTrack].kind === 'audio')
      {
        audioSender = sender;
      }
      else if (localTracks[localTrack].kind === 'video')
      {
        videoSender = sender;
      }
    }
  }

  wsConnection.onmessage =  (evt:MessageEvent) => {
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

        let mungeData:any = new Object();

        if (mediaInfo.audioBitrate !== undefined)
          mungeData.audioBitrate = mediaInfo.audioBitrate;
        if (mediaInfo.videoBitrate !== undefined)
          mungeData.videoBitrate = mediaInfo.videoBitrate;

        console.log("WowzaPeerConnectionPublish.wsConnection.onmessage: Setting remote description SDP:");
        console.log(sdpData.sdp);

        // setRemoteDescription does not allow second argumment nor errorHandler
        /* peerConnection
          .setRemoteDescription(new RTCSessionDescription(sdpData),
            () => { },
            errorHandler
          );*/

          peerConnection
          .setRemoteDescription(new RTCSessionDescription(sdpData));
      }

      var iceCandidates = msgJSON['iceCandidates'];
      if (iceCandidates !== undefined) {
        for (var index in iceCandidates) {
          console.log('WowzaPeerConnectionPublish.wsConnection.iceCandidates: ' + iceCandidates[index]);
          peerConnection.addIceCandidate(new RTCIceCandidate(iceCandidates[index]));
        }
      }
    }
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

const replaceTrack = (type:string, newTrack:MediaStreamTrack) =>
{
  if (peerConnection != null)
  {
    console.log(peerConnection);
    if (type === 'audio')
    {
      if (audioSender != null)
      {
        audioSender.replaceTrack(newTrack);
      }
      else
      {
        audioSender = peerConnection.addTrack(newTrack);
      }
    }
    else if (type === 'video')
    {
      if (videoSender != null)
      {
        videoSender.replaceTrack(newTrack);
      }
      else
      {
        videoSender = peerConnection.addTrack(newTrack);
      }
    }
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

const start = (props:IProps) =>
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

  if (props.onstats != null)
  {
    statsInterval = setInterval(createOnStats(props.onstats),5000);
  }

  if (peerConnection == null)
  {
    if (wsConnection != null)
      wsConnection.close();
    wsConnection = null;

    console.log("WowzaPeerConnectionPublish.start: wsURL:" + wsURL + " streamInfo:" + JSON.stringify(streamInfo));
    wsConnect(wsURL);
  }
  else
  {
    console.log('WowzaPeerConnectionPublish.start: peerConnection already in use, not starting');
  }
}

const stop = () =>
{
  if (peerConnection != null)
    peerConnection.close();
  peerConnection = undefined;
  videoSender = undefined;
  audioSender = undefined;
  
  if (wsConnection != null)
    wsConnection.close();
  wsConnection = undefined;

  if (statsInterval != null)
  {
    clearInterval(statsInterval);
    statsInterval = undefined;
  }
  if (onstop != null)
  {
    onstop();
  }
}

function isStarted()
{
  return (peerConnection != null);
}

function errorHandler(error:any) {
  console.trace();
  if (onerror != null)
  {
    onerror(error);
  }
}

export default {
  connect: wsConnect,
  start: start,
  stop: stop,
  isStarted: isStarted,
  replaceTrack: replaceTrack
};