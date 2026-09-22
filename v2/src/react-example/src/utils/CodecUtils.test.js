import { describe, expect, it } from 'vitest';

import { DEFAULT_VIDEO_CODEC, VIDEO_CODEC_OPTIONS, filterCodecs } from './CodecUtils';

// Shaped like RTCRtpSender.getCapabilities('video').codecs, in the order Chrome reports:
// VP8 first, H264 next, H265 last of twelve.
const caps = [
  { mimeType: 'video/VP8' },
  { mimeType: 'video/rtx' },
  { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=42e01f' },
  { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=640c1f' },
  { mimeType: 'video/AV1' },
  { mimeType: 'video/VP9' },
  { mimeType: 'video/H265' },
];

const names = (list) => list.map((c) => c.mimeType.replace('video/', ''));

describe('defaults', () => {
  // Auto rather than H.264: an explicit codec filters the offer, and a server that will not
  // accept it rejects the video line outright instead of falling back.
  it('defaults to Auto so the browser offer is never narrowed by default', () => {
    expect(DEFAULT_VIDEO_CODEC).toBe('auto');
  });

  // Grouped the way an operator reads them: the H.26x pair, then the VPx pair, then AV1.
  it('offers auto plus the codecs the examples care about, in family order', () => {
    expect(VIDEO_CODEC_OPTIONS.map((o) => o.value))
      .toEqual(['auto', 'H264', 'H265', 'VP8', 'VP9', 'AV1']);
  });
});
describe('filterCodecs', () => {
  // Reordering is not enough: the Engine picks from the offer rather than honouring its
  // order, so the alternatives have to be removed for the choice to hold.
  it('removes every other video codec', () => {
    expect(names(filterCodecs(caps, 'H264')).filter((n) => /^(VP8|VP9|AV1|H265)$/.test(n))).toEqual([]);
  });

  it('keeps all matching profiles of the wanted codec', () => {
    expect(names(filterCodecs(caps, 'H264')).filter((n) => n === 'H264')).toHaveLength(2);
  });

  it('keeps rtx, because dropping it breaks retransmission', () => {
    expect(names(filterCodecs(caps, 'H264'))).toContain('rtx');
  });

  it('leaves the offer untouched for auto', () => {
    expect(names(filterCodecs(caps, 'auto'))).toEqual(names(caps));
  });

  it('leaves the offer untouched when the codec is unsupported here', () => {
    expect(names(filterCodecs(caps, 'H266'))).toEqual(names(caps));
  });

  it('never returns an empty list', () => {
    expect(filterCodecs(caps, 'VP9').length).toBeGreaterThan(0);
  });

  it('does not mutate the input', () => {
    const before = names(caps);
    filterCodecs(caps, 'H265');
    expect(names(caps)).toEqual(before);
  });
});