import * as WebRTCMeetingActions from '../actions/webrtcMeetingActions';

const initialState = {
  websocket: undefined,
  peerConnection: undefined,
  peerConnectionVideoSender: undefined,
  peerConnectionAudioSender: undefined,
  connected: false,
  peerStreams: []
}
let newPeerStreams;
const webrtcMeetingReducer = (state = initialState, action) => {
  switch (action.type) {
    case WebRTCMeetingActions.SET_WEBRTC_MEETING_WEBSOCKET:
      return { ...state, websocket:action.websocket };
    case WebRTCMeetingActions.SET_WEBRTC_MEETING_PEERCONNECTION:
      return { ...state, peerConnection:action.peerConnection };
    case WebRTCMeetingActions.SET_WEBRTC_MEETING_CONNECTED:
      return { ...state, connected:action.connected };
    case WebRTCMeetingActions.SET_WEBRTC_MEETING_PEERCONNECTION_AUDIO_SENDER:
      return { ...state, peerConnectionAudioSender:action.peerConnectionAudioSender};
    case WebRTCMeetingActions.SET_WEBRTC_MEETING_PEERCONNECTION_VIDEO_SENDER:
      return { ...state, peerConnectionVideoSender:action.peerConnectionVideoSender};
    case WebRTCMeetingActions.ADD_PEER_VIDEO_PLAYER:
      newPeerStreams =  state.peerStreams.slice();
      newPeerStreams.push(action.peerStream);
      return { ...state, peerStreams:newPeerStreams};
    case WebRTCMeetingActions.REMOVE_PEER_VIDEO_PLAYER:
      console.log("reducer: "+action);
      newPeerStreams =  state.peerStreams.slice();
      newPeerStreams = newPeerStreams.filter(stream => !(stream.streamName === action.streamName))
      console.log(newPeerStreams);
      return { ...state, peerStreams:newPeerStreams};
    case WebRTCMeetingActions.REMOVE_ALL_PLAYERS:
      return { ...state, peerStreams:[]};
    default:
      return state
  }
}

export default webrtcMeetingReducer;
