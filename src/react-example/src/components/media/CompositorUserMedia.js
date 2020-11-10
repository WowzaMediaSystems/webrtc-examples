import React, { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { videoConstraintsByFrameSize } from '../../constants/PublishOptions';

import * as MediaActions from '../../actions/mediaActions';
import * as PublishSettingsActions from '../../actions/publishSettingsActions';

import getUserMedia from '../../webrtc/getUserMedia';
import getDisplayScreen from '../../webrtc/getDisplayScreen';

const getPermissions = async (dispatch) => {

  let gotPermissions = false;
  try
  {
    await getUserMedia({video:videoConstraintsByFrameSize.default,audio:true});
    gotPermissions = true;
  }
  catch(e) {}
  dispatch({type:MediaActions.SET_MEDIA_GOT_PERMISSIONS,gotPermissions:gotPermissions});
}

const loadUserMediaForCameras  = async (dispatch, cameras, videoTracksMap) => {

  let newVideoTracksMap = {...videoTracksMap};
  for (let i = 0; i < cameras.length; i++)
  {
    let constraints = { video:videoConstraintsByFrameSize.default, audio:false };
    constraints.video.deviceId = cameras[i].deviceId;

    try {

      let stream = await getUserMedia(constraints);
      let videoTracks = stream.getVideoTracks();
      if (videoTracks.length > 0) {
        newVideoTracksMap[cameras[i].deviceId] = videoTracks[0];
      }

    } catch (e) {
    }
  }
  dispatch({type:MediaActions.SET_MEDIA_TRACKS,videoTracksMap:newVideoTracksMap});
}

const onScreenShareEnded = (dispatch) => {
  console.log('onScreenShareEnded');
  dispatch({type:PublishSettingsActions.SET_PUBLISH_VIDEO_TRACK1_DEVICEID,videoTrack1DeviceId:'none'});
  dispatch({type:MediaActions.SET_MEDIA_SCREEN_SHARE_ENDED});
}

const loadDisplayScreenTrack = async (dispatch) => {

  getDisplayScreen()
  .then( (stream) => {
    let screenTrack = stream.getVideoTracks()[0];
    screenTrack.onended = () => { onScreenShareEnded(dispatch); };
    dispatch({type:MediaActions.SET_MEDIA_TRACKS,displayScreenTrack:screenTrack});
  })
  .catch( (e) => {

  });
}

const loadUserMediaForMicrophones = async (dispatch, microphones, audioTracksMap) => {

  let newAudioTracksMap = {...audioTracksMap};
  for (let i = 0; i < microphones.length; i++)
  {
    let constraints = { audio:{} };
    constraints.audio.deviceId = microphones[i].deviceId;

    try {

      let stream = await getUserMedia(constraints);
      let audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        newAudioTracksMap[microphones[i].deviceId] = audioTracks[0];
      }

    } catch (e) {
    }
  }
  dispatch({type:MediaActions.SET_MEDIA_TRACKS,audioTracksMap:newAudioTracksMap});
}

const CompositorUserMedia = () => {

  const dispatch = useDispatch();
  const { gotPermissions, cameras, microphones, videoTracksMap, audioTracksMap, displayScreenTrack } = useSelector((state) => state.media);
  const { videoTrack1DeviceId : publishVideoTrack1DeviceId } = useSelector((state) => state.publishSettings);
  const { videoTrack1DeviceId : compositeVideoTrack1DeviceId } = useSelector((state) => state.compositeSettings);
  const videoTracksMapRef = useRef(videoTracksMap);
  const audioTracksMapRef = useRef(audioTracksMap);

  // get permissions on page load
  useEffect(() => {
    getPermissions(dispatch);
  }, [dispatch]);

  // get video track for each camera
  useEffect(() => {
    if (gotPermissions)
      loadUserMediaForCameras(dispatch, cameras, videoTracksMapRef.current);
  }, [dispatch,gotPermissions,cameras]);

  // get audio track for each microphone
  useEffect(() => {
    if (gotPermissions)
      loadUserMediaForMicrophones(dispatch, microphones, audioTracksMapRef.current);
  }, [dispatch,gotPermissions,microphones]);

  // start screen sharing for 'publish' example
  useEffect(() => {
    if (publishVideoTrack1DeviceId === 'screen' && displayScreenTrack == null) {
      loadDisplayScreenTrack(dispatch);
    }
  }, [dispatch,publishVideoTrack1DeviceId, displayScreenTrack])

  // start screen sharing for 'composite' example
  useEffect(() => {
    if (compositeVideoTrack1DeviceId === 'screen' && displayScreenTrack == null) {
      loadDisplayScreenTrack(dispatch);
    }
  }, [dispatch,compositeVideoTrack1DeviceId, displayScreenTrack])

  useEffect(() => {
    let audioTrack = null;
    let videoTrack = null;
    if (Object.keys(audioTracksMap).length > 0) {
      audioTrack = audioTracksMap[Object.keys(audioTracksMap)[0]];
    }
    if (Object.keys(videoTracksMap).length > 0) {
      videoTrack = videoTracksMap[Object.keys(videoTracksMap)[0]];
    }
    if (audioTrack != null || videoTrack != null)
    {
      let stream = new MediaStream();
      if (audioTrack != null) stream.addTrack(audioTrack);
      if (videoTrack != null) stream.addTrack(videoTrack);
      dispatch({type:MediaActions.SET_MEDIA_STREAM,stream:stream});
    }
  }, [dispatch,audioTracksMap,videoTracksMap])

  return <></>;
}

export default CompositorUserMedia;