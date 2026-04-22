import React, { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { videoConstraintsByFrameSize } from '../../constants/PublishOptions';

import * as MediaActions from '../../actions/mediaActions';
import * as PublishSettingsActions from '../../actions/publishSettingsActions';

import getUserMedia from '../../webrtc/getUserMedia';
import getDisplayScreen from '../../webrtc/getDisplayScreen';

// Mobile hardware (iOS/Android) typically only allows one camera open at a time —
// the ISP is single-tenant, so keeping multiple camera tracks live raises
// NotReadableError on the second acquisition.
const isMobile = () => /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

const getPermissions = async (dispatch) => {

  let gotPermissions = false;
  try
  {
    const stream = await getUserMedia({video:videoConstraintsByFrameSize.default,audio:true});
    // Release the probe tracks so they don't hold the camera on mobile.
    stream.getTracks().forEach((t) => t.stop());
    gotPermissions = true;
  }
  catch(e) {}
  dispatch({type:MediaActions.SET_MEDIA_GOT_PERMISSIONS,gotPermissions:gotPermissions});
}

const loadUserMediaForCameras  = async (dispatch, cameras, videoTracksMap) => {

  let newVideoTracksMap = {...videoTracksMap};
  for (let i = 0; i < cameras.length; i++)
  {
    let constraints = { video:{...videoConstraintsByFrameSize.default}, audio:false };
    constraints.video.deviceId = cameras[i].deviceId;

    try {

      let stream = await getUserMedia(constraints);
      let videoTracks = stream.getVideoTracks();
      if (videoTracks.length > 0) {
        newVideoTracksMap[cameras[i].deviceId] = videoTracks[0];
      }

    } catch (e) {
      console.error("Loading camera had error", e)
    }
  }
  dispatch({type:MediaActions.SET_MEDIA_TRACKS,videoTracksMap:newVideoTracksMap});
}

// Serialize mobile camera switches. The effect can fire multiple times in
// close succession (e.g. cameras list populates and selection is set in the
// same tick) and overlapping getUserMedia calls fight for the same ISP.
let singleCameraChain = Promise.resolve();

const tryGetUserMedia = async (deviceId) => {
  // Prefer `exact` so Android Chrome actually switches to the requested
  // camera rather than treating the id as a soft hint.
  const constraints = {
    video: { ...videoConstraintsByFrameSize.default, deviceId: { exact: deviceId } },
    audio: false
  };
  return getUserMedia(constraints);
};

const loadUserMediaForSingleCamera = (dispatch, deviceId, videoTracksMapRef) => {
  const run = async () => {
    // Stop every previously-held camera track before opening a new one.
    // Read from the ref at execution time so queued calls see the latest map.
    const currentMap = videoTracksMapRef.current || {};
    Object.values(currentMap).forEach((t) => { if (t && typeof t.stop === 'function') t.stop(); });

    // Clear references so the preview <video> detaches its srcObject. iOS
    // Safari and Android Chrome both keep the camera hardware pinned until
    // the video element picks up the null srcObject. We deliberately do NOT
    // dispatch SET_PUBLISH_VIDEO_TRACK here — PublishVideoDropdown reacts to
    // the empty videoTracksMap and dispatches `videoTrack: undefined`, which
    // replaceVideoTrack handles as a no-op. Dispatching `{}` would trip the
    // addTrack(...) crash while publishing.
    dispatch({type:MediaActions.SET_MEDIA_TRACKS,videoTracksMap:{}});
    dispatch({type:MediaActions.SET_MEDIA_STREAM,stream:null});

    // Wait two animation frames so React commits the clears and the browser
    // releases the capture session before we request the next camera.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    let newVideoTracksMap = {};
    if (!deviceId) {
      dispatch({type:MediaActions.SET_MEDIA_TRACKS,videoTracksMap:newVideoTracksMap});
      return;
    }

    try {
      let stream;
      try {
        stream = await tryGetUserMedia(deviceId);
      } catch (e) {
        // Android camera HAL can take a few hundred ms to release the previous
        // session. rAF isn't always long enough, so retry once after a delay.
        if (e && e.name === 'NotReadableError') {
          await new Promise((resolve) => setTimeout(resolve, 400));
          stream = await tryGetUserMedia(deviceId);
        } else {
          throw e;
        }
      }
      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length > 0) {
        newVideoTracksMap[deviceId] = videoTracks[0];
      }
    } catch (e) {
      console.error("Loading camera had error", e);
    }
    dispatch({type:MediaActions.SET_MEDIA_TRACKS,videoTracksMap:newVideoTracksMap});
  };

  singleCameraChain = singleCameraChain.then(run, run);
  return singleCameraChain;
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
  videoTracksMapRef.current = videoTracksMap;
  audioTracksMapRef.current = audioTracksMap;

  // get permissions on page load
  useEffect(() => {
    getPermissions(dispatch);
  }, [dispatch]);

  // get video tracks for cameras. On desktop we eagerly open every camera so
  // consumers can preview/switch instantly. On mobile the hardware only allows
  // one camera open at a time, so we acquire just the currently-selected one
  // and stop it before opening another.
  useEffect(() => {
    if (!gotPermissions) return;
    if (isMobile()) {
      let desired = publishVideoTrack1DeviceId;
      if (!desired || desired === 'screen') desired = compositeVideoTrack1DeviceId;
      if (!desired || desired === 'screen') desired = cameras[0] != null ? cameras[0].deviceId : '';
      loadUserMediaForSingleCamera(dispatch, desired, videoTracksMapRef);
    } else {
      loadUserMediaForCameras(dispatch, cameras, videoTracksMapRef.current);
    }
  }, [dispatch,gotPermissions,cameras,publishVideoTrack1DeviceId,compositeVideoTrack1DeviceId]);

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