export const SET_WEBRTC_MEETING_WEBSOCKET="SET_WEBRTC_MEETING_WEBSOCKET";
export const SET_WEBRTC_MEETING_PEERCONNECTION="SET_WEBRTC_MEETING_PEERCONNECTION";
export const SET_WEBRTC_MEETING_PEERCONNECTION_AUDIO_SENDER="SET_WEBRTC_MEETING_PEERCONNECTION_AUDIO_SENDER";
export const SET_WEBRTC_MEETING_PEERCONNECTION_VIDEO_SENDER="SET_WEBRTC_MEETING_PEERCONNECTION_VIDEO_SENDER";
export const SET_WEBRTC_MEETING_CONNECTED="SET_WEBRTC_MEETING_CONNECTED";
export const ADD_PEER_VIDEO_PLAYER="ADD_PEER_VIDEO_PLAYER";
export const REMOVE_PEER_VIDEO_PLAYER="REMOVE_PEER_VIDEO_PLAYER";
export const REMOVE_ALL_PLAYERS="REMOVE_ALL_PLAYERS";

// Peer streams is the list from the store
export const checkAddPeerStream = (peerStreams, streamName) => {
  return new Promise((resolve,reject) => {
    // it's not in peer streams so add it
    console.log("checking add");
    if(peerStreams.filter(stream => stream.streamName.includes(streamName)).length === 0 ){
      console.log("adding: "+streamName);
      resolve({type:ADD_PEER_VIDEO_PLAYER,peerStream:{streamName: streamName}});
    }
  })
}

// available streams is the list from WSE
export const checkRemovePeerStream = (availableStreams,streamName) => {
  return new Promise((resolve,reject) => {
    // if it's in peer streams but not availableStreams then remove it
    console.log("checking remove");
    if(!availableStreams.find((stream) => stream.streamName.includes(streamName))){
      console.log("removing: "+streamName);
      resolve({type: REMOVE_PEER_VIDEO_PLAYER,streamName: streamName})
    }
  })
}
