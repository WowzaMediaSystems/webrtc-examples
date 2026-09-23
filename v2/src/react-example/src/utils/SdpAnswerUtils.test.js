import { describe, expect, it } from 'vitest';
import { describeRejectedVideo, videoWasRejected } from './SdpAnswerUtils';

const answer = (videoLine, extra = '') =>
  ['v=0', 'm=audio 7132 UDP/TLS/RTP/SAVPF 111', 'a=recvonly', videoLine, extra].join('\r\n');

const REJECTED = answer('m=video 0 UDP/TLS/RTP/SAVPF 0');
const INACTIVE = answer('m=video 7134 UDP/TLS/RTP/SAVPF 96', 'a=inactive');
const ACCEPTED = answer('m=video 7134 UDP/TLS/RTP/SAVPF 96', 'a=recvonly');
const NO_VIDEO_SECTION = answer('', '');

describe('videoWasRejected', () => {
  it('flags a port 0 video line', () => {
    expect(videoWasRejected(REJECTED)).toBe(true);
  });

  it('flags an inactive video line', () => {
    expect(videoWasRejected(INACTIVE)).toBe(true);
  });

  it('treats a missing video section as a rejection', () => {
    // Restored from ENG-5135: an answer that drops the m=video line refused the track.
    // Callers only ask when video was offered, so this cannot fire on audio-only.
    expect(videoWasRejected(NO_VIDEO_SECTION)).toBe(true);
  });

  it('is false for an accepted line or no sdp at all', () => {
    expect(videoWasRejected(ACCEPTED)).toBe(false);
    expect(videoWasRejected('')).toBe(false);
    expect(videoWasRejected(null)).toBe(false);
  });
});

describe('describeRejectedVideo', () => {
  it('leads with the consequence, not the mechanism', () => {
    expect(describeRejectedVideo(REJECTED, 'H264')).toMatch(/^No video is being sent/);
    expect(describeRejectedVideo(INACTIVE, 'auto')).toMatch(/^No video is being sent/);
  });

  it('names the codec that was asked for, and suggests Auto', () => {
    const m = describeRejectedVideo(REJECTED, 'H264');
    expect(m).toContain('H264');
    expect(m).toContain('Auto');
  });

  it('does not suggest Auto when Auto was already used', () => {
    expect(describeRejectedVideo(REJECTED, 'auto')).not.toContain('set Video Codec to Auto');
  });

  it('points at the Engine application codec setting whenever the Engine refused', () => {
    for (const m of [
      describeRejectedVideo(REJECTED, 'H264'),
      describeRejectedVideo(REJECTED, 'H265', false),
      describeRejectedVideo(REJECTED, 'auto'),
    ]) {
      expect(m).toMatch(/Engine application/);
      expect(m).toContain('PreferredCodecsVideo');
    }
  });

  /*
   * The case the Engine team diagnosed on 2026-09-17: Edge cannot encode H.265 for WebRTC.
   * The choice is ignored and the full codec list goes out instead, so when the server
   * still rejects video the message has to say both halves or it sends people to the
   * wrong machine.
   */
  it('says the fallback offer was used when the browser could not offer the codec', () => {
    const m = describeRejectedVideo(REJECTED, 'H265', false);
    expect(m).toMatch(/this browser cannot encode H265/i);
    expect(m).toMatch(/full codec list was offered/i);
    expect(m).not.toMatch(/offered H265/);
  });

  it('blames the Engine application when the browser did offer the codec', () => {
    const m = describeRejectedVideo(REJECTED, 'H265', true);
    expect(m).toMatch(/the Engine application does not accept H265/i);
  });

  it('stays neutral when browser support could not be determined', () => {
    const m = describeRejectedVideo(REJECTED, 'H265', null);
    expect(m).toMatch(/the Engine application does not accept H265/i);
  });

  it('says both sides when no specific codec was asked for', () => {
    expect(describeRejectedVideo(REJECTED, 'auto')).toMatch(/no video codec in common/i);
  });

  it('reports an answer with no video section at all', () => {
    expect(describeRejectedVideo(NO_VIDEO_SECTION, 'H264')).toMatch(/^No video is being sent/);
  });

  it('returns null for an accepted video line or no sdp', () => {
    expect(describeRejectedVideo(ACCEPTED, 'H264')).toBeNull();
    expect(describeRejectedVideo('', 'H264')).toBeNull();
    expect(describeRejectedVideo(null, 'H264')).toBeNull();
  });
});
