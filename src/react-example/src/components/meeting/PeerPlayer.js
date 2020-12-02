import React, { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import startPlay from '../../webrtc/startPlay';

const PUBLISH_PLAYER = "PUBLISH_PLAYER";
const PEER_PLAYER = "PEER_PLAYER";

const PeerPlayer = (props) => {

  const videoElement = useRef(null);
  const publishSettings = useSelector((state) => state.publishSettings);
  const { stream } = useSelector ((state) => state.media);
  const [connected, setConnected] = useState(false);
  const [audioTrack, setAudioTrack] = useState();
  const [videoTrack, setVideoTrack] = useState();
  let mounted = true;
  let playerType = (props.streamName === publishSettings.streamName) ? PUBLISH_PLAYER : PEER_PLAYER;

  useEffect(() => {
    if(mounted){
      if(playerType === PUBLISH_PLAYER){
        console.log("publish player");
        if (stream != null && videoElement.current != null)
        {
          videoElement.current.muted = true;
          videoElement.current.srcObject = stream;
        }
      } else {
        console.log("peer player");
        let playSettings = {
          signalingURL: publishSettings.signalingURL,
          applicationName: publishSettings.applicationName,
          streamName: props.streamName,
        }
        startPlay(playSettings,null,{
          onPeerConnectionOnTrack: (event) => {
            console.log("getting peer tracks");
            if (event.track != null && event.track.kind != null)
            {
              if (event.track.kind === 'audio')
              {
                setAudioTrack(event.track);
              }
              else if (event.track.kind === 'video')
              {
                setVideoTrack(event.track);
              }
            }
          },
          onConnectionStateChange: (result) => {
            console.log("connected state");
            console.log(result);
            if(mounted)
              setConnected(result.connected);
          },
          onError: (e) => {
            console.log(e);
          }
        });
      }
    }
    return () => mounted = false;
  }, [videoElement]);

  useEffect(() => {
    if ((playerType === PEER_PLAYER) && connected && mounted) {
      if(connected){
        let newStream = new MediaStream();
        if (audioTrack != null)
          newStream.addTrack(audioTrack);

        if (videoTrack != null)
          newStream.addTrack(videoTrack);

        if (videoElement != null && videoElement.current != null)
          videoElement.current.srcObject = newStream;
      } else {
        if (videoElement != null && videoElement.current != null)
          videoElement.current.srcObject = null;
      }
    }
    return () => mounted = false;
  }, [connected]);

  return(
    <video id={props.streamName} className="meeting-peer-player" ref={videoElement} autoPlay playsInline ></video>
  )
}
export default PeerPlayer
