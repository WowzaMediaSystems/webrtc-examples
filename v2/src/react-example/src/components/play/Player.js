import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import * as PlaySettingsActions from '../../actions/playSettingsActions';
import * as WebRTCPlayActions from '../../actions/webrtcPlayActions';
import * as ErrorsActions from '../../actions/errorsActions';
import * as DataChannelActions from '../../actions/dataChannelActions';
import { describeReceivedMessage } from '../../utils/DataChannelUtils';

import startPlay from '../../webrtc/startPlay';
import stopPlay from '../../webrtc/stopPlay';

const Player = () => {

  const videoElement = useRef(null);
  const streamRef = useRef(new MediaStream());
  const maxWidthRef = useRef(0);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });

  const dispatch = useDispatch();
  const playSettings = useSelector ((state) => state.playSettings);
  const { peerConnection, websocket, connected } = useSelector ((state) => state.webrtcPlay);

  // Listen for changes in the play* flags in the playSettings store
  // and stop or stop playback accordingly

  useEffect(() => {

    if (playSettings.playStart && !playSettings.playStarting && !connected)
    {
      dispatch({type:PlaySettingsActions.SET_PLAY_FLAGS, playStart:false, playStarting:true});
      startPlay(playSettings, {
        onError: (error) => {
          dispatch({type:ErrorsActions.SET_ERROR_MESSAGE,message:error.message});
          dispatch({ type: PlaySettingsActions.SET_PLAY_FLAGS, playStart: false, playStarting: false, playStop: false, playStopping: false });
          dispatch({ type: WebRTCPlayActions.SET_WEBRTC_PLAY_CONNECTED, connected: false });
          dispatch({ type: DataChannelActions.RESET_DATA_CHANNEL, context: 'play' });
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
          console.log('ontrack:', event.track.kind, 'muted:', event.track.muted, 'readyState:', event.track.readyState);
          streamRef.current.addTrack(event.track);
          if (videoElement.current) {
            videoElement.current.srcObject = streamRef.current;
            console.log('srcObject set, tracks:', streamRef.current.getTracks().map(t => t.kind));
          }
        },
        onSetDataChannel: (result) => {
          dispatch({type:DataChannelActions.SET_DATA_CHANNEL_HANDLE, context:'play', handle:result.dataChannel});
        },
        onDataChannelStateChange: (result) => {
          dispatch({type:DataChannelActions.SET_DATA_CHANNEL_STATE, context:'play', label:result.label, id:result.id, state:result.state, local:result.local});
        },
        onDataChannelMessage: (result) => {
          dispatch({type:DataChannelActions.ADD_DATA_CHANNEL_MESSAGE, context:'play', message:describeReceivedMessage(result)});
        },
        onDataChannelError: (result) => {
          dispatch({type:ErrorsActions.SET_ERROR_MESSAGE, message:'Data channel error: ' + result.message});
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
      stopPlay(playSettings, peerConnection, websocket,{
        onSetPeerConnection: (result) => {
          dispatch({type:WebRTCPlayActions.SET_WEBRTC_PLAY_PEERCONNECTION,peerConnection:result.peerConnection});
        },
        onSetWebsocket: (result) => {
          dispatch({type:WebRTCPlayActions.SET_WEBRTC_PLAY_WEBSOCKET,websocket:result.websocket});
        },
        onPlayStopped: () => {
          streamRef.current = new MediaStream();
          if (videoElement.current) {
            videoElement.current.srcObject = null;
          }
          dispatch({type:WebRTCPlayActions.SET_WEBRTC_PLAY_CONNECTED,connected:false});
          dispatch({type:DataChannelActions.RESET_DATA_CHANNEL, context:'play'});
        }
      });
    }
    if (playSettings.playStopping && !connected)
    {
      dispatch({type:PlaySettingsActions.SET_PLAY_FLAGS, playStopping:false});
    }


  }, [dispatch,videoElement,playSettings,peerConnection,websocket,connected]);

  // Watch the <video> element's dimensions
  useEffect(() => {
    const video = videoElement.current;
    if (!video) return;

    const updateSize = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width > maxWidthRef.current) maxWidthRef.current = width;
      setVideoSize({ width, height });
    };

    video.addEventListener('resize', updateSize);
    updateSize();
    return () => video.removeEventListener('resize', updateSize);
  }, [connected]);

  // Reset the "max width seen" baseline between sessions so a new connection
  // doesn't inherit the previous publisher's reference resolution.
  useEffect(() => {
    if (!connected) {
      maxWidthRef.current = 0;
      setVideoSize({ width: 0, height: 0 });
    }
  }, [connected]);

  const showBadge = connected && videoSize.width > 0;

  return (
  <>
    <video
      id="player-video"
      ref={videoElement}
      autoPlay
      playsInline
      muted
      controls
      style={{ display: connected ? 'block' : 'none' }}
    />
    {showBadge && (
      <div id="rendition-badge">
        {videoSize.width}&times;{videoSize.height}
      </div>
    )}
  </>
);
}

export default Player;