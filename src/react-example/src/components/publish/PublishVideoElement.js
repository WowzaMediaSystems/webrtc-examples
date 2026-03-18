import React, { useRef, useEffect } from 'react';
import { useSelector } from 'react-redux';

// Manage the HTML <video> element and the MediaStream used for publishing

const PublishVideoElement = () => {

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
