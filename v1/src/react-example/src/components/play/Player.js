import React, { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import * as PlaySettingsActions from '../../actions/playSettingsActions';
import * as WebRTCPlayActions from '../../actions/webrtcPlayActions';
import * as ErrorsActions from '../../actions/errorsActions';

import startPlay from '../../webrtc/startPlay';
import stopPlay from '../../webrtc/stopPlay';

const Player = () => {

  const videoElement = useRef(null);

  const dispatch = useDispatch();
  const playSettings = useSelector ((state) => state.playSettings);
  const { peerConnection, websocket, connected, audioTrack, videoTrack } = useSelector ((state) => state.webrtcPlay);

  // Listen for changes in the play* flags in the playSettings store
  // and stop or stop playback accordingly

  useEffect(() => {

    if (playSettings.playStart && !playSettings.playStarting && !connected)
    {
      dispatch({type:PlaySettingsActions.SET_PLAY_FLAGS, playStart:false, playStarting:true});
      startPlay(playSettings,websocket,{
        onError: (error) => {
          dispatch({type:ErrorsActions.SET_ERROR_MESSAGE,message:error.message});
        },
        onConnectionStateChange: (result) => {
          dispatch({type:WebRTCPlayActions.SET_WEBRTC_PLAY_CONNECTED,connected:result.connected});
        },
        onSetPeerConnection: (result) => {
          dispatch({type:WebRTCPlayActions.SET_WEBRTC_PLAY_PEERCONNECTION,peerConnection:result.peerConnection});
        },
        onSetWebsocket: (result) => {
          dispatch({type:WebRTCPlayActions.SET_WEBRTC_PLAY_WEBSOCKET,websocket:result.websocket});
        },
        onPeerConnectionOnTrack: (event) => {
          if (event.track != null && event.track.kind != null)
          {
            if (event.track.kind === 'audio')
            {
              dispatch({type:WebRTCPlayActions.SET_WEBRTC_PLAY_AUDIO_TRACK,audioTrack:event.track});
            }
            else if (event.track.kind === 'video')
            {
              dispatch({type:WebRTCPlayActions.SET_WEBRTC_PLAY_VIDEO_TRACK,videoTrack:event.track});
            }
          }
        }
      });
    }
    if (playSettings.playStarting && connected)
    {
      dispatch({type:PlaySettingsActions.SET_PLAY_FLAGS, playStarting:false});
    }

    if (playSettings.playStop && !playSettings.playStopping && connected)
    {
      dispatch({type:PlaySettingsActions.SET_PLAY_FLAGS, playStop:false, playStopping:true});
      stopPlay(peerConnection, websocket,{
        onSetPeerConnection: (result) => {
          dispatch({type:WebRTCPlayActions.SET_WEBRTC_PLAY_PEERCONNECTION,peerConnection:result.peerConnection});
        },
        onSetWebsocket: (result) => {
          dispatch({type:WebRTCPlayActions.SET_WEBRTC_PLAY_WEBSOCKET,websocket:result.websocket});
        },
        onPlayStopped: () => {
          dispatch({type:WebRTCPlayActions.SET_WEBRTC_PLAY_CONNECTED,connected:false});
        }
      });
    }
    if (playSettings.playStopping && !connected)
    {
      dispatch({type:PlaySettingsActions.SET_PLAY_FLAGS, playStopping:false});
    }


  }, [dispatch,videoElement,playSettings,peerConnection,websocket,connected]);

  useEffect(() => {

    if (connected)
    {
      let newStream = new MediaStream();
      if (audioTrack != null)
        newStream.addTrack(audioTrack);

      if (videoTrack != null)
        newStream.addTrack(videoTrack);

      if (videoElement != null && videoElement.current != null)
        videoElement.current.srcObject = newStream;
    }
    else
    {
      if (videoElement != null && videoElement.current != null)
        videoElement.current.srcObject = null;
    }

  }, [audioTrack, videoTrack, connected, videoElement]);

  if (!connected)
    return null;

  return (
    <video id="player-video" ref={videoElement} autoPlay playsInline muted controls></video>
  );
}

export default Player;