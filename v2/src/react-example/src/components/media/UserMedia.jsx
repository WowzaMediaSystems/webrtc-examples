import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import ErrorMessages from '../../constants/ErrorMessages';
import { videoConstraintsByFrameSize } from '../../constants/PublishOptions';

import * as ErrorsActions from '../../actions/errorsActions';
import * as MediaActions from '../../actions/mediaActions';
import * as PublishSettingsActions from '../../actions/publishSettingsActions';

import getUserMedia from '../../webrtc/getUserMedia';

const loadUserMedia = async (dispatch, constraints, videoFrameSize, videoFrameRate) => {

  console.log('** loadUserMedia: ' + JSON.stringify(constraints));
  dispatch({type:MediaActions.SET_MEDIA_USERMEDIA_STATE,userMediaLoading:true});

  let stream;
  try {
    stream = await getUserMedia(constraints);
  }
  catch (error1) {
    stream = undefined;
    if (videoFrameSize === 'default')
    {
      console.log(error1);
      dispatch ({type:ErrorsActions.SET_ERROR_MESSAGE,message:ErrorMessages.loadingUserMedia});
    }
    else
    {
      dispatch ({type:ErrorsActions.SET_ERROR_MESSAGE,message:"Your camera doesn't support this resolution: "+videoFrameSize});
      dispatch ({type:PublishSettingsActions.SET_PUBLISH_VIDEO_FRAME_SIZE_AND_RATE,videoFrameSize:'default'});
      dispatch (MediaActions.setCameraFrameSizeAndRate(constraints,"default",videoFrameRate));
    }
  }
  if (stream != null)
  {
    try {
      let audioTracks = stream.getAudioTracks();
      let videoTracks = stream.getVideoTracks();

      dispatch ({type:PublishSettingsActions.SET_PUBLISH_AUDIO_TRACK, audioTrack:audioTracks[0]});
      dispatch ({type:PublishSettingsActions.SET_PUBLISH_VIDEO_TRACK, videoTrack:videoTracks[0]});

      dispatch ({type:MediaActions.SET_MEDIA_STREAM, stream:stream});
      dispatch ({type:MediaActions.SET_MEDIA_USERMEDIA_STATE,userMediaLoading:false,userMediaLoaded:true});
    }
    catch (error2) {
      console.log(error2);
      dispatch ({type:ErrorsActions.SET_ERROR_MESSAGE,message:ErrorMessages.loadingUserMedia});
    }
  }
}

const UserMedia = () => {

  const dispatch = useDispatch();
  const constraints = useSelector((state) => state.media.constraints);
  const { videoFrameSize, videoFrameRate } = useSelector((state) => state.publishSettings);

  useEffect(() => {

    loadUserMedia(dispatch, constraints, videoFrameSize, videoFrameRate);

  }, [constraints, dispatch]);


  return <></>;
}

export default UserMedia;