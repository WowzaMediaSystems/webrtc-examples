/*
 * Where a derived track records the camera it came from. Frame size and rate are camera
 * constraints, and applyConstraints on a derived (drawn-on) track throws.
 */
export const CAMERA_SOURCE_KEY = '__wzClockSource';

/** The camera behind a track, or the track itself when it is already the camera. */
export const cameraTrackOf = (track) => (track && track[CAMERA_SOURCE_KEY]) || track;
