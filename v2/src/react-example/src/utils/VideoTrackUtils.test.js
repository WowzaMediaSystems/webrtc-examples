import { describe, expect, it } from 'vitest';

import { cameraTrackOf, selectPublishVideoTrack } from './VideoTrackUtils';

const trackA = { id: 'a' };
const trackB = { id: 'b' };
const screen = { id: 'screen' };

describe('selectPublishVideoTrack', () => {
  it('uses the selected camera when its track is open', () => {
    const r = selectPublishVideoTrack({ camA: trackA, camB: trackB }, 'camB', null);
    expect(r.track).toBe(trackB);
    expect(r.usedFallback).toBe(false);
  });

  // The regression this function exists for: preview showed a picture, publish sent none.
  it('falls back to an open track when the selected device has none', () => {
    const r = selectPublishVideoTrack({ camA: trackA }, 'camMissing', null);
    expect(r.track).toBe(trackA);
    expect(r.usedFallback).toBe(true);
  });

  it('returns nothing when no track is open at all', () => {
    const r = selectPublishVideoTrack({}, 'camA', null);
    expect(r.track).toBeNull();
    expect(r.usedFallback).toBe(false);
  });

  it('uses the screen track for a screen share', () => {
    expect(selectPublishVideoTrack({ camA: trackA }, 'screen', screen).track).toBe(screen);
  });

  it('returns nothing for a screen share with no screen track yet', () => {
    expect(selectPublishVideoTrack({ camA: trackA }, 'screen', null).track).toBeNull();
  });

  it('treats an empty selection as deliberately no video', () => {
    expect(selectPublishVideoTrack({ camA: trackA }, '', null).track).toBeNull();
    expect(selectPublishVideoTrack({ camA: trackA }, '', null).usedFallback).toBe(false);
  });

  it('tolerates a missing map', () => {
    expect(selectPublishVideoTrack(undefined, 'camA', null).track).toBeNull();
    expect(selectPublishVideoTrack(null, 'camA', null).track).toBeNull();
  });

  it('never returns a fallback flag when it returns no track', () => {
    const r = selectPublishVideoTrack({}, 'nope', null);
    expect(r.track === null && r.usedFallback === false).toBe(true);
  });
});

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
