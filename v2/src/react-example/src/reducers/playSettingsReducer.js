import * as PlaySettingsActions from '../actions/playSettingsActions';

const initialState = {
  signalingURL: '',
  stunServerURL: '',
  turnServerURL: '',
  turnUsername: '',
  turnPassword: '',
  applicationName: '',
  streamName: '',
  secret: '',
  timeout: '',
  prefix: 'wowzatoken',
  isIp: false,
  ip: '',
  playStart: false,
  playStarting: false,
  playStop: false,
  playStopping: false,
  useWhep: false,
}

const playSettingsReducer = (state = initialState, action) => {
  switch (action.type) {
    case PlaySettingsActions.SET_PLAY_SIGNALING_URL:
      return { ...state, signalingURL: action.signalingURL };
    case PlaySettingsActions.SET_PLAY_STUN_SERVER_URL:
      return { ...state, stunServerURL: action.stunServerURL };
    case PlaySettingsActions.SET_PLAY_TURN_SERVER_URL:
      return { ...state, turnServerURL: action.turnServerURL};
    case PlaySettingsActions.SET_PLAY_TURN_USERNAME:
      return { ...state, turnUsername: action.turnUsername};
    case PlaySettingsActions.SET_PLAY_TURN_PASSWORD:
      return { ...state, turnPassword: action.turnPassword};
    case PlaySettingsActions.SET_PLAY_APPLICATION_NAME:
      return { ...state, applicationName: action.applicationName };
    case PlaySettingsActions.SET_PLAY_STREAM_NAME:
      return { ...state, streamName: action.streamName };
    case PlaySettingsActions.SET_PLAY_USE_WHEP:
      return { ...state, useWhep: action.useWhep };
    case PlaySettingsActions.SET_PLAY_SECRET:
      console.log(`Secret: ${action.secret}`)
      return { ...state, secret: action.secret };
    case PlaySettingsActions.SET_PLAY_TIMEOUT:
      return { ...state, timeout: action.timeout };
    case PlaySettingsActions.SET_PLAY_PREFIX:
      return { ...state, prefix: action.prefix };
    case PlaySettingsActions.SET_PLAY_IS_IP:
      return { ...state, isIp: action.isIp };
    case PlaySettingsActions.SET_PLAY_IP:
      return { ...state, ip: action.ip };
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