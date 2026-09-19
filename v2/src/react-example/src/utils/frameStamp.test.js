import { describe, expect, it } from 'vitest';

import {
  MAX_RUNG,
  MAX_SENT_AT,
  MAX_SEQUENCE,
  STAMP_UUID,
  addEmulationPrevention,
  buildSeiPayload,
  findSeiPayload,
  removeEmulationPrevention,
} from './frameStamp';

const START_CODE = [0x00, 0x00, 0x00, 0x01];

/** One Annex B NAL: four-byte start code, header byte, body. */
const nal = (header, ...body) => [...START_CODE, header, ...body];

// Plausible stand-ins for the NALs that travel beside ours. The bytes do not have to decode,
// they only have to be shaped like real ones and carry no accidental start code.
const sps = () => nal(0x67, 0x42, 0xc0, 0x1f, 0x8c, 0x8d, 0x40, 0x50);
const pps = () => nal(0x68, 0xce, 0x3c, 0x80);
const idrSlice = () => nal(0x65, 0x88, 0x84, 0x21, 0x33, 0xff, 0xa1);
const deltaSlice = () => nal(0x41, 0x9a, 0x24, 0x6c, 0x41, 0x7f);

const frame = (...parts) => Uint8Array.from(parts.flat());

const ascii = (text) => [...text].map((character) => character.charCodeAt(0));

/** Ten payload bytes, so a foreign marker is the same length as ours and only the UUID differs. */
const TEN_BYTES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** An SEI message body: type, size, payload. Sizes here are all below the 0xff extension. */
const seiMessage = (type, payload) => [type, payload.length, ...payload];

/** A complete SEI NAL from already-built messages, escaped the way an encoder would. */
const seiNal = (...messages) => [
  ...START_CODE,
  0x06,
  ...addEmulationPrevention(Uint8Array.from([...messages.flat(), 0x80])),
];

/** Somebody else user_data_unregistered SEI: same type, same length, different UUID. */
const foreignSeiNal = () => seiNal(seiMessage(5, [...ascii('SOMEBODYELSESEI0'), ...TEN_BYTES]));

/*
 * The rule an escaped NAL has to satisfy, checked directly on the wire bytes.
 *
 * 00 00 00, 00 00 01 and 00 00 02 may not appear after the start code: a decoder scanning for
 * a start code prefix would split the NAL there. 00 00 03 is legal, because that 0x03 IS the
 * emulation prevention byte, but only when what follows is a byte it could have been escaping.
 * Anything else means the escaping ran off the rails.
 */
const findIllegalRun = (bytes, from) => {
  for (let index = from; index + 2 < bytes.length; index += 1) {
    if (bytes[index] !== 0x00 || bytes[index + 1] !== 0x00) continue;
    const third = bytes[index + 2];
    if (third <= 0x02) return index;
    if (third === 0x03 && index + 3 < bytes.length && bytes[index + 3] > 0x03) return index;
  }
  return -1;
};

describe('the stamp marker', () => {
  it('is 16 bytes, which is what a user_data_unregistered SEI requires', () => {
    expect(STAMP_UUID).toHaveLength(16);
  });

  it('builds the NAL header a decoder expects', () => {
    const built = buildSeiPayload({ sequence: 7, sentAt: 1_726_600_000_123 });
    // start code, then nal_unit_type 6 (SEI), then payload type 5 (user_data_unregistered).
    expect([...built.subarray(0, 6)]).toEqual([0x00, 0x00, 0x00, 0x01, 0x06, 0x05]);
    expect(built[built.length - 1]).toBe(0x80);
  });
});

describe('round trip', () => {
  it('carries a sequence number and a wall clock time through unchanged', () => {
    const sentAt = 1_726_600_000_123;
    expect(findSeiPayload(buildSeiPayload({ sequence: 42, sentAt, rung: 1 }))).toEqual({
      sequence: 42, sentAt, rung: 1,
    });
  });

  /*
   * The rung is what lets the receiver count per rung, the way the sender does. Without it a
   * viewer that is handed one rung and then settled onto another counts the step between two
   * unrelated counters as loss.
   */
  it('carries the rung, and defaults it to zero for a sender with one stream', () => {
    const sentAt = 1_726_600_000_123;
    expect(findSeiPayload(buildSeiPayload({ sequence: 7, sentAt })).rung).toBe(0);
    expect(findSeiPayload(buildSeiPayload({ sequence: 7, sentAt, rung: 2 })).rung).toBe(2);
    expect(findSeiPayload(buildSeiPayload({ sequence: 7, sentAt, rung: MAX_RUNG })).rung)
      .toBe(MAX_RUNG);
  });

  it('refuses a rung that does not fit the byte it is written into', () => {
    const sentAt = 1_726_600_000_123;
    expect(() => buildSeiPayload({ sequence: 1, sentAt, rung: MAX_RUNG + 1 })).toThrow(RangeError);
    expect(() => buildSeiPayload({ sequence: 1, sentAt, rung: -1 })).toThrow(RangeError);
    expect(() => buildSeiPayload({ sequence: 1, sentAt, rung: 1.5 })).toThrow(RangeError);
  });

  it('carries the real Date.now, exactly, without rounding', () => {
    const sentAt = Date.now();
    const read = findSeiPayload(buildSeiPayload({ sequence: 1, sentAt }));
    expect(read.sentAt).toBe(sentAt);
  });

  /*
   * 48 bits of milliseconds is the point of the field width: a 32-bit millisecond clock wraps
   * every 49.7 days, and a session that straddled the wrap would report a latency of weeks.
   */
  it('carries the widest value each field can hold', () => {
    const widest = { sequence: MAX_SEQUENCE, sentAt: MAX_SENT_AT, rung: MAX_RUNG };
    expect(findSeiPayload(buildSeiPayload(widest))).toEqual(widest);
  });

  it('carries zero, which is not the same answer as no stamp', () => {
    expect(findSeiPayload(buildSeiPayload({ sequence: 0, sentAt: 0, rung: 0 })))
      .toEqual({ sequence: 0, sentAt: 0, rung: 0 });
  });

  it('keeps the fields apart rather than bleeding one into the other', () => {
    const stamp = { sequence: 0xabcdef01, sentAt: 0x0123456789ab, rung: 0x5a };
    expect(findSeiPayload(buildSeiPayload(stamp))).toEqual(stamp);
  });
});

/*
 * The part most likely to be wrong, so it gets the most tests. Every value below puts one of
 * the four forbidden runs inside the payload, either within a field or straddling the boundary
 * between the sequence number and the timestamp.
 */
describe('emulation prevention', () => {
  const cases = [
    ['00 00 00, a whole payload of zeros', { sequence: 0, sentAt: 0 }],
    ['00 00 01 inside the sequence number', { sequence: 1, sentAt: 1_726_600_000_123 }],
    ['00 00 02 inside the sequence number', { sequence: 2, sentAt: 1_726_600_000_123 }],
    ['00 00 03 inside the sequence number', { sequence: 3, sentAt: 1_726_600_000_123 }],
    ['00 00 01 inside the timestamp', { sequence: 0x11223344, sentAt: 0x000001000000 }],
    ['00 00 02 inside the timestamp', { sequence: 0x11223344, sentAt: 0x000002000000 }],
    ['00 00 03 inside the timestamp', { sequence: 0x11223344, sentAt: 0x000003000000 }],
    ['00 00 01 straddling the two fields', { sequence: 0x12340000, sentAt: 0x010000000000 }],
    ['00 00 02 straddling the two fields', { sequence: 0x12340000, sentAt: 0x020000000000 }],
    ['00 00 03 straddling the two fields', { sequence: 0x12340000, sentAt: 0x030000000000 }],
    ['00 00 00 straddling the two fields', { sequence: 0x12340000, sentAt: 0x000000abcdef }],
    // The boundary the rung byte added: the tail of the timestamp against the rung itself.
    ['00 00 01 straddling the timestamp and the rung', { sequence: 0x11223344, sentAt: 0x0000abcd0000, rung: 1 }],
    ['00 00 02 straddling the timestamp and the rung', { sequence: 0x11223344, sentAt: 0x0000abcd0000, rung: 2 }],
    ['00 00 03 straddling the timestamp and the rung', { sequence: 0x11223344, sentAt: 0x0000abcd0000, rung: 3 }],
    ['00 00 00 ending at the rung', { sequence: 0x11223344, sentAt: 0x0000abcd0000, rung: 0 }],
  ].map(([label, stamp]) => [label, { rung: 0, ...stamp }]);

  it.each(cases)('escapes %s on write, so the NAL is legal', (_label, stamp) => {
    const built = buildSeiPayload(stamp);
    // From index 4: the start code is allowed to contain the run, the NAL body is not.
    expect(findIllegalRun(built, 4)).toBe(-1);
  });

  it.each(cases)('unescapes %s on read, so the value is the one that was written', (_l, stamp) => {
    expect(findSeiPayload(buildSeiPayload(stamp))).toEqual(stamp);
  });

  it('really does insert bytes, rather than the test proving nothing', () => {
    const clean = buildSeiPayload({ sequence: 0x11223344, sentAt: 0x556677889900 });
    const escaped = buildSeiPayload({ sequence: 0, sentAt: 0 });
    expect(escaped.length).toBeGreaterThan(clean.length);
  });

  it('round trips every third byte after a pair of zeros', () => {
    for (let byte = 0; byte <= 0xff; byte += 1) {
      const rbsp = Uint8Array.from([0x00, 0x00, byte, 0x00, 0x00, 0x00, byte]);
      expect([...removeEmulationPrevention(addEmulationPrevention(rbsp))]).toEqual([...rbsp]);
    }
  });

  it('round trips arbitrary byte soup, byte for byte', () => {
    // A fixed generator, so a failure is reproducible rather than a once-a-month surprise.
    // Math.imul keeps the multiply exact at 32 bits; a plain multiply loses the low bits.
    let state = 0x20260917;
    const nextByte = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      // Four bytes in five are 0x00-0x03, because that is where the escaping lives.
      return (state >>> 24) % 5 === 0 ? (state >>> 8) & 0xff : (state >>> 8) & 0x03;
    };

    for (let trial = 0; trial < 200; trial += 1) {
      const rbsp = Uint8Array.from({ length: 24 }, nextByte);
      const escaped = addEmulationPrevention(rbsp);
      expect(findIllegalRun(escaped, 0)).toBe(-1);
      expect([...removeEmulationPrevention(escaped)]).toEqual([...rbsp]);
    }
  });

  it('leaves a payload with no forbidden run untouched', () => {
    const rbsp = Uint8Array.from([0x05, 0x1a, 0xff, 0x00, 0x11, 0x00, 0x22]);
    expect([...addEmulationPrevention(rbsp)]).toEqual([...rbsp]);
  });
});

describe('finding the stamp in a real looking frame', () => {
  const stamp = { sequence: 900, sentAt: 1_726_600_000_456, rung: 2 };

  it('finds it when the encoder put it in front of the slice', () => {
    const bytes = frame([...buildSeiPayload(stamp)], deltaSlice());
    expect(findSeiPayload(bytes)).toEqual(stamp);
  });

  it('finds it behind the parameter sets on a keyframe', () => {
    const bytes = frame(sps(), pps(), [...buildSeiPayload(stamp)], idrSlice());
    expect(findSeiPayload(bytes)).toEqual(stamp);
  });

  it('finds it after the slice, where nothing guarantees it will not be', () => {
    const bytes = frame(sps(), pps(), idrSlice(), [...buildSeiPayload(stamp)]);
    expect(findSeiPayload(bytes)).toEqual(stamp);
  });

  it('finds it past a foreign SEI NAL', () => {
    const bytes = frame(sps(), foreignSeiNal(), [...buildSeiPayload(stamp)], idrSlice());
    expect(findSeiPayload(bytes)).toEqual(stamp);
  });

  it('finds it as the second message inside one SEI NAL', () => {
    const ours = [...buildSeiPayload(stamp)];
    // Strip start code and NAL header, unescape, and re-pack with a neighbour in front.
    const oursRbsp = [...removeEmulationPrevention(Uint8Array.from(ours.slice(5)))];
    const oursMessage = oursRbsp.slice(0, oursRbsp.length - 1);

    // A neighbour with an 0xff-extended payload type (261) and size (300), to exercise both.
    const bulky = [0xff, 0x06, 0xff, 0x2d, ...new Array(300).fill(0x11)];
    const bytes = frame(seiNal(bulky, oursMessage), idrSlice());
    expect(findSeiPayload(bytes)).toEqual(stamp);
  });

  it('reads a three-byte start code as well as a four-byte one', () => {
    const built = [...buildSeiPayload(stamp)];
    const bytes = frame(sps(), built.slice(1), deltaSlice());
    expect(findSeiPayload(bytes)).toEqual(stamp);
  });

  it('accepts the ArrayBuffer that RTCEncodedVideoFrame.data actually hands over', () => {
    const bytes = frame(sps(), [...buildSeiPayload(stamp)], idrSlice());
    expect(findSeiPayload(bytes.buffer)).toEqual(stamp);
    expect(findSeiPayload(new DataView(bytes.buffer))).toEqual(stamp);
  });
});

/*
 * Silence is the correct answer for a stream nobody stamped, and it has to stay silence: a
 * caller that got a zero back would draw a latency chart out of nothing.
 */
describe('frames with no stamp of ours', () => {
  it('says nothing about an ordinary unstamped frame', () => {
    expect(findSeiPayload(frame(sps(), pps(), idrSlice()))).toBeNull();
    expect(findSeiPayload(frame(deltaSlice()))).toBeNull();
  });

  it('says nothing about an empty frame or a frame with no start code at all', () => {
    expect(findSeiPayload(new Uint8Array(0))).toBeNull();
    expect(findSeiPayload(Uint8Array.from([0x65, 0x88, 0x84]))).toBeNull();
  });

  it('says nothing about a frame carrying somebody else SEI', () => {
    expect(findSeiPayload(frame(sps(), foreignSeiNal(), idrSlice()))).toBeNull();
  });

  /*
   * The one case where garbage would look like a reading: the right 16 bytes in the wrong kind
   * of SEI message. Picture timing is not user data and must not be parsed as ours.
   */
  it('says nothing when our UUID turns up under a different payload type', () => {
    const impostor = seiNal(seiMessage(1, [...STAMP_UUID, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    expect(findSeiPayload(frame(impostor, idrSlice()))).toBeNull();
  });

  it('says nothing when the marker is right but the payload is the wrong length', () => {
    const truncated = seiNal(seiMessage(5, [...STAMP_UUID, 0x00, 0x00]));
    expect(findSeiPayload(frame(truncated, idrSlice()))).toBeNull();
  });

  it('says nothing, and does not throw, when an SEI size runs past the NAL', () => {
    const lying = [...START_CODE, 0x06, 0x05, 100, ...STAMP_UUID, 0x80];
    expect(findSeiPayload(frame(lying, idrSlice()))).toBeNull();
  });

  it('says nothing, and does not throw, on bytes that are not H.264 at all', () => {
    const noise = Uint8Array.from({ length: 300 }, (_unused, index) => (index * 37) % 4);
    expect(findSeiPayload(noise)).toBeNull();
  });

  it('says nothing about something that is not a buffer', () => {
    expect(findSeiPayload(null)).toBeNull();
    expect(findSeiPayload(undefined)).toBeNull();
    expect(findSeiPayload('00 00 00 01')).toBeNull();
  });
});

/*
 * An out-of-range field is a caller bug, and truncating it would hide that bug inside a
 * plausible looking latency. Throwing puts it where it can be seen.
 */
describe('refusing to build a stamp it cannot represent', () => {
  it.each([
    ['a negative sequence', { sequence: -1, sentAt: 0 }],
    ['a fractional sequence', { sequence: 1.5, sentAt: 0 }],
    ['a sequence past 32 bits', { sequence: MAX_SEQUENCE + 1, sentAt: 0 }],
    ['a missing sequence', { sentAt: 0 }],
    ['a negative time', { sequence: 0, sentAt: -1 }],
    ['a fractional time', { sequence: 0, sentAt: 1_726_600_000_123.4 }],
    ['a time past 48 bits', { sequence: 0, sentAt: MAX_SENT_AT + 1 }],
    ['a time that is not a number', { sequence: 0, sentAt: NaN }],
  ])('throws on %s', (_label, stamp) => {
    expect(() => buildSeiPayload(stamp)).toThrow(RangeError);
  });
});
