/*
 * This code and all components (c) Copyright 2019-2020, Wowza Media Systems, LLC. All rights reserved.
 * This code is licensed pursuant to the BSD 3-Clause License.
 */

import { mungeSDPPlay } from './WowzaMungeSDP.js';
import WowzaPeerConnectionPlay from './WowzaPeerConnectionPlay.js';

class WowzaWebRTCPlay
{
  constructor (props) {
    this.state = {
      connectionState:'stopped',
      videoElementPlay:undefined,
      sdpURL:'',
      streamInfo:{
        applicationName: "",
        streamName: "",
        sessionId: "[empty]"
      },
      secureData:{
        prefix: "",
        secret: "",
        isIp: false,
        ip: "",
        timeout: ""
      },
      userData: { param1: "value1" } // ?
    }

    this.wowzaPeerConnectionPlay = undefined;
    this.callbacks = {}; //TODO: turn into listeners
    this.newAPI = false;
    this.errorHandler = this.errorHandler.bind(this);
    this.onconnectionstatechange = this.onconnectionstatechange.bind(this);
    this.onstop = this.onstop.bind(this);
    this.on = this.on.bind(this);
  }


  setState(newState) {
    let _this = this;
    return new Promise((resolve,reject) => {
      _this.state = {..._this.state,...newState};
      if (_this.callbacks.onStateChanged != null)
      {
        _this.callbacks.onStateChanged(_this.state);
      }
      resolve(_this.state);
    });
  }

  getState() {
    return this.state;
  }

  onconnectionstatechange(evt) {
    if (evt.target != null && evt.target.connectionState != null)
    {
      this.setState({connectionState:evt.target.connectionState});
    }
  }

  onstop(){
    this.setState({connectionState:'stopped'});
  }


  // External wire callbacks
  on(_callbacks){
    this.callbacks = _callbacks;
  }

  // External set
  set(props){
    let _this = this;
    return new Promise((resolve,reject) => {

      let currentState = _this.getState();
      let newStreamInfo = {...currentState.streamInfo};
      let newSecureData = {...currentState.secureData};
      let newState = {};

      if (props.videoElementPlay != null)
        newState['videoElementPlay'] = props.videoElementPlay;

      if (props.sdpURL != null)
        newState['sdpURL'] = props.sdpURL.trim();

      if (props.applicationName != null)
        newSecureData['applicationName'] = newStreamInfo['applicationName'] = props.applicationName.trim();
      if (props.streamName != null) 
        newSecureData['streamName'] = newStreamInfo['streamName'] = props.streamName.trim();
      if (props.sessionId != null)
        newStreamInfo['sessionId'] = props.sessionId;
      if (props.streamInfo != null)
        newStreamInfo = {...newStreamInfo,...props.streamInfo};       
      newState['streamInfo'] = newStreamInfo;

      if (props.secret != null)
        newSecureData['secret'] = props.secret.trim();
      if (props.prefix != null)
        newSecureData['prefix'] = props.prefix.trim();
      if (props.ip != null)
        newSecureData['ip'] = props.ip.trim();
      if (props.timeout)
        newSecureData['timeout'] = parseInt(props.timeout);
      if (props.isIp != null)
        newSecureData['isIp'] = props.isIp;
      newState['secureData'] = newSecureData;
      
      if (props.userData != null)
        newState['userData'] = {...props.userData};

      _this.setState(newState)
      .then((s) => {
        resolve(s);
      });
    });
  }

  getAvailableStreams(){
    let currentState = this.getState();
    this.wowzaPeerConnectionPlay = new WowzaPeerConnectionPlay({
      sdpURL:currentState.sdpURL,
      videoElement:currentState.videoElementPlay,
      streamInfo:currentState.streamInfo,
      userData:currentState.userData,
      mungeSDP:mungeSDPPlay,
      onconnectionstatechange: this.onconnectionstatechange,
      onstop: this.onstop,
      onerror: this.errorHandler
    });
    return (this.wowzaPeerConnectionPlay.getAvailableStreams());
  }

  play(){
    let currentState = this.getState();
    this.wowzaPeerConnectionPlay = new WowzaPeerConnectionPlay({
      sdpURL:currentState.sdpURL,
      videoElement:currentState.videoElementPlay,
      streamInfo:currentState.streamInfo,
      userData:currentState.userData,
      secureData:currentState.secureData,
      mungeSDP:mungeSDPPlay,
      onconnectionstatechange: this.onconnectionstatechange,
      onstop: this.onstop,
      onerror: this.errorHandler
    });
    this.wowzaPeerConnectionPlay.start();
  }

  stop()
  {
    this.wowzaPeerConnectionPlay.stop();
    this.wowzaPeerConnectionPlay = undefined;
  }

  errorHandler(error){
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
    if (this.callbacks.onError != null)
    {
      this.callbacks.onError(error);
    }
  }
}

export default WowzaWebRTCPlay;
