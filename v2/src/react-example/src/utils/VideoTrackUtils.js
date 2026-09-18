/*
 * Chooses which video track a publish should actually carry.
 *
 * This exists because the preview and the publish path used to disagree. The preview
 * (CompositorUserMedia) renders videoTracksMap[firstKey]; the publish path looked up
 * videoTracksMap[selectedDeviceId] exactly. When the selected device had no open track -
 * it failed to open, its id changed after the permission prompt, or the map had not caught
 * up with a device switch - the preview showed a picture while publishSettings.videoTrack
 * stayed null, so addVideoSender attached nothing and only audio reached the server.
 *
 * That failure is silent and looks exactly like "video is not being published properly".
 * Making both sides use this one function means what you see is what gets sent.
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
 * Where a track records the camera it was derived from, and how to read it back.
 *
 * Frame size and frame rate are camera constraints. Once something draws on the picture the
 * track being published is no longer the camera, and applyConstraints on the derived one
 * throws, which the publisher reports as "your browser or camera does not support this frame
 * size" before resetting the setting.
 *
 * The key lives here rather than beside the code that writes it, because the frame-size effect
 * that reads it has no business importing a diagnostics module to ask which track is a camera.
 */
export const CAMERA_SOURCE_KEY = '__wzClockSource';

/** The camera behind a track, or the track itself when it is already the camera. */
export const cameraTrackOf = (track) => (track && track[CAMERA_SOURCE_KEY]) || track;
