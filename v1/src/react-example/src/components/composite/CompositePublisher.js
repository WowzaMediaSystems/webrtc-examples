import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import * as compositeSettingsActions from '../../actions/compositeSettingsActions';
import * as WebRTCPublishActions from '../../actions/webrtcPublishActions';
import * as ErrorsActions from '../../actions/errorsActions';

import startPublish from '../../webrtc/startPublish';
import stopPublish from '../../webrtc/stopPublish';

const CompositePublisher = () => {

  const dispatch = useDispatch();
  const compositeSettings = useSelector ((state) => state.compositeSettings);
  const webrtcPublish = useSelector ((state) => state.webrtcPublish);

  // Listen for changes in the publish* flags in the compositeSettings store
  // and stop or stop publishing accordingly

  useEffect(() => {

    if (compositeSettings.publishStart && !compositeSettings.publishStarting && !webrtcPublish.connected)
    {
      dispatch({type:compositeSettingsActions.SET_COMPOSITE_FLAGS, publishStart:false, publishStarting:true});
      startPublish(compositeSettings,webrtcPublish.websocket,{
        onError: (error) => {
          dispatch({type:ErrorsActions.SET_ERROR_MESSAGE,message:error.message});
        },
        onConnectionStateChange: (result) => {
          dispatch({type:WebRTCPublishActions.SET_WEBRTC_PUBLISH_CONNECTED,connected:result.connected});
        },
        onSetPeerConnection: (result) => {
          dispatch({type:WebRTCPublishActions.SET_WEBRTC_PUBLISH_PEERCONNECTION,peerConnection:result.peerConnection});
        },
        onSetWebsocket: (result) => {
          dispatch({type:WebRTCPublishActions.SET_WEBRTC_PUBLISH_WEBSOCKET,websocket:result.websocket});
        },
        onSetSenders: (senders) => {
          dispatch({type:WebRTCPublishActions.SET_WEBRTC_PUBLISH_PEERCONNECTION_AUDIO_SENDER,peerConnectionAudioSender:senders.audioSender});
          dispatch({type:WebRTCPublishActions.SET_WEBRTC_PUBLISH_PEERCONNECTION_VIDEO_SENDER,peerConnectionVideoSender:senders.videoSender});
        }
      });
    }
    if (compositeSettings.publishStarting && webrtcPublish.connected)
    {
      dispatch({type:compositeSettingsActions.SET_COMPOSITE_FLAGS, publishStarting:false});
    }

    if (compositeSettings.publishStop && !compositeSettings.publishStopping && webrtcPublish.connected)
    {
      dispatch({type:compositeSettingsActions.SET_COMPOSITE_FLAGS, publishStop:false, publishStopping:true});
      stopPublish(webrtcPublish.peerConnection,webrtcPublish.websocket,{
        onSetPeerConnection: (result) => {
          dispatch({type:WebRTCPublishActions.SET_WEBRTC_PUBLISH_PEERCONNECTION,peerConnection:result.peerConnection});
        },
        onSetWebsocket: (result) => {
          dispatch({type:WebRTCPublishActions.SET_WEBRTC_PUBLISH_WEBSOCKET,websocket:result.websocket});
        },
        onPublishStopped: () => {
          dispatch({type:WebRTCPublishActions.SET_WEBRTC_PUBLISH_CONNECTED,connected:false});
        }
      });
    }
    if (compositeSettings.publishStopping && !webrtcPublish.connected)
    {
      dispatch({type:compositeSettingsActions.SET_COMPOSITE_FLAGS, publishStopping:false});
    }


  }, [dispatch,compositeSettings,webrtcPublish]);

  return <></>;
}

export default CompositePublisher;