import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import ErrorMessages from '../../constants/ErrorMessages';

import * as ErrorsActions from '../../actions/errorsActions';
import * as MediaActions from '../../actions/mediaActions';
import * as PublishSettingsActions from '../../actions/publishSettingsActions';

import getDevices from '../../webrtc/getDevices';


const loadDevices = async (dispatch) => {

  dispatch({type:MediaActions.SET_MEDIA_DEVICES_STATE,devicesLoading:true});

  try {
    let { cameras, microphones } = await getDevices();
    dispatch ({type:MediaActions.SET_MEDIA_CAMERAS, cameras});
    dispatch ({type:MediaActions.SET_MEDIA_MICROPHONES, microphones});
    dispatch ({type:MediaActions.SET_MEDIA_DEVICES_STATE, devicesLoading:false, devicesLoaded:true});
    if (cameras.length > 0)
      dispatch ({type:PublishSettingsActions.SET_PUBLISH_VIDEO_TRACK1_DEVICEID,videoTrack1DeviceId:cameras[0].deviceId});
    if (microphones.length > 0)
      dispatch ({type:PublishSettingsActions.SET_PUBLISH_AUDIO_TRACK_DEVICEID,audioTrackDeviceId:microphones[0].deviceId});
  }
  catch (error) {
    console.log(error);
    dispatch ({type:ErrorsActions.SET_ERROR_MESSAGE, message:ErrorMessages.loadingUserDevices + ': ' + error.message});
  }
}

const Devices = () => {

  const dispatch = useDispatch();
  const { gotPermissions } = useSelector((state) => state.media);

  useEffect(() => {

    if (gotPermissions)
      loadDevices(dispatch);

  }, [dispatch,gotPermissions]);


  return <></>;
}

export default Devices;