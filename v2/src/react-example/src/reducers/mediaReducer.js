import * as MediaActions from '../actions/mediaActions';
import { videoConstraintsByFrameSize } from '../constants/PublishOptions';

const initialState = {
  stream: undefined,
  canvas: undefined,
  audioTracksMap: {},
  videoTracksMap: {},
  displayScreenTrack: undefined,
  cameras: [],
  microphones: [],
  constraints: {video:videoConstraintsByFrameSize['default'],audio:true},
  gotPermissions: false,
  devicesLoaded: false,
  devicesLoading: false,
  userMediaLoaded: false,
  userMediaLoading: false
}

const mediaReducer = (state = initialState, action) => {
  switch (action.type) {
    case MediaActions.SET_MEDIA_CANVAS:
      return { ...state, canvas:action.canvas };
    case MediaActions.SET_MEDIA_CONSTRAINTS:
      return { ...state, constraints:action.constraints };
    case MediaActions.SET_MEDIA_STREAM:
      return { ...state, stream:action.stream };
    case MediaActions.SET_MEDIA_TRACKS:
      let mediaTracksState = { ...state };
      if (action.videoTracksMap != null) mediaTracksState.videoTracksMap = action.videoTracksMap;
      if (action.audioTracksMap != null) mediaTracksState.audioTracksMap = action.audioTracksMap;
      if (action.displayScreenTrack != null) mediaTracksState.displayScreenTrack = action.displayScreenTrack;
      return mediaTracksState;
    case MediaActions.SET_MEDIA_GOT_PERMISSIONS:
      return { ...state, gotPermissions:action.gotPermissions };
    case MediaActions.SET_MEDIA_CAMERAS:
      let camerasState = { ...state };
      camerasState.cameras = action.cameras;
      if (camerasState.constraints.video.deviceId == null && action.cameras.length > 0)
      {
        let newConstraints = JSON.parse(JSON.stringify(camerasState.constraints));
        newConstraints.video.deviceId = action.cameras[0].deviceId;
        camerasState.constraints = newConstraints;
      }
      return camerasState;
    case MediaActions.SET_MEDIA_MICROPHONES:
      let microphonesState = { ...state };
      microphonesState.microphones = action.microphones;
      if (microphonesState.constraints.audio.deviceId == null && action.microphones.length > 0)
      {
        let newConstraints = JSON.parse(JSON.stringify(microphonesState.constraints));
        if (typeof newConstraints.audio === 'boolean') newConstraints.audio = {};
        newConstraints.audio.deviceId = action.microphones[0].deviceId;
        microphonesState.constraints = newConstraints;
      }
      return microphonesState;
    case MediaActions.SET_MEDIA_DEVICES_STATE:
      let devicesState = { ...state };
      if (action.devicesLoaded != null) devicesState.devicesLoaded = action.devicesLoaded;
      if (action.devicesLoading != null) devicesState.devicesLoading = action.devicesLoading;
      return devicesState;
    case MediaActions.SET_MEDIA_USERMEDIA_STATE:
      let userMediaState = { ...state };
      if (action.userMediaLoaded != null) userMediaState.userMediaLoaded = action.userMediaLoaded;
      if (action.userMediaLoading != null) userMediaState.userMediaLoading = action.userMediaLoading;
      return userMediaState;
    case MediaActions.SET_MEDIA_SCREEN_SHARE_ENDED:
      return { ...state, displayScreenTrack:undefined };
    default:
      return state
  }
}

export default mediaReducer;
