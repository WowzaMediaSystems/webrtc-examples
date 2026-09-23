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
  if (!answerSdp) return false;
  const video = mediaSections(answerSdp).find((s) => s.header.startsWith('m=video'));
  // No m=video section at all refuses the video track as surely as port 0 does. Callers
  // only ask when video was offered, so a missing section reads as a rejection
  // (ENG-5135 behavior, restored).
  if (!video) return true;

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
 * The distinction in the message matters. "The server refused the codec I chose" and "my
 * browser cannot encode it, so the fallback offer went out and was refused too" are
 * different problems with different fixes, and naming the wrong one sends people to look
 * at the Engine when the answer is the browser they are sitting in front of.
 *
 * When the Engine did refuse, the fix is in its application config, not on this page: the
 * application only takes the codecs listed in PreferredCodecsVideo, and the refusal does
 * not say which those are. So the message names the setting.
 */
export const describeRejectedVideo = (answerSdp, offeredCodec, browserOffersCodec = null) => {
  if (!videoWasRejected(answerSdp)) return null;

  const asked = offeredCodec && offeredCodec !== 'auto' ? offeredCodec : null;

  if (asked && browserOffersCodec === false) {
    return `No video is being sent: this browser cannot encode ${asked} for WebRTC, so the `
      + `full codec list was offered instead, as with Auto, and the Engine application accepted `
      + `none of it. Check PreferredCodecsVideo in the application's Application.xml. Audio `
      + `is still being sent.`;
  }

  if (asked) {
    return `No video is being sent: the Engine application does not accept ${asked}. Add it `
      + `to PreferredCodecsVideo in the application's Application.xml, or set Video Codec to `
      + 'Auto. Audio is still being sent.';
  }

  return 'No video is being sent: the Engine application and this browser have no video '
    + 'codec in common, so the video track was refused. Check PreferredCodecsVideo in the '
    + "application's Application.xml. Audio is still being sent.";
};