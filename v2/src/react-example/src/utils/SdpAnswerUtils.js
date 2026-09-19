/*
 * Detects an answer that rejects the video media line.
 *
 * A server answers `m=video 0 ... / a=inactive` when it will not accept any of the video
 * codecs offered. The peer connection still reaches "connected", the audio still flows and
 * the local preview keeps showing a picture, so without an explicit check the publish looks
 * successful while no video is ever sent.
 *
 * Observed against one Engine instance on 2026-09-17: publish offers of H.264, VP8 or VP9
 * alone were each rejected this way, while H.265 was accepted. Engine supports all four as a
 * product, so this is a server configuration state rather than a product limit - but while it
 * lasts it makes the browser's codec support decisive. Edge on Windows cannot do HEVC unless
 * the HEVC Video Extensions are installed, so it ends up with no video at all. */

/** Returns the m-section lines of the SDP, split into blocks. */
const mediaSections = (sdp) => {
  if (!sdp) return [];
  const lines = sdp.split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('m=')) {
      if (current) sections.push(current);
      current = { header: line, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
};

/** True when the answer's video m-section was refused outright. */
export const videoWasRejected = (answerSdp) => {
  const video = mediaSections(answerSdp).find((s) => s.header.startsWith('m=video'));
  if (!video) return false;

  const port = Number(video.header.split(' ')[1]);
  const inactive = video.lines.some((l) => l.trim() === 'a=inactive');

  /*
   * Port zero on a bundle-only section is not a refusal. RFC 8843 has the answerer zero the
   * port on every bundled m-line except the one carrying the transport, and mark those
   * bundle-only. Reading that as a rejection reports a working publish as having lost video.
   */
  const bundleOnly = video.lines.some((l) => l.trim() === 'a=bundle-only');

  return (port === 0 && !bundleOnly) || inactive;
};

/**
 * @param {string} answerSdp     the SDP the server answered with
 * @param {string} offeredCodec  what the client asked for, for the message
 * @param {boolean|null} browserOffersCodec  whether this browser can encode that codec at
 *        all; null when it could not be determined
 * @returns {string|null} a message when video was rejected, otherwise null
 *
 * The distinction in the message matters. "The server refused what I sent" and "my browser
 * never sent it" are different problems with different fixes, and naming the wrong one sends
 * people to look at the Engine when the answer is the browser they are sitting in front of.
 */
export const describeRejectedVideo = (answerSdp, offeredCodec, browserOffersCodec = null) => {
  if (!videoWasRejected(answerSdp)) return null;

  const asked = offeredCodec && offeredCodec !== 'auto' ? offeredCodec : null;

  if (asked && browserOffersCodec === false) {
    return `No video is being sent: this browser cannot encode ${asked} for WebRTC, so it `
      + `was never offered and the server had no video codec in common to answer with. `
      + `Audio is still being sent. Choose a codec this browser supports, or set Video `
      + `Codec to Auto.`;
  }

  if (asked) {
    return `No video is being sent: the server accepted none of the offered ${asked} codecs. `
      + 'Audio is still being sent. Try setting Video Codec to Auto.';
  }

  return 'No video is being sent: the server and this browser have no video codec in '
    + 'common, so the video track was refused. Audio is still being sent.';
};