import React, { useEffect, useState, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import * as PublishSettingsActions from '../../actions/publishSettingsActions';
import * as WebRTCMeetingActions from '../../actions/webrtcMeetingActions';
import * as ErrorsActions from '../../actions/errorsActions';
import PeerPlayer from './PeerPlayer';

import startPublish from '../../webrtc/startPublish';
import stopPublish from '../../webrtc/stopPublish';

const Meeter = () => {

  const dispatch = useDispatch();
  const publishSettings = useSelector((state) => state.publishSettings);
  const webrtcMeeting = useSelector((state) => state.webrtcMeeting);
  const peerStreams = useRef(webrtcMeeting.peerStreams);
  const [pollingInterval, setPollingInterval] = useState();

  useEffect(() => {
    peerStreams.current = webrtcMeeting.peerStreams;
    if (publishSettings.publishStart && !publishSettings.publishStarting && !webrtcMeeting.connected) {
      // update flags
      dispatch({type:PublishSettingsActions.SET_PUBLISH_FLAGS, publishStart:false, publishStarting:true});
      // Start publishing to Wowza Streaming Engine
      startPublish(publishSettings,webrtcMeeting.websocket,{
        onError: (error) => {
          dispatch(PublishSettingsActions.resetPublish())
          dispatch({type:ErrorsActions.SET_ERROR_MESSAGE,message:error.message});
        },
        onConnectionStateChange: (result) => {
          dispatch({type:WebRTCMeetingActions.SET_WEBRTC_MEETING_CONNECTED,connected:result.connected});
        },
        onSetPeerConnection: (result) => {
          dispatch({type:WebRTCMeetingActions.SET_WEBRTC_MEETING_PEERCONNECTION,peerConnection:result.peerConnection});
        },
        onSetWebsocket: (result) => {
          dispatch({type:WebRTCMeetingActions.SET_WEBRTC_MEETING_WEBSOCKET,websocket:result.websocket});
        },
        onSetSenders: (senders) => {
          dispatch({type:WebRTCMeetingActions.SET_WEBRTC_MEETING_PEERCONNECTION_AUDIO_SENDER,peerConnectionAudioSender:senders.audioSender});
          dispatch({type:WebRTCMeetingActions.SET_WEBRTC_MEETING_PEERCONNECTION_VIDEO_SENDER,peerConnectionVideoSender:senders.videoSender});
        }
      });
    }
    if (publishSettings.publishStarting && webrtcMeeting.connected){
      dispatch({type:PublishSettingsActions.SET_PUBLISH_FLAGS, publishStarting:false});
      // insert peer player with cam and mic as source
      dispatch({type:WebRTCMeetingActions.ADD_PEER_VIDEO_PLAYER,peerStream:{streamName: publishSettings.streamName}})
      if(webrtcMeeting.websocket){
        //add new listener
        webrtcMeeting.websocket.addEventListener("message", (event) => {
          let msgJSON = JSON.parse(event.data);
          let msgCommand = msgJSON['command'];
          if ('getAvailableStreams'.localeCompare(msgCommand) === 0) {
            if(msgJSON["availableStreams"] !== null){
              let availableStreams = msgJSON["availableStreams"].filter((stream) => !(stream.streamName.includes(publishSettings.streamName) && stream.streamName.includes("_")))
              //  filter out this stream from the playback ones since we have a dedicated player for it (not necessary if we want to lump it in with the others)
              availableStreams = availableStreams.filter((stream) => !(stream.streamName === publishSettings.streamName))
              for(let i=0;i<availableStreams.length;i++){
                WebRTCMeetingActions.checkAddPeerStream(peerStreams.current, availableStreams[i].streamName).then((action) => {
                  dispatch(action);
                });
              }
              for(let i=0;i<peerStreams.current.length;i++){
                if(!(peerStreams.current[i].streamName === publishSettings.streamName)){
                  WebRTCMeetingActions.checkRemovePeerStream(availableStreams,peerStreams.current[i].streamName).then((action) => {
                    dispatch(action);
                  });
                }
              }
            }
          }
        });
        // set interval
        setPollingInterval(setInterval(() => {
          if(webrtcMeeting.websocket){
            let streamInfo = {
              applicationName:publishSettings.applicationName,
              streamName:publishSettings.streamName,
              sessionId:"[empty]"
            };
            webrtcMeeting.websocket.send('{"direction":"publish", "command":"getAvailableStreams", "streamInfo":' + JSON.stringify(streamInfo) + '}');
          }
        }, 3000));
      }

    }

    if (publishSettings.publishStop && !publishSettings.publishStopping && webrtcMeeting.connected)
    {
      clearInterval(pollingInterval);
      dispatch({type:PublishSettingsActions.SET_PUBLISH_FLAGS, publishStop:false, publishStopping:true});
      dispatch({type:WebRTCMeetingActions.REMOVE_ALL_PLAYERS})
      stopPublish(webrtcMeeting.peerConnection,webrtcMeeting.websocket,{
        onSetPeerConnection: (result) => {
          dispatch({type:WebRTCMeetingActions.SET_WEBRTC_MEETING_PEERCONNECTION,peerConnection:result.peerConnection});
        },
        onSetWebsocket: (result) => {
          dispatch({type:WebRTCMeetingActions.SET_WEBRTC_MEETING_WEBSOCKET,websocket:result.websocket});
        },
        onPublishStopped: () => {
          dispatch({type:WebRTCMeetingActions.SET_WEBRTC_MEETING_CONNECTED,connected:false});
        }
      });
    }
    if (publishSettings.publishStopping && !webrtcMeeting.connected)
    {
      dispatch({type:PublishSettingsActions.SET_PUBLISH_FLAGS, publishStopping:false});
    }
  }, [dispatch, publishSettings, webrtcMeeting, pollingInterval]);

  return (
    <div id="player-list">
    { webrtcMeeting.peerStreams.map((peerStream,key) => {
      return <PeerPlayer streamName={peerStream.streamName} key={key} />
    })}
    </div>
  )
}

export default Meeter;
