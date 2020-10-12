import React, { useRef, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { SET_MEDIA_STREAM } from '../../actions/mediaActions';
import { SET_PUBLISH_VIDEO_TRACK, SET_PUBLISH_AUDIO_TRACK } from '../../actions/publishSettingsActions';

// Manage the HTML <video> element and the MediaStream used for publishing

const PublishVideoElement = () => {

  const dispatch = useDispatch();
  const videoElement = useRef();
  const { stream } = useSelector ((state) => state.media);

  // Set srcObject on the videoElement every time the stream changes
  useEffect(() => {
    if (stream != null && videoElement.current != null)
    {
      videoElement.current.srcObject = stream;
    }
  },[stream, videoElement]);

  return (
    <video ref={videoElement} id="publisher-video" autoPlay playsInline muted controls></video>
  );
}

export default PublishVideoElement;
