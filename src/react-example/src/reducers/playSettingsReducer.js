import * as PlaySettingsActions from '../actions/playSettingsActions';

const initialState = {
  signalingURL: '',
  applicationName: '',
  streamName: '',
  playStart: false,
  playStarting: false,
  playStop: false,
  playStopping: false
}

const playSettingsReducer = (state = initialState, action) => {
  switch (action.type) {
    case PlaySettingsActions.SET_PLAY_SIGNALING_URL:
      return { ...state, signalingURL:action.signalingURL };
    case PlaySettingsActions.SET_PLAY_APPLICATION_NAME:
      return { ...state, applicationName:action.applicationName };
    case PlaySettingsActions.SET_PLAY_STREAM_NAME:
      return { ...state, streamName:action.streamName };
    case PlaySettingsActions.SET_PLAY_FLAGS:
      let playFlagsState = { ...state };
      if (action.playStart != null) playFlagsState.playStart = action.playStart;
      if (action.playStarting != null) playFlagsState.playStarting = action.playStarting;
      if (action.playStop != null) playFlagsState.playStop = action.playStop;
      if (action.playStopping != null) playFlagsState.playStopping = action.playStopping;
      return playFlagsState;
    default:
      return state
  }
}

export default playSettingsReducer;
