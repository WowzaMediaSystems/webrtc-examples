/*
 * This code and all components (c) Copyright 2019-2020, Wowza Media Systems, LLC. All rights reserved.
 * This code is licensed pursuant to the BSD 3-Clause License.
 * 
 * Typescript migration by @farandal - Francisco Aranda - farandal@gmail.com - http://linkedin.com/in/farandal
 * 
 */
import {IStreamInfo, ICallbacks} from "./interfaces";
import { mungeSDPPlay } from './WowzaMungeSDP';
import WowzaPeerConnectionPlay from './WowzaPeerConnectionPlay';

interface IState {
  connectionState?:string;
  videoElementPlay?: HTMLVideoElement;
  sdpURL?: string;
  streamInfo?: IStreamInfo;
  userData?: any;
}

let state:IState = {
  connectionState:'stopped',
  videoElementPlay:undefined,
  sdpURL:'',
  streamInfo:{
    applicationName: "",
    streamName: "",
    sessionId: "[empty]"
  },
  userData: { param1: "value1" } // ?
}

let wowzaPeerConnectionPlay:WowzaPeerConnectionPlay;
let callbacks:ICallbacks;

// TODO! this value is not being used.
//let newAPI = false;

interface IProps {
  videoElementPlay: any;
  sdpURL: any;
  applicationName: any;
  streamName: any;
  sessionId: any;
  streamInfo: any;
  userData: any;
  
}

const setState = (newState:IState) =>
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

// Private callbacks for the peerConnection
const onconnectionstatechange = (evt:any) =>
{
  if (evt.target != null && evt.target.connectionState != null)
  {
    let connectionState:string = evt.target.connectionState as string;
    let newState:IState = {connectionState:connectionState};
    setState(newState);
  }
}

const onstop = () =>
{
  setState({connectionState:'stopped'});
}


// External wire callbacks
const on = (_callbacks:ICallbacks) => {
  callbacks = _callbacks;
}

// External set
const set = (props:IProps) => {
  return new Promise((resolve,reject) => {
  
    let currentState = getState();
    let newStreamInfo = {...currentState.streamInfo};
    let newState:IState;
  
    if (props.videoElementPlay != null)
      newState['videoElementPlay'] = props.videoElementPlay;

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

    if (props.userData != null)
      newState['userData'] = {...props.userData};

    setState(newState)
    .then((s) => {
      resolve(s);
    });
  });
}

const getAvailableStreams = () =>
{
  let currentState = getState();
  wowzaPeerConnectionPlay = new WowzaPeerConnectionPlay({
    sdpURL:currentState.sdpURL,
    videoElement:currentState.videoElementPlay,
    streamInfo:currentState.streamInfo,
    userData:currentState.userData,
    mungeSDP:mungeSDPPlay,
    onconnectionstatechange: onconnectionstatechange,
    onstop:onstop,
    onerror:errorHandler
  });
  return (wowzaPeerConnectionPlay.getAvailableStreams());
}

const play = () =>
{
  let currentState = getState();
  wowzaPeerConnectionPlay = new WowzaPeerConnectionPlay({
    sdpURL:currentState.sdpURL,
    videoElement:currentState.videoElementPlay,
    streamInfo:currentState.streamInfo,
    userData:currentState.userData,
    mungeSDP:mungeSDPPlay,
    onconnectionstatechange: onconnectionstatechange,
    onstop:onstop,
    onerror:errorHandler
  });
  wowzaPeerConnectionPlay.start();
}

const stop = () => 
{
  wowzaPeerConnectionPlay.stop();
  wowzaPeerConnectionPlay = undefined;
}

const errorHandler = (error:any) =>
{
  console.log('WowzaWebRTCPlay ERROR:');
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

let WowzaWebRTCPlay = {
  on: on,
  set: set,
  getState: getState,
  getAvailableStreams: getAvailableStreams,
  play: play,
  stop: stop
}

export default WowzaWebRTCPlay;