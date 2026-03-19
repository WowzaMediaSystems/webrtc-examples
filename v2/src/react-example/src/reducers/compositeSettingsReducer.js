import * as compositeSettingsActions from '../actions/compositeSettingsActions';

const initialState = {
  layout: 0,
  signalingURL: '',
  applicationName: '',
  streamName: '',
  streamInfo: undefined,
  audioBitrate: '64',
  audioCodec: 'opus',
  audioTrack: undefined,
  audioTrackDeviceId: '',
  videoBitrate: '3500',
  videoTrack: undefined,
  videoTrack1DeviceId: '',
  videoTrack2DeviceId: '',
  videoCodec: 'VP8',
  videoFrameRate: '30',
  videoFrameSize: 'default',
  userData: undefined,
  publishStart: false,
  publishStarting: false,
  publishStop: false,
  publishStopping: false
}

const compositeReducer = (state = initialState, action) => {
  switch (action.type) {
    case compositeSettingsActions.SET_COMPOSITE_LAYOUT:
      return { ...state, layout:action.layout };
    case compositeSettingsActions.SET_COMPOSITE_SIGNALING_URL:
      return { ...state, signalingURL:action.signalingURL };
    case compositeSettingsActions.SET_COMPOSITE_APPLICATION_NAME:
      return { ...state, applicationName:action.applicationName };
    case compositeSettingsActions.SET_COMPOSITE_STREAM_NAME:
      return { ...state, streamName:action.streamName };
    case compositeSettingsActions.SET_COMPOSITE_STREAM_INFO:
      return { ...state, streamInfo:action.streamInfo };
    case compositeSettingsActions.SET_COMPOSITE_AUDIO_BITRATE:
      return { ...state, audioBitrate:action.audioBitrate };
    case compositeSettingsActions.SET_COMPOSITE_AUDIO_CODEC:
      return { ...state, audioCodec:action.audioCodec };
    case compositeSettingsActions.SET_COMPOSITE_AUDIO_TRACK:
      return { ...state, audioTrack:action.audioTrack };
    case compositeSettingsActions.SET_COMPOSITE_AUDIO_TRACK_DEVICEID:
      return { ...state, audioTrackDeviceId:action.audioTrackDeviceId };
    case compositeSettingsActions.SET_COMPOSITE_VIDEO_BITRATE:
      return { ...state, videoBitrate:action.videoBitrate };
    case compositeSettingsActions.SET_COMPOSITE_VIDEO_CODEC:
      return { ...state, videoCodec:action.videoCodec };
    case compositeSettingsActions.SET_COMPOSITE_VIDEO_FRAME_SIZE_AND_RATE:
      let frameState = { ...state };
      if (action.videoFrameSize != null) frameState.videoFrameSize = action.videoFrameSize;
      if (action.videoFrameRate != null) frameState.videoFrameRate = action.videoFrameRate;
      return frameState;
    case compositeSettingsActions.SET_COMPOSITE_VIDEO_TRACK:
      return { ...state, videoTrack:action.videoTrack };
    case compositeSettingsActions.SET_COMPOSITE_VIDEO_TRACK1_DEVICEID:
      return { ...state, videoTrack1DeviceId:action.videoTrack1DeviceId };
    case compositeSettingsActions.SET_COMPOSITE_VIDEO_TRACK2_DEVICEID:
      return { ...state, videoTrack2DeviceId:action.videoTrack2DeviceId };
    case compositeSettingsActions.SET_COMPOSITE_USER_DATA:
      return { ...state, userData:action.userData };
    case compositeSettingsActions.SET_COMPOSITE_FLAGS:
      let publishFlagsState = { ...state };
      if (action.publishStart != null) publishFlagsState.publishStart = action.publishStart;
      if (action.publishStarting != null) publishFlagsState.publishStarting = action.publishStarting;
      if (action.publishStop != null) publishFlagsState.publishStop = action.publishStop;
      if (action.publishStopping != null) publishFlagsState.publishStopping = action.publishStopping;
      return publishFlagsState;
    default:
      return state
  }
}

export default compositeReducer;