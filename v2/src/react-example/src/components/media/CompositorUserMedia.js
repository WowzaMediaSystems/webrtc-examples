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

// ---------------------------------------------------------------------------
// Centralized device-track management
//
// All getUserMedia / getDisplayMedia access funnels through here so media tracks
// have exactly one owner. Two invariants keep device handles (and the OS
// "in use" indicator) from leaking:
//
//   1. SINGLE QUEUE. Every operation that opens or closes a device runs through
//      `enqueue`, so two operations can never open the same device concurrently
//      and orphan one of the resulting tracks. (Earlier versions used three
//      independent promise chains that raced each other.)
//
//   2. REGISTRY-BASED RELEASE. Every track getUserMedia hands back is recorded in
//      `openedTracks` the instant it is created. `releaseAllTracks` stops
//      everything in that set — NOT just whatever happens to be in the redux map.
//      So a track that was replaced or dropped from the map can never leak: it is
//      still in the registry until explicitly stopped.
//
// When adding a new media source, preserve both: open it via `enqueue`,
// `registerTrack` the result immediately, and always `stopTrack` (never a bare
// `track.stop()`) so the registry stays in sync.
// ---------------------------------------------------------------------------

let opQueue = Promise.resolve();
const enqueue = (op) => { opQueue = opQueue.then(op, op); return opQueue; };

// True when two track maps hold the same deviceId -> track entries. Used to avoid
// re-dispatching an identical map: a fresh object identity would needlessly retrigger
// every downstream effect (e.g. the stream builder), which on a camera switch fights
// the page's own selected-track stream.
const sameTracks = (a, b) => {
  const ak = Object.keys(a || {});
  const bk = Object.keys(b || {});
  return ak.length === bk.length && ak.every((k) => a[k] === b[k]);
};

const openedTracks = new Set();
const registerTrack = (t) => { if (t) openedTracks.add(t); };
const stopTrack = (t) => {
  if (t && typeof t.stop === 'function') t.stop();
  openedTracks.delete(t);
};

// Stop every device this app has opened and clear the redux media state. Iterating
// the registry (not the redux maps) is what makes this leak-proof.
const releaseAllTracks = (dispatch) => {
  openedTracks.forEach((t) => { if (t && typeof t.stop === 'function') t.stop(); });
  openedTracks.clear();
  dispatch({type:MediaActions.SET_MEDIA_TRACKS, videoTracksMap:{}, audioTracksMap:{}});
  dispatch({type:MediaActions.SET_MEDIA_SCREEN_SHARE_ENDED}); // clears displayScreenTrack
  dispatch({type:MediaActions.SET_MEDIA_STREAM, stream:null});
};

const getPermissions = (dispatch) => enqueue(async () => {
  let gotPermissions = false;
  try
  {
    const stream = await getUserMedia({video:videoConstraintsByFrameSize.default,audio:true});
    // Release the probe tracks immediately so they don't hold the camera on mobile.
    stream.getTracks().forEach((t) => t.stop());
    gotPermissions = true;
  }
  catch(e) {}
  dispatch({type:MediaActions.SET_MEDIA_GOT_PERMISSIONS,gotPermissions:gotPermissions});
});

// On desktop we eagerly open every camera so consumers can preview/switch instantly.
const loadUserMediaForCameras = (dispatch, cameras, videoTracksMapRef, mountedRef) => enqueue(async () => {
  let newVideoTracksMap = {...(videoTracksMapRef.current || {})};
  for (let i = 0; i < cameras.length; i++)
  {
    // Reuse a camera we already hold so we don't open (and orphan) a second track.
    let existing = newVideoTracksMap[cameras[i].deviceId];
    if (existing && existing.readyState === 'live') continue;

    // Use `exact` so the browser opens the requested camera. A bare deviceId is only
    // a soft hint that Chrome ignores, returning the default camera for every request
    // — which makes every preview show the same physical device.
    let constraints = { video:{...videoConstraintsByFrameSize.default, deviceId:{ exact: cameras[i].deviceId }}, audio:false };

    try {
      let stream = await getUserMedia(constraints);
      let track = stream.getVideoTracks()[0];
      if (!track) continue;
      registerTrack(track);
      // If we unmounted while getUserMedia was in flight, stop the fresh track now
      // instead of keeping it — the page that needed it is already gone.
      if (mountedRef && !mountedRef.current) { stopTrack(track); return; }
      newVideoTracksMap[cameras[i].deviceId] = track;
    } catch (e) {
      console.error("Loading camera had error", e)
    }
  }
  // Only dispatch when the set of tracks actually changed, so a camera switch (which
  // re-runs this effect but reuses every live track) doesn't churn videoTracksMap.
  if (!sameTracks(newVideoTracksMap, videoTracksMapRef.current)) {
    dispatch({type:MediaActions.SET_MEDIA_TRACKS,videoTracksMap:newVideoTracksMap});
  }
});

const tryGetUserMedia = async (deviceId) => {
  // Prefer `exact` so Android Chrome actually switches to the requested
  // camera rather than treating the id as a soft hint.
  const constraints = {
    video: { ...videoConstraintsByFrameSize.default, deviceId: { exact: deviceId } },
    audio: false
  };
  return getUserMedia(constraints);
};

// On mobile the hardware only allows one camera open at a time, so we stop the
// current camera before opening the requested one.
const loadUserMediaForSingleCamera = (dispatch, deviceId, videoTracksMapRef, mountedRef) => enqueue(async () => {
  // Stop every previously-held camera track before opening a new one.
  Object.values(videoTracksMapRef.current || {}).forEach((t) => stopTrack(t));

  // Clear references so the preview <video> detaches its srcObject. iOS Safari and
  // Android Chrome both keep the camera hardware pinned until the video element
  // picks up the null srcObject. We deliberately do NOT dispatch SET_PUBLISH_VIDEO_TRACK
  // here — PublishVideoDropdown reacts to the empty videoTracksMap and dispatches
  // `videoTrack: undefined`, which replaceVideoTrack handles as a no-op. Dispatching
  // `{}` would trip the addTrack(...) crash while publishing.
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
    const track = stream.getVideoTracks()[0];
    if (track) {
      registerTrack(track);
      if (mountedRef && !mountedRef.current) { stopTrack(track); return; }
      newVideoTracksMap[deviceId] = track;
    }
  } catch (e) {
    console.error("Loading camera had error", e);
  }
  dispatch({type:MediaActions.SET_MEDIA_TRACKS,videoTracksMap:newVideoTracksMap});
});

const onScreenShareEnded = (dispatch) => {
  dispatch({type:PublishSettingsActions.SET_PUBLISH_VIDEO_TRACK1_DEVICEID,videoTrack1DeviceId:'none'});
  dispatch({type:MediaActions.SET_MEDIA_SCREEN_SHARE_ENDED});
}

const loadDisplayScreenTrack = (dispatch, mountedRef) => enqueue(async () => {
  try {
    const stream = await getDisplayScreen();
    const screenTrack = stream.getVideoTracks()[0];
    if (!screenTrack) return;
    registerTrack(screenTrack);
    if (mountedRef && !mountedRef.current) { stopTrack(screenTrack); return; }
    screenTrack.onended = () => { stopTrack(screenTrack); onScreenShareEnded(dispatch); };
    dispatch({type:MediaActions.SET_MEDIA_TRACKS,displayScreenTrack:screenTrack});
  } catch (e) {
  }
});

const loadUserMediaForMicrophones = (dispatch, microphones, audioTracksMapRef, mountedRef) => enqueue(async () => {
  let newAudioTracksMap = {...(audioTracksMapRef.current || {})};
  for (let i = 0; i < microphones.length; i++)
  {
    // Reuse a microphone we already hold so re-runs don't orphan the previous track.
    let existing = newAudioTracksMap[microphones[i].deviceId];
    if (existing && existing.readyState === 'live') continue;

    // `exact` for the same reason as cameras: a soft deviceId hint can be ignored.
    let constraints = { audio:{ deviceId:{ exact: microphones[i].deviceId } } };

    try {
      let stream = await getUserMedia(constraints);
      let track = stream.getAudioTracks()[0];
      if (!track) continue;
      registerTrack(track);
      if (mountedRef && !mountedRef.current) { stopTrack(track); return; }
      newAudioTracksMap[microphones[i].deviceId] = track;
    } catch (e) {
    }
  }
  if (!sameTracks(newAudioTracksMap, audioTracksMapRef.current)) {
    dispatch({type:MediaActions.SET_MEDIA_TRACKS,audioTracksMap:newAudioTracksMap});
  }
});

const CompositorUserMedia = () => {

  const dispatch = useDispatch();
  const { gotPermissions, cameras, microphones, videoTracksMap, audioTracksMap, displayScreenTrack } = useSelector((state) => state.media);
  const { videoTrack1DeviceId : publishVideoTrack1DeviceId } = useSelector((state) => state.publishSettings);
  const { videoTrack1DeviceId : compositeVideoTrack1DeviceId } = useSelector((state) => state.compositeSettings);
  const videoTracksMapRef = useRef(videoTracksMap);
  const audioTracksMapRef = useRef(audioTracksMap);
  videoTracksMapRef.current = videoTracksMap;
  audioTracksMapRef.current = audioTracksMap;

  // Tracks whether this component is still mounted. The async loaders read it after
  // getUserMedia resolves so a load that finishes after the user has navigated away
  // stops its track instead of leaking a live (orphaned) device.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    // Release every device we opened when the user leaves the page that mounts this
    // component. Registry-based release also reaps any orphan a race may have left.
    return () => {
      mountedRef.current = false;
      releaseAllTracks(dispatch);
    };
  }, [dispatch]);

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
      loadUserMediaForSingleCamera(dispatch, desired, videoTracksMapRef, mountedRef);
    } else {
      loadUserMediaForCameras(dispatch, cameras, videoTracksMapRef, mountedRef);
    }
  }, [dispatch,gotPermissions,cameras,publishVideoTrack1DeviceId,compositeVideoTrack1DeviceId]);

  // get audio track for each microphone
  useEffect(() => {
    if (gotPermissions)
      loadUserMediaForMicrophones(dispatch, microphones, audioTracksMapRef, mountedRef);
  }, [dispatch,gotPermissions,microphones]);

  // start screen sharing for 'publish' example
  useEffect(() => {
    if (publishVideoTrack1DeviceId === 'screen' && displayScreenTrack == null) {
      loadDisplayScreenTrack(dispatch, mountedRef);
    }
  }, [dispatch,publishVideoTrack1DeviceId, displayScreenTrack])

  // start screen sharing for 'composite' example
  useEffect(() => {
    if (compositeVideoTrack1DeviceId === 'screen' && displayScreenTrack == null) {
      loadDisplayScreenTrack(dispatch, mountedRef);
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
