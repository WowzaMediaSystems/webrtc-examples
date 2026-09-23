import { useEffect } from 'react';
import { useSelector } from 'react-redux';

/*
 * Applies the camera and microphone on/off flags to the current tracks. Mounted once at the
 * app root, so it covers every page and any track swap (a new track takes the current flag).
 */
const isTrack = (track) => typeof track?.kind === 'string';

// A MediaStreamTrack is a browser object, not React state; switching it is the point.
const setEnabled = (track, on) => {
  if (isTrack(track)) track.enabled = on;
};

const TrackEnabledSync = () => {
  const { videoTrack, audioTrack, videoEnabled, audioEnabled } = useSelector((state) => state.publishSettings);

  useEffect(() => {
    setEnabled(videoTrack, videoEnabled);
  }, [videoTrack, videoEnabled]);

  useEffect(() => {
    setEnabled(audioTrack, audioEnabled);
  }, [audioTrack, audioEnabled]);

  return null;
};

export default TrackEnabledSync;
