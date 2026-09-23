import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import * as PlaySettingsActions from '../../actions/playSettingsActions';
import { attachProbeVideoElement } from '../../diagnostics/latencyProbe';
import * as WebRTCPlayActions from '../../actions/webrtcPlayActions';
import * as ErrorsActions from '../../actions/errorsActions';
import * as DataChannelActions from '../../actions/dataChannelActions';
import { describeReceivedMessage } from '../../utils/DataChannelUtils';
import { CHAT_CHANNEL_LABEL, CAPTIONS_CHANNEL_LABEL, DATA_CHANNELS_UNAVAILABLE_MESSAGE } from '../../webrtc/attachDataChannel';

import startPlay from '../../webrtc/startPlay';
import stopPlay from '../../webrtc/stopPlay';

const Player = () => {

  const videoElement = useRef(null);
  const streamRef = useRef(new MediaStream());
  const maxWidthRef = useRef(0);
  const peerConnectionRef = useRef(undefined);
  const websocketRef = useRef(undefined);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });

  const dispatch = useDispatch();
  const playSettings = useSelector ((state) => state.playSettings);
  const { peerConnection, websocket, connected } = useSelector ((state) => state.webrtcPlay);

  // Listen for changes in the play* flags in the playSettings store
  // and stop or stop playback accordingly

  useEffect(() => {

    const stopCallbacks = {
      onSetPeerConnection: (result) => {
        peerConnectionRef.current = result.peerConnection;
        dispatch({type:WebRTCPlayActions.SET_WEBRTC_PLAY_PEERCONNECTION,peerConnection:result.peerConnection});
      },
      onSetWebsocket: (result) => {
        websocketRef.current = result.websocket;
        dispatch({type:WebRTCPlayActions.SET_WEBRTC_PLAY_WEBSOCKET,websocket:result.websocket});
      },
      onPlayStopped: () => {
        streamRef.current = new MediaStream();
        if (videoElement.current) {
          videoElement.current.srcObject = null;
        }
        dispatch({type:WebRTCPlayActions.SET_WEBRTC_PLAY_CONNECTED,connected:false});
        dispatch(DataChannelActions.resetDataChannel('play'));
      }
    };

    if (playSettings.playStart && !playSettings.playStarting && !connected)
    {
      dispatch({type:PlaySettingsActions.SET_PLAY_FLAGS, playStart:false, playStarting:true});
      startPlay(playSettings, {
        onError: (error) => {
          dispatch({type:ErrorsActions.SET_ERROR_MESSAGE,message:error.message});
          stopPlay(playSettings, peerConnectionRef.current, websocketRef.current, stopCallbacks);
          dispatch({ type: PlaySettingsActions.SET_PLAY_FLAGS, playStart: false, playStarting: false, playStop: false, playStopping: false });
        },
        onConnectionStateChange: (result) => {
          dispatch({type:WebRTCPlayActions.SET_WEBRTC_PLAY_CONNECTED,connected:result.connected});
        },
        onSetPeerConnection: stopCallbacks.onSetPeerConnection,
        onSetWebsocket: stopCallbacks.onSetWebsocket,
        onPeerConnectionOnTrack: (event) => {
          console.log('ontrack:', event.track.kind, 'muted:', event.track.muted, 'readyState:', event.track.readyState);
          streamRef.current.addTrack(event.track);
          // Attach once. Reassigning on every track reloads the element after the Play
          // click's gesture has expired, which leaves Safari with audio and no picture.
          if (videoElement.current && videoElement.current.srcObject !== streamRef.current) {
            videoElement.current.srcObject = streamRef.current;
            console.log('srcObject set, tracks:', streamRef.current.getTracks().map(t => t.kind));
          }
        },
        onSetDataChannel: (result) => {
          // Only the chat channel is sent on from the UI; the captions handle is receive-only.
          if (result.label === CHAT_CHANNEL_LABEL)
            dispatch(DataChannelActions.setDataChannelHandle('play', result.dataChannel));
        },
        onDataChannelStateChange: (result) => {
          // The panel tracks the chat channel's lifecycle; captions state isn't shown.
          if (result.label === CHAT_CHANNEL_LABEL)
            dispatch(DataChannelActions.setDataChannelState('play', result));
        },
        onDataChannelMessage: (result) => {
          if (result.label === CAPTIONS_CHANNEL_LABEL)
            dispatch(DataChannelActions.setCaption('play', result.data));
          else
            dispatch(DataChannelActions.addDataChannelMessage('play', describeReceivedMessage(result)));
        },
        onDataChannelError: (result) => {
          dispatch({type:ErrorsActions.SET_ERROR_MESSAGE, message:'Data channel error: ' + result.message});
        },
        onDataChannelsUnavailable: () => {
          // Playback is unaffected, so this only reports - no media state is touched.
          dispatch({type:ErrorsActions.SET_ERROR_MESSAGE, message:DATA_CHANNELS_UNAVAILABLE_MESSAGE});
        }
      });
    }
    if (playSettings.playStarting && connected)
    {
      dispatch({type:PlaySettingsActions.SET_PLAY_FLAGS, playStarting:false});
    }

    // A session that never reached "connected" still has to be stoppable - otherwise a start that
    // stalls mid-negotiation leaves the page with no way out.
    if (playSettings.playStop && !playSettings.playStopping && (connected || peerConnection))
    {
      dispatch({type:PlaySettingsActions.SET_PLAY_FLAGS, playStop:false, playStopping:true});
      stopPlay(playSettings, peerConnection, websocket, stopCallbacks);
    }
    if (playSettings.playStopping && !connected)
    {
      dispatch({type:PlaySettingsActions.SET_PLAY_FLAGS, playStopping:false});
    }


  }, [dispatch,videoElement,playSettings,peerConnection,websocket,connected]);

  // Dimensions come from loadedmetadata and loadeddata as well as resize, since resize alone
  // can arrive late for the first frame.
  useEffect(() => {
    const video = videoElement.current;
    if (!video) return;

    const updateSize = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width > maxWidthRef.current) maxWidthRef.current = width;
      setVideoSize({ width, height });
    };

    video.addEventListener('loadedmetadata', updateSize);
    video.addEventListener('loadeddata', updateSize);
    video.addEventListener('resize', updateSize);
    updateSize();
    return () => {
      video.removeEventListener('loadedmetadata', updateSize);
      video.removeEventListener('loadeddata', updateSize);
      video.removeEventListener('resize', updateSize);
    };
  }, [connected]);

  // Reset the "max width seen" baseline between sessions so a new connection
  // doesn't inherit the previous publisher's reference resolution.
  useEffect(() => {
    if (!connected) {
      maxWidthRef.current = 0;
      setVideoSize({ width: 0, height: 0 });
    }
  }, [connected]);

  /*
   * Sound starts on: the Play click unmutes the element while it is still a user gesture. If
   * the browser refuses sound anyway, playback would stop with no picture, so the first
   * metadata retries silent and offers "Click to unmute". The toggle below keeps sound
   * controllable whenever there is a picture.
   */
  const [muted, setMuted] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);

  useEffect(() => {
    const video = videoElement.current;
    if (!video) return undefined;
    const sync = () => setMuted(video.muted);
    const ensurePlaying = async () => {
      if (!video.paused) return;
      try {
        await video.play();
      } catch {
        video.muted = true;
        try { await video.play(); } catch { /* nothing more to try without a gesture */ }
        setNeedsGesture(true);
      }
    };
    video.addEventListener('volumechange', sync);
    video.addEventListener('loadedmetadata', ensurePlaying);
    return () => {
      video.removeEventListener('volumechange', sync);
      video.removeEventListener('loadedmetadata', ensurePlaying);
    };
  }, []);

  const setSound = useCallback((on) => {
    const video = videoElement.current;
    if (!video) return;
    video.muted = !on;
    if (on) video.play().catch(() => {});
    setNeedsGesture(false);
  }, []);

  // No picture until both dimensions are known. The video is never display:none (WebKit may
  // not paint a video that started playing hidden); the placeholder covers it until then.
  const hasPicture = connected && videoSize.width > 0 && videoSize.height > 0;

  /*
   * The probe's decode-and-display leg is measured from this element, because
   * requestVideoFrameCallback is the only thing that reports when a frame was actually put on
   * screen. The encoded side of the probe attaches to the receiver in startPlay; this is the
   * other half of the join, and without it the panel has a transport figure and dashes for the
   * player leg and the total.
   */
  useEffect(() => {
    if (!hasPicture || !playSettings.latencyProbe) return undefined;
    const element = videoElement.current;
    if (!element) return undefined;
    const joined = attachProbeVideoElement(element);
    return () => joined.stop();
  }, [hasPicture, playSettings.latencyProbe]);

  return (
  <>
    {!hasPicture && (
      <div className="wz-video-placeholder wz-video-placeholder--over">
        Not playing
      </div>
    )}
    <video
      id="player-video"
      ref={videoElement}
      autoPlay
      playsInline
      controls
      style={hasPicture ? { '--wz-video-ar': videoSize.width / videoSize.height } : undefined}
    />
    {hasPicture && needsGesture && muted && (
      <button
        type="button"
        id="player-unmute"
        className="wz-unmute"
        onClick={() => setSound(true)}
      >
        Click to unmute
      </button>
    )}
    {hasPicture && (
      <button
        type="button"
        id="player-mute-toggle"
        className="wz-mute-toggle"
        aria-pressed={muted}
        onClick={() => setSound(muted)}
      >
        {muted ? 'Unmute' : 'Mute'}
      </button>
    )}
    {hasPicture && (
      <div id="rendition-badge">
        {videoSize.width}&times;{videoSize.height}
      </div>
    )}
  </>
);
}

export default Player;