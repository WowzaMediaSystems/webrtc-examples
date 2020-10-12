import * as WebRTCPublishActions from '../actions/webrtcPublishActions';

const initialState = {
  websocket: undefined,
  peerConnection: undefined,
  peerConnectionVideoSender: undefined,
  peerConnectionAudioSender: undefined,
  connected: false
}

const webrtcPublishReducer = (state = initialState, action) => {
  switch (action.type) {
    case WebRTCPublishActions.SET_WEBRTC_PUBLISH_WEBSOCKET:
      return { ...state, websocket:action.websocket };
    case WebRTCPublishActions.SET_WEBRTC_PUBLISH_PEERCONNECTION:
      return { ...state, peerConnection:action.peerConnection };
    case WebRTCPublishActions.SET_WEBRTC_PUBLISH_CONNECTED:
      return { ...state, connected:action.connected };
    case WebRTCPublishActions.SET_WEBRTC_PUBLISH_PEERCONNECTION_AUDIO_SENDER:
      return { ...state, peerConnectionAudioSender:action.peerConnectionAudioSender};
    case WebRTCPublishActions.SET_WEBRTC_PUBLISH_PEERCONNECTION_VIDEO_SENDER:
      return { ...state, peerConnectionVideoSender:action.peerConnectionVideoSender};
    default:
      return state
  }
}

export default webrtcPublishReducer;
