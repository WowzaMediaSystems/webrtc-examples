import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import * as PublishSettingsActions from '../../actions/publishSettingsActions';
import * as WebRTCPublishActions from '../../actions/webrtcPublishActions';
import * as ErrorsActions from '../../actions/errorsActions';

import startPublish from '../../webrtc/startPublish';
import stopPublish from '../../webrtc/stopPublish';
import replaceAudioTrack from '../../webrtc/replaceAudioTrack';
import replaceVideoTrack from '../../webrtc/replaceVideoTrack';

const Publisher = () => {

  const dispatch = useDispatch();
  const publishSettings = useSelector ((state) => state.publishSettings);
  const webrtcPublish = useSelector ((state) => state.webrtcPublish);

  // Listen for changes in the publish* flags in the publishSettings store
  // and stop or stop publishing accordingly

  useEffect(() => {

    if (publishSettings.publishStart && !publishSettings.publishStarting && !webrtcPublish.connected)
    {
      dispatch({type:PublishSettingsActions.SET_PUBLISH_FLAGS, publishStart:false, publishStarting:true});
      startPublish(publishSettings,webrtcPublish.websocket,{
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
    if (publishSettings.publishStarting && webrtcPublish.connected)
    {
      dispatch({type:PublishSettingsActions.SET_PUBLISH_FLAGS, publishStarting:false});
    }

    if (publishSettings.publishStop && !publishSettings.publishStopping && webrtcPublish.connected)
    {
      dispatch({type:PublishSettingsActions.SET_PUBLISH_FLAGS, publishStop:false, publishStopping:true});
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
    if (publishSettings.publishStopping && !webrtcPublish.connected)
    {
      dispatch({type:PublishSettingsActions.SET_PUBLISH_FLAGS, publishStopping:false});
    }


  }, [dispatch,publishSettings,webrtcPublish]);

  // Handle Mic and Cam Track Changes
  const { audioTrack, videoTrack } = useSelector ((state) => state.publishSettings);
  const { peerConnection, audioSender, videoSender } = useSelector((state) => state.webrtcPublish);

  useEffect(() => {
    if (peerConnection != null) {
      replaceAudioTrack(audioTrack, audioSender, peerConnection, {
        onSetSenders: (senders) => {
          dispatch({type:WebRTCPublishActions.SET_WEBRTC_PUBLISH_PEERCONNECTION_VIDEO_SENDER,peerConnectionVideoSender:senders.videoSender});
        }
      });
    }

  },[dispatch,audioTrack]);

  useEffect(() => {
    if (peerConnection != null) {
      replaceVideoTrack(videoTrack, videoSender, peerConnection, {
        onSetSenders: (senders) => {
          dispatch({type:WebRTCPublishActions.SET_WEBRTC_PUBLISH_PEERCONNECTION_AUDIO_SENDER,peerConnectionAudioSender:senders.audioSender});
        }
      });
    }

  },[dispatch,videoTrack]);


  return <></>;
}

export default Publisher;
