import { describe, expect, it } from 'vitest';

import { cameraTrackOf } from './VideoTrackUtils';

const trackA = { id: 'a' };
const trackB = { id: 'b' };
const screen = { id: 'screen' };

describe('cameraTrackOf', () => {
  /*
   * Frame size and frame rate are camera constraints, and a track carrying a drawn clock is no
   * longer the camera. Applying them to the derived track throws, which the publisher reported
   * as "your browser or camera does not support this frame size" before resetting the setting.
   */
  it('gives back a plain track unchanged', () => {
    const track = { kind: 'video' };
    expect(cameraTrackOf(track)).toBe(track);
  });

  it('survives having nothing to look at', () => {
    expect(cameraTrackOf(null)).toBeNull();
    expect(cameraTrackOf(undefined)).toBeUndefined();
  });
});
