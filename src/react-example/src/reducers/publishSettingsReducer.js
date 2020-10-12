import * as PublishSettingsActions from '../actions/publishSettingsActions';

const initialState = {
  signalingURL: '',
  applicationName: '',
  streamName: '',
  streamInfo: undefined,
  audioBitrate: '64',
  audioCodec: 'opus',
  audioTrack: {},
  audioTrackDeviceId: '',
  videoBitrate: '3500',
  videoTrack: {},
  videoTrack1DeviceId: '',
  videoTrack2DeviceId: '',
  videoCodec: 'VP8',
  videoFrameRate: '30',
  videoFrameSize: 'default',
  userData: undefined,
  publishStart: false,
  publishStarting: false,
  publishStop: false,
  publishStopping: false,
}

const publishSettingsReducer = (state = initialState, action) => {
  switch (action.type) {
    case PublishSettingsActions.SET_PUBLISH_SIGNALING_URL:
      return { ...state, signalingURL:action.signalingURL };
    case PublishSettingsActions.SET_PUBLISH_APPLICATION_NAME:
      return { ...state, applicationName:action.applicationName };
    case PublishSettingsActions.SET_PUBLISH_STREAM_NAME:
      return { ...state, streamName:action.streamName };
    case PublishSettingsActions.SET_PUBLISH_STREAM_INFO:
      return { ...state, streamInfo:action.streamInfo };
    case PublishSettingsActions.SET_PUBLISH_AUDIO_BITRATE:
      return { ...state, audioBitrate:action.audioBitrate };
    case PublishSettingsActions.SET_PUBLISH_AUDIO_CODEC:
      return { ...state, audioCodec:action.audioCodec };
    case PublishSettingsActions.SET_PUBLISH_AUDIO_TRACK:
      return { ...state, audioTrack:action.audioTrack };
    case PublishSettingsActions.SET_PUBLISH_AUDIO_TRACK_DEVICEID:
      return { ...state, audioTrackDeviceId:action.audioTrackDeviceId };
    case PublishSettingsActions.SET_PUBLISH_VIDEO_BITRATE:
      return { ...state, videoBitrate:action.videoBitrate };
    case PublishSettingsActions.SET_PUBLISH_VIDEO_CODEC:
      return { ...state, videoCodec:action.videoCodec };
    case PublishSettingsActions.SET_PUBLISH_VIDEO_FRAME_SIZE_AND_RATE:
      let frameState = { ...state };
      if (action.videoFrameSize != null) frameState.videoFrameSize = action.videoFrameSize;
      if (action.videoFrameRate != null) frameState.videoFrameRate = action.videoFrameRate;
      return frameState;
    case PublishSettingsActions.SET_PUBLISH_VIDEO_TRACK:
      return { ...state, videoTrack:action.videoTrack };
    case PublishSettingsActions.SET_PUBLISH_VIDEO_TRACK1_DEVICEID:
      return { ...state, videoTrack1DeviceId:action.videoTrack1DeviceId };
    case PublishSettingsActions.SET_PUBLISH_VIDEO_TRACK2_DEVICEID:
      return { ...state, videoTrack2DeviceId:action.videoTrack2DeviceId };
    case PublishSettingsActions.SET_PUBLISH_USER_DATA:
      return { ...state, userData:action.userData };
    case PublishSettingsActions.SET_PUBLISH_FLAGS:
      let publishFlagsState = { ...state };
      if (action.publishStart != null) publishFlagsState.publishStart = action.publishStart;
      if (action.publishStarting != null) publishFlagsState.publishStarting = action.publishStarting;
      if (action.publishStop != null) publishFlagsState.publishStop = action.publishStop;
      if (action.publishStopping != null) publishFlagsState.publishStopping = action.publishStopping;
      return publishFlagsState;
    case PublishSettingsActions.TOGGLE_VIDEO_ENABLED:
      let videoTrackState = { ...state }
      videoTrackState.videoTrack.enabled = !videoTrackState.videoTrack.enabled
      return videoTrackState
    case PublishSettingsActions.TOGGLE_AUDIO_ENABLED:
      let audioTrackState = { ...state }
      audioTrackState.audioTrack.enabled = !audioTrackState.audioTrack.enabled
      return audioTrackState
    default:
      return state
  }
}

export default publishSettingsReducer;
