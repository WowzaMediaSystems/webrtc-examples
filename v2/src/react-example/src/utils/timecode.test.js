import { describe, expect, it } from 'vitest';

import {
  TIMECODE_BLOCKS, TIMECODE_MODULO, blockSize, checksum,
  decodeTimecode, encodeTimecode, latencyFromTimecode,
} from './timecode';

/** Reads back an encoded pattern the way a camera would: clean black and white. */
const readerFor = (bits, { noiseAt = -1, level = 128 } = {}) =>
  (index) => {
    if (index === noiseAt) return level;
    const bit = bits[index];
    return bit === undefined ? null : (bit ? 255 : 0);
  };

describe('encode and decode', () => {
  it('round trips every bit pattern that matters', () => {
    for (const value of [0, 1, 255, 4096, 32768, 65535, 12345]) {
      expect(decodeTimecode(readerFor(encodeTimecode(value)))).toBe(value);
    }
  });

  it('wraps a real clock value into the window', () => {
    const now = 1_726_600_000_123;
    expect(decodeTimecode(readerFor(encodeTimecode(now)))).toBe(now % TIMECODE_MODULO);
  });

  it('is the length the reader expects', () => {
    expect(encodeTimecode(0)).toHaveLength(TIMECODE_BLOCKS);
  });

  // A corrupted read must fail the check, not round to a plausible latency.
  it('refuses a corrupted read rather than guessing', () => {
    const bits = encodeTimecode(12345);
    const flipped = [...bits];
    flipped[5] = flipped[5] ? 0 : 1;
    expect(decodeTimecode(readerFor(flipped))).toBeNull();
  });

  it('refuses a picture that has no reference pair in the corner', () => {
    // Both references the same: this is ordinary video, not a timecode.
    expect(decodeTimecode(() => 200)).toBeNull();
    expect(decodeTimecode((i) => (i === 0 ? 140 : 120))).toBeNull();
  });

  it('refuses a read it could not sample', () => {
    expect(decodeTimecode((i) => (i > 10 ? null : (i === 0 ? 255 : 0)))).toBeNull();
  });

  // Compression washes blacks and whites toward the middle; the in-row references absorb it.
  it('survives a washed out picture, because the threshold travels with it', () => {
    const bits = encodeTimecode(4242);
    const washed = (index) => {
      const bit = bits[index];
      return bit === undefined ? null : (bit ? 190 : 70);
    };
    expect(decodeTimecode(washed)).toBe(4242);
  });

  it('has a checksum that actually varies', () => {
    expect(checksum(0)).toBe(0);
    expect(checksum(0xffff)).toBe(60 & 0xf);
    expect(checksum(0x1234)).toBe((1 + 2 + 3 + 4) & 0xf);
  });
});

describe('blockSize', () => {
  it('scales with the frame so the reader finds the blocks at any rendition', () => {
    expect(blockSize(1920)).toBe(40);
    expect(blockSize(960)).toBe(20);
    expect(blockSize(480)).toBe(10);
  });

  it('never goes below a size a codec can carry', () => {
    expect(blockSize(160)).toBe(6);
  });

  it('leaves the row inside the frame at the smallest rendition', () => {
    expect(blockSize(480) * TIMECODE_BLOCKS).toBeLessThan(480);
  });
});

describe('latencyFromTimecode', () => {
  const now = 1_726_600_000_000;

  it('measures the delay between the frame and now', () => {
    const sent = (now - 180) % TIMECODE_MODULO;
    expect(latencyFromTimecode(sent, now)).toBe(180);
  });

  it('reads correctly across a wrap of the window', () => {
    // A frame stamped just before the counter wrapped, read just after.
    const base = Math.floor(now / TIMECODE_MODULO) * TIMECODE_MODULO;
    const sent = (base - 50) % TIMECODE_MODULO;
    expect(latencyFromTimecode(sent, base + 30)).toBe(80);
  });

  it('refuses a reading that implies the future, which means the clocks disagree', () => {
    const sent = (now + 5000) % TIMECODE_MODULO;
    expect(latencyFromTimecode(sent, now)).toBeNull();
  });

  it('refuses an implausible delay rather than reporting it', () => {
    const sent = (now - 45_000) % TIMECODE_MODULO;
    expect(latencyFromTimecode(sent, now)).toBeNull();
  });

  it('has nothing to say without a reading', () => {
    expect(latencyFromTimecode(null, now)).toBeNull();
  });
});
