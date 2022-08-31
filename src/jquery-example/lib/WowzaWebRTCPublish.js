/*
 * This code and all components (c) Copyright 2019-2020, Wowza Media Systems, LLC. All rights reserved.
 * This code is licensed pursuant to the BSD 3-Clause License.
 */

import mungeSDPPublish from './WowzaMungeSDP.js';
import WowzaPeerConnectionPublish from './WowzaPeerConnectionPublish.js';
import SoundMeter from './SoundMeter.js';

window.AudioContext = window.AudioContext || window.webkitAudioContext || false;

let state = {
  ready:false,
  connectionState:'stopped',
  videoElementPublish:undefined,
  stream:undefined,
  isScreenSharing:false,
  constraints:{
    video: {
      width: { min: "640", ideal: "1280", max: "1920" },
      height: { min: "360", ideal: "720", max: "1080" },
      frameRate: "30"
    },
    audio: true,
  },
  sdpURL:'',
  streamInfo:{
    applicationName: "",
    streamName: "",
    sessionId: "[empty]"
  },
  mediaInfo:{
    videoBitrate: "",
    audioBitrate: "",
    videoFrameRate: "30",
    videoCodec: "42e01f",
    audioCodec: "opus"
  },
  userData: { param1: "value1" }, // ?
  audioEnabled: true,
  videoEnabled: true,
  useSoundMeter: false,
  cameras: [],
  microphones: []
}
let soundMeter = undefined;
let soundMeterInterval = undefined;

let callbacks = {};

const setState = (newState) =>
{
  return new Promise((resolve,reject) => {
    state = {...state,...newState};
    if (callbacks.onStateChanged != null)
    {
      callbacks.onStateChanged(state);
    }
    resolve(state);
  });
}
const getState = () =>
{
  return state;
}

// External wire callbacks
const on = (_callbacks) => {
  callbacks = _callbacks;
}

// External set
const set = async (props) =>
{
  console.log('WowzaWebRTC.set');
  console.log(props);

  let currentState = getState();
  let newStreamInfo = {...currentState.streamInfo};
  let newMediaInfo = {...currentState.mediaInfo};
  let newState = {};
  let constraintsChanged = false;

  if (props.videoElementPublish != null)
    newState['videoElementPublish'] = props.videoElementPublish;

  if (props.useSoundMeter != null)
    newState['useSoundMeter'] = props.useSoundMeter;

  if (props.sdpURL != null)
    newState['sdpURL'] = props.sdpURL.trim();

  if (props.applicationName != null)
    newStreamInfo['applicationName'] = props.applicationName.trim();
  if (props.streamName != null)
    newStreamInfo['streamName'] = props.streamName.trim();
  if (props.sessionId != null)
    newStreamInfo['sessionId'] = props.sessionId;
  if (props.streamInfo != null)
    newStreamInfo = {...newStreamInfo,...props.streamInfo};

  newState['streamInfo'] = newStreamInfo;

  if (props.videoBitrate != null)
    newMediaInfo.videoBitrate = props.videoBitrate;
  if (props.audioBitrate != null)
    newMediaInfo.audioBitrate = props.audioBitrate;
  if (props.videoFrameRate != null)
  {
    newMediaInfo.videoFrameRate = props.videoFrameRate;
    newState['constraints'] = {...currentState.constraints};
    if (!(typeof newState['constraints']['video'] === 'boolean'))
    {
      if (newMediaInfo.videoFrameRate === '')
        delete newState['constraints']['video']['frameRate'];
      else
        newState['constraints']['video']['frameRate'] = props.videoFrameRate
    }
  }
  if (props.videoCodec != null)
    newMediaInfo.videoCodec = props.videoCodec;
  if (props.audioCodec != null)
    newMediaInfo.audioCodec = props.audioCodec;
  if (props.mediaInfo != null)
    newMediaInfo = {...newMediaInfo,...props.streamInfo};

  newState['mediaInfo'] = newMediaInfo;

  if (props.userData != null)
    newState['userData'] = {...props.userData};

  if (props.constraints != null)
    newState['constraints'] = props.constraints;

  if (newState.constraints != null && JSON.stringify(currentState.constraints) !== JSON.stringify(newState.constraints))
  {
    constraintsChanged = true;
  }

  try
  {
    let s1 = await setState(newState);
    if (s1.stream == null)
    {
      await getUserMedia();
    }
    let s2 = await getDevices();
    if (constraintsChanged && s2.stream != null)
    {
      await applyConstraints(s2.stream,s2.constraints);
    }
    return getState();
  }
  catch (e)
  {
    errorHandler(e);
    return null;
  }
}

// returns Promise
const applyConstraints = (stream, constraints) => {
  let promises = [];
  let audioTracks = stream.getAudioTracks();
  let videoTracks = stream.getVideoTracks();
  for (let a in audioTracks)
  {
    promises.push(audioTracks[a].applyConstraints(constraints['audio']));
  }
  for (let v in videoTracks)
  {
    promises.push(videoTracks[v].applyConstraints(constraints['video']));
  }
  return Promise.all(promises);
}

// returns Promise
// resultsObject is {stream:MediaStream}
const getUserMedia = (mediaKind) =>
{
  mediaKind = mediaKind || 'both';

  return new Promise((resolve,reject) =>
  {
    console.log('WowzaWebRTCPublish.getUserMedia');

    let currentState = getState();
    let savedAudioTracks = [];
    let savedVideoTracks = [];
    if (currentState.stream != null)
    {
      savedAudioTracks = currentState.stream.getAudioTracks();
      savedVideoTracks = currentState.stream.getVideoTracks();
    }

    if (mediaKind !== 'video')
    {
      if (soundMeter != null)
      {
        soundMeter.stop();
      }
      if (soundMeterInterval != null)
      {
        clearInterval(soundMeterInterval);
      }
    }

    if (currentState.videoElementPublish == null)
    {
      reject({message:"videoElementPublish not set"});
    }

    async function getUserMediaSuccess(stream)
    {
      if (mediaKind === 'audio' && savedVideoTracks.length > 0)
      {
        let videoTracksToRemove = stream.getVideoTracks();
        for(let i in videoTracksToRemove)
        {
          stream.removeTrack(videoTracksToRemove[i]);
        }
        stream.addTrack(savedVideoTracks[0]);
      }
      else if (mediaKind === 'video' && savedAudioTracks.length > 0)
      {
        let audioTracksToRemove = stream.getAudioTracks();
        for(let j in audioTracksToRemove)
        {
          stream.removeTrack(audioTracksToRemove[j]);
        }
        stream.addTrack(savedAudioTracks[0]);
      }
      let newState = {stream:stream};
      if (mediaKind !== 'audio' && currentState.isScreenSharing)
      {
        for(let k in savedVideoTracks)
        {
          savedVideoTracks[k].stop();
        }
        newState['isScreenSharing'] = false;
      }
      try
      {
        currentState.videoElementPublish.srcObject = stream;
        newState['ready'] = true;
      }
      catch (error)
      {
        console.log('getUserMediaSuccess: error connecting stream to videoElementPublish, trying createObjectURL');
        console.log(error);
        currentState.videoElementPublish.src = window.URL.createObjectURL(stream);
        newState['ready'] = true;
      }
      try
      {
        if (mediaKind !== 'video' && window.AudioContext && currentState.useSoundMeter)
        {

          let audioContext = new AudioContext();
          let soundMeter = new SoundMeter(audioContext);
          soundMeter.connectToSource(stream, function(e) {
            if (e) {
              console.log(e);
              return;
            }
            soundMeterInterval = setInterval(() => {
              let soundVal = getState().audioEnabled ? soundMeter.instant.toFixed(2) : 0;
              if (callbacks.onSoundMeter != null){
                callbacks.onSoundMeter(soundVal);
              }
            }, 200);
          });
        }
      }
      catch (error2)
      {
        console.log('getUserMediaSuccess: error creating audio meter');
        console.log(error2);
      }
      await setState(newState);
      resolve(newState);
    }

    if (navigator.mediaDevices.getUserMedia)
    {
      navigator.mediaDevices.getUserMedia(currentState.constraints)
        .then(getUserMediaSuccess)
        .catch(errorHandler);
    }
    else if (navigator.getUserMedia)
    {
      navigator.getUserMedia(currentState.constraints, getUserMediaSuccess, (error) => {
        errorHandler(error);
        reject(error);
      });
    }
    else
    {
      errorHandler({message:"Your browser does not support WebRTC"});
      reject();
    }
  });
}

// Returns Promise
// resultsObject is {cameras:[]<InputDeviceInfo>,microphones:[]<InputDeviceInfo>}
const getDevices = () =>
{
  return new Promise((resolve,reject) =>
  {
    console.log('WowzaWebRTCPublish.getDevices');
    navigator.mediaDevices.enumerateDevices().then((devices) =>
    {
      // console.log(JSON.stringify(devices));
      let constraints = {...getState().constraints};
      let cameras = [];
      let microphones = [];
      for(var i = 0; i < devices.length; i++){
        if(devices[i].kind === 'videoinput'){
          if (cameras.length === 0) {
            constraints.video = Object.assign({},constraints.video,{deviceId: devices[i].deviceId});
          }
          cameras.push(devices[i]);
        }else if (devices[i].kind === 'audioinput') {
          if (microphones.length === 0) {
            constraints.audio = Object.assign({},constraints.audio,{deviceId: devices[i].deviceId});
          }
          microphones.push(devices[i]);
        }
      }
      let newState = {cameras:cameras,microphones:microphones,constraints:constraints};
      resolve(setState(newState));
    }).catch(
      (e) => {
        console.log("unable to detect AV devices: " + e);
        reject(e);
      }
    );
  });
}

const onconnectionstatechange = (evt) => {
  if (evt.target != null && evt.target.connectionState != null)
  {
    setState({connectionState:evt.target.connectionState});
  }
}

const onstop = () => {
  setState({connectionState:'stopped'});
}

const setEnabled = (trackKind, enabled) => {
  let currentState = getState();
  if (currentState.stream != null && currentState.stream.getTracks != null)
  {
    currentState.stream.getTracks().map((track) => {
      if (track.kind === trackKind) {
        track.enabled = enabled;
      }
    });
  }
}

const setAudioEnabled = (enabled) => {
  console.log('WowzaWebRTC.setAudioEnabled:' + enabled);
  setEnabled("audio",enabled);
  setState({audioEnabled:enabled});
}

const setVideoEnabled = (enabled) => {
  console.log('WowzaWebRTC.setVideoEnabled:' + enabled);
  setEnabled("video",enabled);
  setState({videoEnabled:enabled});
}

function getDisplayStream() {
  return new Promise((resolve,reject) => {
    let savedStream = getState().stream;
    function getDisplaySuccess(stream,constraints) {
      let newState = {stream:stream,isScreenSharing:true};
      if (savedStream.getAudioTracks().length > 0)
      {
        stream.addTrack(savedStream.getAudioTracks()[0]);
      }
      try
      {
        getState().videoElementPublish.srcObject = stream;
        newState['ready'] = true;
      }
      catch (error)
      {
        reject(error);
      }
      setState(newState);
      resolve(stream);
    };
    let constraints = {video:true};
    if (navigator.getDisplayMedia) {
      navigator.getDisplayMedia(constraints)
      .then((stream) => { getDisplaySuccess(stream,constraints); })
      .catch((e) => { reject(e); });
    } else if (navigator.mediaDevices.getDisplayMedia) {
      navigator.mediaDevices.getDisplayMedia(constraints)
      .then((stream) => { getDisplaySuccess(stream,constraints); })
      .catch((e) => { reject(e); });
    } else {
      constraints = {video: {mediaSource: 'screen'}};
      navigator.mediaDevices.getUserMedia(constraints)
      .then((stream) => { getDisplaySuccess(stream,constraints); })
      .catch((e) => { reject(e); });
    }
  });
}

const setCamera = (id) =>
{
  console.log("WowzaWebRTC.setCamera: " + id);
  if (id === 'screen')
  {
    getDisplayStream()
    .then((stream) => {
      let currentState = getState();
      setEnabled("audio",currentState.audioEnabled);
      setEnabled("video",currentState.videoEnabled);
      stream.getVideoTracks()[0].onended = function () {
        let endedState = getState();
        if (endedState.cameras.length > 0)
        {
          setCamera(endedState.cameras[0].deviceId);
        }
      }
      if (WowzaPeerConnectionPublish.isStarted())
      {
        stop();
        start();
      }
      if (callbacks.onCameraChanged != null)
      {
        callbacks.onCameraChanged('screen');
      }
    });
  }
  else
  {
    let constraints = {...state.constraints};
    if (typeof constraints.video === 'boolean')
    {
      constraints.video = {};
    }
    constraints.video = Object.assign({},constraints.video,{deviceId: id});
    setState({constraints:constraints})
    .then(()=>{
      getUserMedia('video')
      .then((stream) => {
        let currentState = getState();
        setEnabled("audio",currentState.audioEnabled);
        setEnabled("video",currentState.videoEnabled);
        if (WowzaPeerConnectionPublish.isStarted())
        {
          stop();
          start();
        }
        if (callbacks.onCameraChanged != null)
        {
          callbacks.onCameraChanged(id);
        }
      });
    });
  }
}

const setMicrophone = (id) =>
{
  console.log("WowzaWebRTC.setMicrophone: " + id);
  let constraints = {...state.constraints};
  if (typeof constraints.audio === 'boolean')
  {
    constraints.audio = {};
  }
  constraints.audio = Object.assign({},constraints.audio,{deviceId: id});
  setState({constraints:constraints})
  .then(()=>{
    getUserMedia('audio')
    .then((stream)=>{
      let currentState = getState();
      setEnabled("audio",currentState.audioEnabled);
      setEnabled("video",currentState.videoEnabled);
      if (WowzaPeerConnectionPublish.isStarted())
      {
        stop();
        start();
      }
      if (callbacks.onMicrophoneChanged != null)
      {
        callbacks.onMicrophoneChanged(id);
      }
    });
  });
}

const start = () =>
{
  let currentState = getState();
  console.log('WowzaWebRTC.start()');
  WowzaPeerConnectionPublish.start({
    wsURL:currentState.sdpURL,
    localStream:currentState.stream,
    streamInfo:currentState.streamInfo,
    mediaInfo:currentState.mediaInfo,
    userData:currentState.userData,
    mungeSDP:mungeSDPPublish,
    onconnectionstatechange: onconnectionstatechange,
    onstop:onstop,
    onstats:callbacks.onStats || undefined,
    onerror:errorHandler
  });
}

const stop = () =>
{
  console.log('WowzaWebRTC.stop()');
  WowzaPeerConnectionPublish.stop();
}

const errorHandler = (error) =>
{
  console.log('WowzaWebRTC ERROR:');
  console.log(error);
  if (error.message == null)
  {
    if (error.target != null)
    {
      console.log('typeof error.target: ' + typeof error.target);
    }
  }
  let newError = {...error}
  if (callbacks.onError != null)
  {
    callbacks.onError(error);
  }
}

let WowzaWebRTC = {
  on: on,
  set: set,
  getState: getState,
  start: start,
  stop: stop,
  setAudioEnabled: setAudioEnabled,
  setVideoEnabled: setVideoEnabled,
  setCamera: setCamera,
  setMicrophone: setMicrophone,
}
export default WowzaWebRTC;
