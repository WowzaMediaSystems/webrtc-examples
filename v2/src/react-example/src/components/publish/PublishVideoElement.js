import React, { useRef, useEffect } from 'react';
import { useSelector } from 'react-redux';

// Manage the HTML <video> element and the MediaStream used for publishing

const PublishVideoElement = () => {

  const videoElement = useRef();
  const { stream } = useSelector ((state) => state.media);

  // Set srcObject on the videoElement every time the stream changes. We must
  // also clear it when the stream is null — iOS Safari keeps the camera
  // hardware pinned until the <video> element detaches its srcObject.
  useEffect(() => {
    if (videoElement.current == null) return;
    if (stream != null) {
      videoElement.current.srcObject = stream;
    } else {
      videoElement.current.srcObject = null;
    }
  },[stream, videoElement]);

  return (
    <video ref={videoElement} id="publisher-video" autoPlay playsInline muted controls></video>
  );
}

export default PublishVideoElement;
