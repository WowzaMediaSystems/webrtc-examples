/*
 * Chooses which video track a publish carries: the selected camera, or, when it has no open
 * track, the camera that is open, which is what the preview shows.
 */

/**
 * @param {Object} videoTracksMap  deviceId -> MediaStreamTrack
 * @param {string} deviceId        the selected camera, '' for none, 'screen' for share
 * @param {MediaStreamTrack|null} displayScreenTrack
 * @returns {{ track: MediaStreamTrack|null, usedFallback: boolean }}
 */
export const selectPublishVideoTrack = (videoTracksMap, deviceId, displayScreenTrack) => {
  if (deviceId === 'screen') {
    return { track: displayScreenTrack || null, usedFallback: false };
  }
  if (deviceId === '' || deviceId == null) {
    return { track: null, usedFallback: false };
  }

  const map = videoTracksMap || {};
  const exact = map[deviceId];
  if (exact) return { track: exact, usedFallback: false };

  // Fall back to whatever track is actually open, which is what the preview shows.
  const firstKey = Object.keys(map)[0];
  if (firstKey) return { track: map[firstKey], usedFallback: true };

  return { track: null, usedFallback: false };
};

/*
 * Where a derived track records the camera it came from. Frame size and rate are camera
 * constraints, and applyConstraints on a derived (drawn-on) track throws.
 */
export const CAMERA_SOURCE_KEY = '__wzClockSource';

/** The camera behind a track, or the track itself when it is already the camera. */
export const cameraTrackOf = (track) => (track && track[CAMERA_SOURCE_KEY]) || track;
