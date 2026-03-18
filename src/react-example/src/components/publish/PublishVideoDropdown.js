import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';

import * as PublishSettingsActions from '../../actions/publishSettingsActions';

import { SET_MEDIA_STREAM } from '../../actions/mediaActions';
import { SET_PUBLISH_VIDEO_TRACK } from '../../actions/publishSettingsActions';
import useMediaStream from '../../hooks/useMediaStream';



const PublishVideoDropdown = () => {

  const dispatch = useDispatch();
  const publishSettings = useSelector ((state) => state.publishSettings);
  const { cameras, videoTracksMap, displayScreenTrack } = useSelector ((state) => state.media);
  const { videoTrack1DeviceId } = useSelector ((state) => state.publishSettings);

  // Handle videoTrack1 changes
  const streamRef = useMediaStream();

  useEffect(() => {
    let newStream = new MediaStream();
    let videoTrack = undefined;
    if (videoTrack1DeviceId === 'screen' && displayScreenTrack != null) {
      newStream.addTrack(displayScreenTrack);
      videoTrack = displayScreenTrack;
    } else if (videoTrack1DeviceId !== '' && videoTrack1DeviceId !== 'screen' && videoTracksMap[videoTrack1DeviceId] != null) {
      newStream.addTrack(videoTracksMap[videoTrack1DeviceId]);
      videoTrack = videoTracksMap[videoTrack1DeviceId];
    }
    if (streamRef.current != null) {
      let audioTracks = streamRef.current.getAudioTracks();
      if (audioTracks.length > 0)
        newStream.addTrack(audioTracks[0]);
    }
    dispatch({ type: SET_MEDIA_STREAM, stream: newStream });
    dispatch({ type: SET_PUBLISH_VIDEO_TRACK, videoTrack: videoTrack });
  }, [dispatch, videoTracksMap, displayScreenTrack, videoTrack1DeviceId, streamRef]);

  return(
    <div className="form-group">
      <label htmlFor="camera-list-select">
        Input Camera
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
