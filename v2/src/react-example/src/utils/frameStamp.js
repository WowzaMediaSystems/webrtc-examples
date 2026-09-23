/*
 * The frame stamp: a sequence number and a send time carried inside the encoded H.264
 * bitstream as an SEI NAL. It lives in the bitstream, not the pixels, because rescaling and
 * simulcast destroy a pixel stamp; an SEI NAL survives them.
 *
 * Pure bytes: no DOM, no WebRTC, no React.
 *
 * SEI is H.264 only. VP8, VP9, AV1 and transcoding applications all read as "no stamp", which
 * the caller must present as unavailable rather than as zero latency.
 */

/*
 * Identifies our SEI among others. Printable ASCII is legible in a hex dump, and every byte is
 * above 0x03, so the marker never triggers emulation prevention.
 */
export const STAMP_UUID = Uint8Array.from(
  'WZFRAMESTAMPv002', (character) => character.charCodeAt(0),
);

const NAL_TYPE_SEI = 6;
const SEI_USER_DATA_UNREGISTERED = 5;
const RBSP_STOP_BYTE = 0x80;

/*
 * Field widths, big endian, fixed. The send time is a Date.now millisecond clock: 6 bytes
 * rather than 4 because it needs 41 bits today, and rather than 8 so it stays within the
 * 53-bit range a JavaScript number represents exactly (no BigInt).
 */
const SEQUENCE_BYTES = 4;
const SENT_AT_BYTES = 6;

/*
 * The rung, added in v002. The sender counts its sequence per rung, and the Engine
 * re-originates every rendition under one SSRC, so the receiver needs the rung to key its
 * baseline: a change of rung starts a new baseline instead of reporting a gap. A small index
 * per sender in order of first appearance, not an SSRC.
 */
const RUNG_BYTES = 1;

const PAYLOAD_BYTES = SEQUENCE_BYTES + SENT_AT_BYTES + RUNG_BYTES;
export const MAX_SEQUENCE = 2 ** (SEQUENCE_BYTES * 8) - 1;
export const MAX_SENT_AT = 2 ** (SENT_AT_BYTES * 8) - 1;
export const MAX_RUNG = 2 ** (RUNG_BYTES * 8) - 1;

/*
 * Arithmetic, not bit shifting: JavaScript bitwise operators truncate to 32 bits, which breaks
 * a 48-bit timestamp.
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
 * Inserts emulation prevention bytes: 0x03 after any two zeros followed by a byte <= 0x03, so
 * the payload never contains a start code. A timestamp can contain 00 00 01 by accident, so
 * skipping this corrupts the stream.
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
 * Builds the complete Annex B SEI NAL, ready to prepend to an encoded frame: start code, NAL
 * header 0x06 (nal_ref_idc 0), payload type 5 (user_data_unregistered), size, UUID, fields,
 * stop byte.
 *
 * Throws on an out-of-range value rather than wrapping it into a plausible wrong number.
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

  // Escape the whole RBSP: a decoder unescapes before it parses any of it.
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
 * Splits an Annex B frame into NAL units. Trailing zeros belong to the separator, so they are
 * trimmed; otherwise they look like the start of another SEI message.
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
 * more_rbsp_data, byte aligned: only the stop byte left (ignoring padding zeros) means the end.
 * "Next byte is 0x80" alone is not safe, because payload type 128 also encodes as 0x80.
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
    // A size past the end of the NAL means this is not the structure we expect.
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
 * Finds our stamp in an encoded frame, or returns null for anything that does not carry one.
 * The caller reports null as "no frame stamp", never as zero latency.
 *
 * The marker is not assumed to be the first NAL: nothing guarantees its position after the
 * Engine, and a keyframe carries SPS and PPS first.
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
