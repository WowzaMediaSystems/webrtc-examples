import { describe, expect, it } from 'vitest';

import {
  burnClockIntoTrack,
  burnedClockUnavailableReason,
  drawClock,
  formatClock,
  isBurnedClockAvailable,
  textSizeFor,
} from './burnedClock';

/* A stand-in for a 2D context that records what was asked of it. */
const fakeContext = () => {
  const calls = [];
  return {
    calls,
    font: '',
    textBaseline: '',
    textAlign: '',
    fillStyle: '',
    measureText: (text) => ({ width: text.length * 10 }),
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    fillText: (...args) => calls.push(['fillText', ...args]),
  };
};

describe('formatClock', () => {
  it('reads as a wall clock with milliseconds', () => {
    const at = new Date(2026, 8, 18, 9, 5, 3, 7).getTime();
    expect(formatClock(at)).toBe('09:05:03.007');
  });

  it('pads every field to a fixed width, so the digits do not shuffle', () => {
    const at = new Date(2026, 8, 18, 23, 59, 59, 999).getTime();
    expect(formatClock(at)).toBe('23:59:59.999');
    expect(formatClock(at)).toHaveLength('HH:MM:SS.mmm'.length);
  });

  it('uses a 24 hour clock, so afternoon is not ambiguous', () => {
    expect(formatClock(new Date(2026, 8, 18, 13, 0, 0, 0).getTime())).toBe('13:00:00.000');
  });
});

describe('textSizeFor', () => {
  it('scales with the frame, so it stays the same size on screen', () => {
    expect(textSizeFor(1080)).toBe(60);
    expect(textSizeFor(480)).toBeCloseTo(27, 0);
  });

  // Below about 13px the digits stop surviving a low bitrate encode.
  it('has a floor, so a small rendition is still readable', () => {
    expect(textSizeFor(120)).toBe(13);
    expect(textSizeFor(1)).toBe(13);
  });
});

describe('drawClock', () => {
  it('puts white digits on a solid plate, which is what survives the encoder', () => {
    const ctx = fakeContext();
    drawClock(ctx, { width: 640, height: 480, text: '09:05:03.007' });

    const [plate] = ctx.calls.filter(([name]) => name === 'fillRect');
    const [text] = ctx.calls.filter(([name]) => name === 'fillText');
    expect(plate).toBeDefined();
    expect(text[1]).toBe('09:05:03.007');
    // The plate is drawn before the text, or the text is underneath it.
    expect(ctx.calls.indexOf(plate)).toBeLessThan(ctx.calls.indexOf(text));
  });

  it('keeps the plate inside the frame however narrow it is', () => {
    const ctx = fakeContext();
    const { plateWidth } = drawClock(ctx, { width: 64, height: 48, text: '09:05:03.007' });
    expect(plateWidth).toBeLessThanOrEqual(64);
  });

  it('sizes the plate to the text it has to hold', () => {
    const ctx = fakeContext();
    const { plateWidth, plateHeight } = drawClock(ctx, {
      width: 1920, height: 1080, text: '09:05:03.007',
    });
    expect(plateWidth).toBeGreaterThan(120);
    expect(plateHeight).toBeGreaterThan(textSizeFor(1080));
  });
});

describe('when the browser cannot do it', () => {
  // jsdom has no MediaStreamTrackProcessor, which is the case being described.
  it('says which API is missing rather than failing silently', () => {
    expect(burnedClockUnavailableReason()).toMatch(/MediaStreamTrackProcessor|WebCodecs/);
    expect(isBurnedClockAvailable()).toBe(false);
  });

  // A caller that skips the check still gets a working publish.
  it('hands back the camera untouched instead of returning nothing', () => {
    const track = { kind: 'video' };
    const { track: out, stop } = burnClockIntoTrack(track);
    expect(out).toBe(track);
    expect(() => stop()).not.toThrow();
  });
});
