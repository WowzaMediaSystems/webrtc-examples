import * as PublishSettingsActions from '../actions/publishSettingsActions';
import { DEFAULT_SIMULCAST_RENDITIONS } from '../utils/SimulcastUtils';
import { DEFAULT_VIDEO_CODEC } from '../utils/CodecUtils';

const initialState = {
  signalingURL: '',
  stunServerURL: '',
  turnServerURL: '',
  turnUsername: '',
  turnPassword: '',
  applicationName: '',
  streamName: '',
  streamInfo: undefined,
  audioTrack: {},
  audioTrackDeviceId: '',
  videoTrack: {},
  videoEnabled: true,
  audioEnabled: true,
  videoTrack1DeviceId: '',
  videoTrack2DeviceId: '',
  videoFrameRate: '30',
  videoFrameSize: 'default',
  videoCodec: DEFAULT_VIDEO_CODEC,
  userData: undefined,
  useWhip: false,
  authToken: '',
  useSimulcast: false,
  latencyProbe: false,
  burnedClock: false,
  simulcastRenditions: DEFAULT_SIMULCAST_RENDITIONS,
  chatEnabled: false,
  captionsEnabled: false,
  publishStart: false,
  publishStarting: false,
  publishStop: false,
  publishStopping: false,
}

const publishSettingsReducer = (state = initialState, action) => {
  switch (action.type) {
    case PublishSettingsActions.SET_PUBLISH_SIGNALING_URL:
      return { ...state, signalingURL:action.signalingURL };
    case PublishSettingsActions.SET_PUBLISH_STUN_SERVER_URL:
      return { ...state, stunServerURL: action.stunServerURL};
    case PublishSettingsActions.SET_PUBLISH_TURN_SERVER_URL:
      return { ...state, turnServerURL: action.turnServerURL};
    case PublishSettingsActions.SET_PUBLISH_TURN_USERNAME:
      return { ...state, turnUsername: action.turnUsername};
    case PublishSettingsActions.SET_PUBLISH_TURN_PASSWORD:
      return { ...state, turnPassword: action.turnPassword};
    case PublishSettingsActions.SET_PUBLISH_APPLICATION_NAME:
      return { ...state, applicationName:action.applicationName };
    case PublishSettingsActions.SET_PUBLISH_STREAM_NAME:
      return { ...state, streamName:action.streamName };
    case PublishSettingsActions.SET_PUBLISH_STREAM_INFO:
      return { ...state, streamInfo:action.streamInfo };
    case PublishSettingsActions.SET_PUBLISH_AUDIO_TRACK:
      return { ...state, audioTrack:action.audioTrack };
    case PublishSettingsActions.SET_PUBLISH_AUDIO_TRACK_DEVICEID:
      return { ...state, audioTrackDeviceId:action.audioTrackDeviceId };
    case PublishSettingsActions.SET_PUBLISH_VIDEO_FRAME_SIZE_AND_RATE: {
      let frameState = { ...state };
      if (action.videoFrameSize != null) frameState.videoFrameSize = action.videoFrameSize;
      if (action.videoFrameRate != null) frameState.videoFrameRate = action.videoFrameRate;
      return frameState;
    }
    case PublishSettingsActions.SET_PUBLISH_VIDEO_TRACK:
      return { ...state, videoTrack:action.videoTrack };
    case PublishSettingsActions.SET_PUBLISH_VIDEO_TRACK1_DEVICEID:
      return { ...state, videoTrack1DeviceId:action.videoTrack1DeviceId };
    case PublishSettingsActions.SET_PUBLISH_VIDEO_TRACK2_DEVICEID:
      return { ...state, videoTrack2DeviceId:action.videoTrack2DeviceId };
    case PublishSettingsActions.SET_PUBLISH_USER_DATA:
      return { ...state, userData:action.userData };
    case PublishSettingsActions.SET_PUBLISH_VIDEO_CODEC:
      return { ...state, videoCodec: action.videoCodec };
    case PublishSettingsActions.SET_PUBLISH_USE_WHIP:
      return { ...state, useWhip: action.useWhip };
    case PublishSettingsActions.SET_PUBLISH_AUTH_TOKEN:
      return { ...state, authToken: action.authToken };
    case PublishSettingsActions.SET_PUBLISH_USE_SIMULCAST:
      return { ...state, useSimulcast: action.useSimulcast };

    case PublishSettingsActions.SET_PUBLISH_LATENCY_PROBE:
      return { ...state, latencyProbe: action.latencyProbe };
    case PublishSettingsActions.SET_PUBLISH_BURNED_CLOCK:
      return { ...state, burnedClock: action.burnedClock };
    case PublishSettingsActions.SET_PUBLISH_SIMULCAST_RENDITIONS:
      return { ...state, simulcastRenditions: action.simulcastRenditions };
    case PublishSettingsActions.SET_PUBLISH_CHAT_ENABLED:
      return { ...state, chatEnabled: action.chatEnabled };
    case PublishSettingsActions.SET_PUBLISH_CAPTIONS_ENABLED:
      return { ...state, captionsEnabled: action.captionsEnabled };
    case PublishSettingsActions.SET_PUBLISH_FLAGS: {
      let publishFlagsState = { ...state };
      if (action.publishStart != null) publishFlagsState.publishStart = action.publishStart;
      if (action.publishStarting != null) publishFlagsState.publishStarting = action.publishStarting;
      if (action.publishStop != null) publishFlagsState.publishStop = action.publishStop;
      if (action.publishStopping != null) publishFlagsState.publishStopping = action.publishStopping;
      return publishFlagsState;
    }
    // Plain flags; TrackEnabledSync applies them to whatever tracks are current.
    case PublishSettingsActions.TOGGLE_VIDEO_ENABLED:
      if (!state.videoTrack) return state
      return { ...state, videoEnabled: !state.videoEnabled }
    case PublishSettingsActions.TOGGLE_AUDIO_ENABLED:
      if (!state.audioTrack) return state
      return { ...state, audioEnabled: !state.audioEnabled }
    default:
      return state
  }
}

export default publishSettingsReducer;