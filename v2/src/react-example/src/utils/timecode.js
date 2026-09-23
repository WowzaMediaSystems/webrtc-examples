/*
 * A timestamp burned into the picture, so latency is measured glass to glass: unlike a
 * data-channel message, it passes through capture, encode, decode and display.
 *
 * Deliberately crude to survive downscaling and a lossy codec: flat black and white blocks
 * sized as a fraction of the frame, read at their centers, and judged against two reference
 * blocks in the same row rather than an absolute threshold.
 *
 * Milliseconds modulo 65536 (wraps every 65.5 s); the reader resolves the wrap against its
 * own clock, which covers up to about 32 s of latency.
 */

export const TIMECODE_BITS = 16;
export const TIMECODE_MODULO = 1 << TIMECODE_BITS;      // 65536
const CHECK_BITS = 4;

// Two reference blocks (white, black), then the data, then the check nibble.
export const TIMECODE_BLOCKS = 2 + TIMECODE_BITS + CHECK_BITS;

/** Block edge in pixels for a frame of this width, with a floor so it stays readable. */
export const blockSize = (frameWidth) => Math.max(6, Math.round(frameWidth / 48));

/** The check nibble: the four nibbles of the value, summed. Cheap, and catches most misreads. */
export const checksum = (value) => {
  let sum = 0;
  for (let shift = 0; shift < TIMECODE_BITS; shift += 4) sum += (value >> shift) & 0xf;
  return sum & 0xf;
};

/** The bit pattern for a value: [white, black, ...data msb first, ...check msb first]. */
export const encodeTimecode = (value) => {
  const wrapped = ((value % TIMECODE_MODULO) + TIMECODE_MODULO) % TIMECODE_MODULO;
  const bits = [1, 0];
  for (let i = TIMECODE_BITS - 1; i >= 0; i -= 1) bits.push((wrapped >> i) & 1);
  const check = checksum(wrapped);
  for (let i = CHECK_BITS - 1; i >= 0; i -= 1) bits.push((check >> i) & 1);
  return bits;
};

/**
 * Reads the pattern back. `sample(index)` returns the luminance at the center of block
 * `index`, 0-255, or null. Returns null on bad reference blocks or a check nibble mismatch.
 */
export const decodeTimecode = (sample) => {
  const white = sample(0);
  const black = sample(1);
  if (white === null || black === null) return null;

  // References not clearly apart: this is just whatever is in the corner of the picture.
  if (white - black < 60) return null;

  const midpoint = (white + black) / 2;
  const bitAt = (index) => {
    const level = sample(index);
    return level === null ? null : (level > midpoint ? 1 : 0);
  };

  let value = 0;
  for (let i = 0; i < TIMECODE_BITS; i += 1) {
    const bit = bitAt(2 + i);
    if (bit === null) return null;
    value = (value << 1) | bit;
  }

  let check = 0;
  for (let i = 0; i < CHECK_BITS; i += 1) {
    const bit = bitAt(2 + TIMECODE_BITS + i);
    if (bit === null) return null;
    check = (check << 1) | bit;
  }

  return check === checksum(value) ? value : null;
};

/**
 * Turns a wrapped reading into a latency in milliseconds, taking the nearest 65.5 s window.
 * Negative or implausible delays return null rather than being clamped.
 */
export const latencyFromTimecode = (readValue, nowMs, maxMs = 30000) => {
  if (readValue === null || readValue === undefined) return null;

  const nowWrapped = nowMs % TIMECODE_MODULO;
  let delta = nowWrapped - readValue;
  if (delta < 0) delta += TIMECODE_MODULO;

  // Half a window of slack; beyond that the reading cannot be placed on the clock.
  if (delta > TIMECODE_MODULO / 2) return null;
  return delta > maxMs ? null : delta;
};

/** Draws the pattern, and a human-readable clock of the same instant beneath it. */
export const drawTimecode = (context, width, height, nowMs) => {
  const size = blockSize(width);
  const bits = encodeTimecode(nowMs);

  bits.forEach((bit, index) => {
    context.fillStyle = bit ? '#ffffff' : '#000000';
    context.fillRect(index * size, 0, size, size);
  });

  const text = new Date(nowMs).toISOString().substring(11, 23);
  const fontSize = Math.max(11, Math.round(height / 28));
  context.font = `600 ${fontSize}px ui-monospace, Menlo, Consolas, monospace`;
  context.textBaseline = 'top';

  const padding = Math.round(fontSize * 0.35);
  const textWidth = context.measureText(text).width;
  context.fillStyle = 'rgba(0, 0, 0, 0.72)';
  context.fillRect(0, size, textWidth + padding * 2, fontSize + padding * 2);
  context.fillStyle = '#ffffff';
  context.fillText(text, padding, size + padding);
};

/** Where the reader should sample: the center of block `index`. */
export const blockCentre = (index, frameWidth) => {
  const size = blockSize(frameWidth);
  return { x: Math.round(index * size + size / 2), y: Math.round(size / 2) };
};
