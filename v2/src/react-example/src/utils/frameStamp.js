/*
 * The frame stamp: a sequence number and a send time carried inside the encoded H.264
 * bitstream as an SEI NAL.
 *
 * Why in the bitstream and not in the picture: a stamp drawn into the pixels is destroyed by
 * the thing it is measuring. Measured on 2026-09-17, a pixel stamp read back at 80% of frames
 * at the source rendition but only 8.7% with scaleResolutionDownBy 2, and it produced confident
 * wrong numbers rather than failing. An SEI NAL is metadata attached to the frame, so rescaling,
 * simulcast rungs and bitrate adaptation cannot touch it. The same measurement run saw
 * 187/187, 248/248 and 248/248 frames arrive through the Engine with the marker intact.
 *
 * This module is pure bytes. No DOM, no WebRTC, no React, so the parsing can be tested without
 * a peer connection.
 *
 * Scope note: SEI is an H.264 construct. VP8, VP9 and AV1 have no equivalent here, and a
 * transcoding application re-encodes and drops the marker. Both cases read as "no stamp", which
 * the caller must present as unavailable rather than as zero latency.
 */

/*
 * Identifies our SEI among the others an encoder emits. The spec wants 16 bytes of UUID; any
 * 16 bytes will do, and printable ASCII makes the marker legible in a hex dump when someone is
 * staring at a capture wondering whether the stamp is there at all.
 *
 * Second reason for ASCII: every byte is above 0x03, so the marker itself can never trigger
 * emulation prevention and always appears literally in the escaped bitstream.
 */
export const STAMP_UUID = Uint8Array.from(
  'WZFRAMESTAMPv002', (character) => character.charCodeAt(0),
);

const NAL_TYPE_SEI = 6;
const SEI_USER_DATA_UNREGISTERED = 5;
const RBSP_STOP_BYTE = 0x80;

/*
 * Field widths, big endian, fixed.
 *
 * Sequence is 4 bytes: at 60 fps a 32-bit counter runs for 2.2 years before it wraps, and the
 * gap detection only ever compares neighbouring frames anyway.
 *
 * The send time is 6 bytes rather than 8. It is a millisecond wall clock (Date.now), which needs
 * 41 bits today and so would wrap a 32-bit field every 49.7 days, which is exactly the kind of
 * failure that shows up once and is never reproduced. 48 bits carries it to the year 10889, and
 * unlike 64 bits it stays inside the 53-bit integer range a JavaScript number represents exactly,
 * so no BigInt and no silent rounding.
 */
const SEQUENCE_BYTES = 4;
const SENT_AT_BYTES = 6;

/*
 * The rung, one byte, added in v002.
 *
 * A simulcast sender counts its sequence per rung, because a single counter across all of them
 * arrives at a player watching one rung full of holes. That fixed the sender and left the
 * receiver with the mirror of the same problem: it counts across whatever arrives, and it
 * cannot tell one rung from another, because the Engine re-originates every rendition under a
 * single SSRC. Measured on 2026-09-18: a viewer joining a running simulcast publish took its
 * first dozen frames from a rung whose counter had just been created, then settled on the
 * requested rendition several hundred frames in, and the step between the two was counted as
 * 235 lost frames on a session that had lost nothing.
 *
 * So the rung the sender counted under travels with the count. The receiver keys its own
 * baseline the same way and a change of rung starts a new one instead of reporting a gap.
 *
 * One byte: it is a small index assigned per sender in order of first appearance, not an SSRC,
 * because nothing needs to identify the rung outside the session that produced it. A sender
 * with more than 256 rungs does not exist; three is the usual number.
 */
const RUNG_BYTES = 1;

const PAYLOAD_BYTES = SEQUENCE_BYTES + SENT_AT_BYTES + RUNG_BYTES;
export const MAX_SEQUENCE = 2 ** (SEQUENCE_BYTES * 8) - 1;
export const MAX_SENT_AT = 2 ** (SENT_AT_BYTES * 8) - 1;
export const MAX_RUNG = 2 ** (RUNG_BYTES * 8) - 1;

/*
 * Big endian read and write by arithmetic, not by bit shifting. JavaScript bitwise operators
 * truncate to 32 bits, so a shift of 40 on a 48-bit timestamp silently returns the wrong byte.
 */
const writeUint = (bytes, offset, value, width) => {
  let remaining = value;
  for (let index = width - 1; index >= 0; index -= 1) {
    bytes[offset + index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
};

const readUint = (bytes, offset, width) => {
  let value = 0;
  for (let index = 0; index < width; index += 1) value = value * 256 + bytes[offset + index];
  return value;
};

/**
 * Inserts emulation prevention bytes.
 *
 * An H.264 NAL payload may not contain 00 00 00, 00 00 01, 00 00 02 or 00 00 03, because a
 * decoder scanning for the 00 00 01 start code would cut the NAL in half there. The encoder
 * escapes those runs by inserting 0x03 after the two zeros, and the decoder removes it again.
 * A timestamp is perfectly capable of containing 00 00 01 by accident, so this is not optional:
 * skip it and the stamped frame corrupts the stream it was meant to measure.
 */
export const addEmulationPrevention = (rbsp) => {
  const escaped = [];
  let zeros = 0;
  for (const byte of rbsp) {
    if (zeros >= 2 && byte <= 0x03) {
      escaped.push(0x03);
      zeros = 0;
    }
    escaped.push(byte);
    zeros = byte === 0x00 ? zeros + 1 : 0;
  }
  return Uint8Array.from(escaped);
};

/** Removes them again. A 0x03 that follows two zeros was inserted by the encoder, not by us. */
export const removeEmulationPrevention = (bytes) => {
  const rbsp = [];
  let zeros = 0;
  for (const byte of bytes) {
    if (zeros >= 2 && byte === 0x03) {
      zeros = 0;
      continue;
    }
    rbsp.push(byte);
    zeros = byte === 0x00 ? zeros + 1 : 0;
  }
  return Uint8Array.from(rbsp);
};

const isWholeNumberInRange = (value, limit) =>
  Number.isInteger(value) && value >= 0 && value <= limit;

/**
 * Builds the complete SEI NAL, in Annex B form, ready to be prepended to an encoded frame.
 *
 * Layout: 00 00 00 01 start code, NAL header 0x06 (type 6, SEI, nal_ref_idc 0 because a
 * decoder losing this NAL loses nothing it needs), payload type 5 (user_data_unregistered),
 * payload size, our 16-byte UUID, the fields, then the RBSP stop byte.
 *
 * Throws rather than truncating on an out-of-range value. Wrapping a sequence number silently
 * would turn a caller's bug into a plausible looking latency chart.
 */
export const buildSeiPayload = ({ sequence, sentAt, rung = 0 }) => {
  if (!isWholeNumberInRange(sequence, MAX_SEQUENCE)) {
    throw new RangeError('frame stamp sequence must be a whole number within 32 bits');
  }
  if (!isWholeNumberInRange(sentAt, MAX_SENT_AT)) {
    throw new RangeError('frame stamp sentAt must be a whole number of milliseconds within 48 bits');
  }
  if (!isWholeNumberInRange(rung, MAX_RUNG)) {
    throw new RangeError('frame stamp rung must be a whole number within one byte');
  }

  const payload = new Uint8Array(STAMP_UUID.length + PAYLOAD_BYTES);
  payload.set(STAMP_UUID, 0);
  writeUint(payload, STAMP_UUID.length, sequence, SEQUENCE_BYTES);
  writeUint(payload, STAMP_UUID.length + SEQUENCE_BYTES, sentAt, SENT_AT_BYTES);
  writeUint(payload, STAMP_UUID.length + SEQUENCE_BYTES + SENT_AT_BYTES, rung, RUNG_BYTES);

  // payloadType and payloadSize are 0xff-extended; both of ours are small enough for one byte.
  const rbsp = Uint8Array.from([
    SEI_USER_DATA_UNREGISTERED, payload.length, ...payload, RBSP_STOP_BYTE,
  ]);

  // The escaping covers the whole RBSP, including the size byte and the stop byte, because a
  // decoder unescapes before it parses any of it.
  const escaped = addEmulationPrevention(rbsp);
  return Uint8Array.from([0x00, 0x00, 0x00, 0x01, 0x06, ...escaped]);
};

/** Encoded frames arrive as an ArrayBuffer from RTCEncodedVideoFrame.data; take either form. */
const asBytes = (frameBytes) => {
  if (frameBytes instanceof Uint8Array) return frameBytes;
  if (ArrayBuffer.isView(frameBytes)) {
    return new Uint8Array(frameBytes.buffer, frameBytes.byteOffset, frameBytes.byteLength);
  }
  if (frameBytes instanceof ArrayBuffer) return new Uint8Array(frameBytes);
  return null;
};

/**
 * Splits an Annex B frame into NAL units.
 *
 * Start codes are 00 00 01 with an optional extra leading zero. Trailing zeros belong to the
 * separator rather than to the NAL, so they are trimmed; they would otherwise look like the
 * beginning of another SEI message.
 */
const splitNalUnits = (bytes) => {
  const starts = [];
  for (let index = 0; index + 2 < bytes.length; index += 1) {
    if (bytes[index] === 0x00 && bytes[index + 1] === 0x00 && bytes[index + 2] === 0x01) {
      starts.push(index + 3);
      index += 2;
    }
  }

  return starts.map((start, position) => {
    const nextStart = starts[position + 1];
    // Back off the next start code itself, plus the zero that may precede a four-byte one.
    let end = nextStart === undefined ? bytes.length : nextStart - 3;
    while (end > start && bytes[end - 1] === 0x00) end -= 1;
    return bytes.subarray(start, end);
  });
};

/*
 * more_rbsp_data, byte aligned. What remains is the trailing bits rather than another SEI
 * message when, ignoring padding zeros, only the stop byte is left.
 *
 * This matters because payload type 128 also encodes as the single byte 0x80, so "is the next
 * byte 0x80" is not a safe end test on its own.
 */
const hasMoreSeiMessages = (rbsp, offset) => {
  let end = rbsp.length;
  while (end > offset && rbsp[end - 1] === 0x00) end -= 1;
  if (end <= offset) return false;
  return !(end - offset === 1 && rbsp[offset] === RBSP_STOP_BYTE);
};

/** 0xff-extended value: any number of 0xff bytes, each worth 255, then the remainder. */
const readExtendedValue = (rbsp, offset) => {
  let value = 0;
  let index = offset;
  while (index < rbsp.length && rbsp[index] === 0xff) {
    value += 255;
    index += 1;
  }
  if (index >= rbsp.length) return null;
  value += rbsp[index];
  return { value, next: index + 1 };
};

const startsWithStampUuid = (payload) => {
  if (payload.length !== STAMP_UUID.length + PAYLOAD_BYTES) return false;
  for (let index = 0; index < STAMP_UUID.length; index += 1) {
    if (payload[index] !== STAMP_UUID[index]) return false;
  }
  return true;
};

/** Walks the SEI messages in one unescaped SEI NAL, returning ours if it is among them. */
const readStampFromSeiRbsp = (rbsp) => {
  let offset = 0;
  while (hasMoreSeiMessages(rbsp, offset)) {
    const type = readExtendedValue(rbsp, offset);
    if (type === null) return null;
    const size = readExtendedValue(rbsp, type.next);
    if (size === null) return null;

    const end = size.next + size.value;
    // A size that runs past the NAL means this is not the structure we think it is. Stop
    // rather than read whatever bytes happen to follow.
    if (end > rbsp.length) return null;

    const payload = rbsp.subarray(size.next, end);
    if (type.value === SEI_USER_DATA_UNREGISTERED && startsWithStampUuid(payload)) {
      return {
        sequence: readUint(payload, STAMP_UUID.length, SEQUENCE_BYTES),
        sentAt: readUint(payload, STAMP_UUID.length + SEQUENCE_BYTES, SENT_AT_BYTES),
        rung: readUint(payload, STAMP_UUID.length + SEQUENCE_BYTES + SENT_AT_BYTES, RUNG_BYTES),
      };
    }
    offset = end;
  }
  return null;
};

/**
 * Finds our stamp in an encoded frame.
 *
 * Returns null, quietly, for anything that does not carry one: an unstamped frame, a frame
 * carrying somebody else's SEI, a frame from a transcoding application, a non-H.264 frame.
 * That is the normal case on a stream where the publisher has the probe switched off, and the
 * caller reports it as "no frame stamp in this stream" rather than as a latency of zero.
 *
 * The marker is not assumed to be the first NAL. Chrome puts an SEI ahead of the slice on the
 * sender, but nothing guarantees where it sits after the Engine has handled the frame, and a
 * keyframe carries SPS and PPS in front of everything.
 */
export const findSeiPayload = (frameBytes) => {
  const bytes = asBytes(frameBytes);
  if (bytes === null || bytes.length === 0) return null;

  for (const nal of splitNalUnits(bytes)) {
    if (nal.length < 2) continue;
    // Bit 7 is forbidden_zero_bit: set means this is not a NAL header we understand.
    if ((nal[0] & 0x80) !== 0) continue;
    if ((nal[0] & 0x1f) !== NAL_TYPE_SEI) continue;

    const stamp = readStampFromSeiRbsp(removeEmulationPrevention(nal.subarray(1)));
    if (stamp !== null) return stamp;
  }
  return null;
};
