import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';

import useMediaStream from '../../hooks/useMediaStream';
import * as PublishSettingsActions from '../../actions/publishSettingsActions';

import { SET_MEDIA_STREAM } from '../../actions/mediaActions';
import { SET_PUBLISH_AUDIO_TRACK } from '../../actions/publishSettingsActions';



const PublishAudioDropdown = () => {

  const dispatch = useDispatch();
  const publishSettings = useSelector ((state) => state.publishSettings);
  const { microphones, audioTracksMap } = useSelector ((state) => state.media);
  const { audioTrackDeviceId } = useSelector ((state) => state.publishSettings);

  // Handle audioTrack changes
  const streamRef = useMediaStream();

  useEffect(() => {
    let newStream = new MediaStream();
    let audioTrack = undefined;
    if (audioTrackDeviceId !== '' && audioTracksMap[audioTrackDeviceId] != null) {
      newStream.addTrack(audioTracksMap[audioTrackDeviceId]);
      audioTrack = audioTracksMap[audioTrackDeviceId];
    }
    if (streamRef.current != null) {
      let videoTracks = streamRef.current.getVideoTracks();
      if (videoTracks.length > 0)
        newStream.addTrack(videoTracks[0]);
    }
    dispatch({ type: SET_MEDIA_STREAM, stream: newStream });
    dispatch({ type: SET_PUBLISH_AUDIO_TRACK, audioTrack: audioTrack });
  }, [dispatch, audioTracksMap, audioTrackDeviceId, streamRef]);

  return(
    <div className="form-group">
      <label htmlFor="mic-list-select">
        Input Microphone
      </label>
      <select id="mic-list-select" className="form-select"
        value={publishSettings.audioTrackDeviceId}
        onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_AUDIO_TRACK_DEVICEID,audioTrackDeviceId:e.target.value})}
      >
        <option value=''>None</option>
        { microphones.map((mic,key) => {
          return <option key={key} value={mic.deviceId}>{mic.label}</option>
        })}
      </select>
    </div>
  )
}

export default PublishAudioDropdown;
