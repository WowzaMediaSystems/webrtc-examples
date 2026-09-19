import React, { useEffect } from 'react';
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


  /*
   * The timecode wrap lives here rather than in a component of its own, because this effect
   * already owns the decision about which track is previewed and published. Two owners for
   * one track is how the preview and the publish came apart before.
   */
  useEffect(() => {
    let newStream = new MediaStream();

    // One decision, shared with the preview, so what is shown is what is sent. The exact
    // lookup used to be the only path, which meant a selected device with no open track
    // produced a working preview and a publish with no video at all.
    const { track, usedFallback } = selectPublishVideoTrack(
      videoTracksMap, videoTrack1DeviceId, displayScreenTrack
    );
    let videoTrack = track || undefined;

    /*
      * The clock is drawn here, where the one decision about which track is previewed and
      * published is already made. Derived in any other place and the preview would show the
      * camera while the publish carried the clock, or the other way about, and the point of
      * the clock is that the two can be held up against each other.
      */
     if (burnedClock) videoTrack = clockedTrackFor(videoTrack);
     else releaseClockedTrack();

    if (videoTrack) newStream.addTrack(videoTrack);
    if (usedFallback) {
      logEvent('info', 'pc', 'publish camera fallback: selected device had no open track', {
        requestedDeviceId: videoTrack1DeviceId,
        openDeviceIds: Object.keys(videoTracksMap || {}),
      });
    }
    if (streamRef.current != null) {
      let audioTracks = streamRef.current.getAudioTracks();
      if (audioTracks.length > 0)
        newStream.addTrack(audioTracks[0]);
    }
    dispatch({ type: SET_MEDIA_STREAM, stream: newStream });
    dispatch({ type: SET_PUBLISH_VIDEO_TRACK, videoTrack: videoTrack });

    // No cleanup. The derived track's lifetime belongs to the camera and the setting, not to
    // this effect: see clockedTrackFor.
  }, [dispatch, videoTracksMap, displayScreenTrack, videoTrack1DeviceId, streamRef, burnedClock]);

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
    </div>
  )
}

export default PublishVideoDropdown;
