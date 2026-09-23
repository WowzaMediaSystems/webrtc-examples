import React, { useRef, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

// Manage the HTML <video> element and the MediaStream used for publishing

const PublishVideoElement = () => {

  const videoElement = useRef();
  const { stream } = useSelector ((state) => state.media);

  // Whether there is a picture to show, which is not the same as whether there is a
  // stream: an audio-only capture, or one whose metadata has not arrived, leaves the
  // element at its default 300x150 and the stage would show a stub box.
  const [size, setSize] = useState({ width: 0, height: 0 });
  const hasPicture = size.width > 0 && size.height > 0;

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

  useEffect(() => {
    const video = videoElement.current;
    if (video == null) return;

    const update = () => setSize({ width: video.videoWidth, height: video.videoHeight });

    // resize covers a mid-stream change of capture size as well as the first frame.
    video.addEventListener('loadedmetadata', update);
    video.addEventListener('resize', update);
    video.addEventListener('emptied', update);

    return () => {
      video.removeEventListener('loadedmetadata', update);
      video.removeEventListener('resize', update);
      video.removeEventListener('emptied', update);
    };
  }, []);

  // No controls: this is a local self-view of the camera, so a transport bar offering to
  // scrub a live capture is noise, and it covers the bottom of the picture.
  return (
    <>
      {!hasPicture && <div className="wz-video-placeholder">Camera preview</div>}
      <video
        ref={videoElement}
        id="publisher-video"
        autoPlay
        playsInline
        muted
        hidden={!hasPicture}
        style={hasPicture ? { '--wz-video-ar': size.width / size.height } : undefined}
      ></video>
    </>
  );
}

export default PublishVideoElement;
