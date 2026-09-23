import React, { useEffect, useMemo, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';

import * as PublishSettingsActions from '../../actions/publishSettingsActions';

import { SET_MEDIA_STREAM } from '../../actions/mediaActions';
import { SET_PUBLISH_VIDEO_TRACK } from '../../actions/publishSettingsActions';
import useMediaStream from '../../hooks/useMediaStream';
import { selectPublishVideoTrack } from '../../utils/VideoTrackUtils';
import { logEvent } from '../../diagnostics/signalLog';
import { clockedTrackFor, releaseClockedTrack } from '../../diagnostics/burnedClock';



const PublishVideoDropdown = () => {

  const dispatch = useDispatch();
  const publishSettings = useSelector ((state) => state.publishSettings);
  const { cameras, videoTracksMap, displayScreenTrack } = useSelector ((state) => state.media);
  const { videoTrack1DeviceId, burnedClock } = useSelector ((state) => state.publishSettings);

  // Handle videoTrack1 changes
  const streamRef = useMediaStream();
  const loggedFallbackFor = useRef(null);

  // One decision, shared with the preview, so what is shown is what is sent.
  const selection = useMemo(
    () => selectPublishVideoTrack(videoTracksMap, videoTrack1DeviceId, displayScreenTrack),
    [videoTracksMap, videoTrack1DeviceId, displayScreenTrack]
  );
  const fallbackLabel = selection.usedFallback && selection.track
    ? (selection.track.label || 'another camera')
    : null;


  // The clock wrap lives here: this effect alone decides which track is previewed and published.
  useEffect(() => {
    let newStream = new MediaStream();

    // One decision, shared with the preview, so what is shown is what is sent. The exact
    // lookup used to be the only path, which meant a selected device with no open track
    // produced a working preview and a publish with no video at all.
    const { track, usedFallback } = selection;
    let videoTrack = track || undefined;

     if (burnedClock) videoTrack = clockedTrackFor(videoTrack);
     else releaseClockedTrack();

    if (videoTrack) newStream.addTrack(videoTrack);
    // The effect re-runs on unrelated identity changes; log once per selection.
    if (usedFallback && loggedFallbackFor.current !== videoTrack1DeviceId) {
      loggedFallbackFor.current = videoTrack1DeviceId;
      logEvent('info', 'pc', 'publish camera fallback: selected device had no open track', {
        requestedDeviceId: videoTrack1DeviceId,
        openDeviceIds: Object.keys(videoTracksMap || {}),
      });
    }
    if (!usedFallback) loggedFallbackFor.current = null;
    if (streamRef.current != null) {
      let audioTracks = streamRef.current.getAudioTracks();
      if (audioTracks.length > 0)
        newStream.addTrack(audioTracks[0]);
    }
    dispatch({ type: SET_MEDIA_STREAM, stream: newStream });
    dispatch({ type: SET_PUBLISH_VIDEO_TRACK, videoTrack: videoTrack });

    // No cleanup: the derived track's lifetime is owned by clockedTrackFor.
  }, [dispatch, selection, videoTracksMap, videoTrack1DeviceId, streamRef, burnedClock]);

  return(
    <div className="mb-3">
      <label htmlFor="camera-list-select">
        Video Input
      </label>
      <select id="camera-list-select" className="form-select"
        value={publishSettings.videoTrack1DeviceId}
        onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_VIDEO_TRACK1_DEVICEID,videoTrack1DeviceId:e.target.value})}
      >
        <option value=''>None</option>
        { cameras.map((cam,key) => {
          return <option key={key} value={cam.deviceId}>{cam.label}</option>
        })}
        <option value='screen'>Screen Share</option>
      </select>
      {fallbackLabel && (
        <small className="form-text text-muted" id="camera-fallback-note" role="status">
          The selected camera has no open track, so {fallbackLabel} is being sent instead.
        </small>
      )}
    </div>
  )
}

export default PublishVideoDropdown;
