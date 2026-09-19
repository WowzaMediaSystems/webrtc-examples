/*
 * Video codec preference for publishing.
 *
 * Why this exists: a browser offers its codecs in a preference order, but the answering
 * server chooses. Wowza Streaming Engine has been observed answering with H.265 even when
 * the browser ranks it last of twelve, which produces a stream that Chrome can decode but
 * Firefox cannot, and that downstream workflows expecting H.264 may not handle at all.
 *
 * setCodecPreferences reorders the offer so the wanted codec is first, which is the only
 * lever the client has over that choice. The v1 jQuery example had a Video Codec dropdown;
 * the v2 React example lost it, leaving no way to influence the negotiation.
 */

// Ordered the way an Engine operator thinks about them: the two H.26x codecs together,
// then the VPx pair, then AV1.
export const VIDEO_CODEC_OPTIONS = [
  { value: 'auto', label: 'Auto (browser default order)' },
  { value: 'H264', label: 'H.264' },
  { value: 'H265', label: 'H.265 / HEVC' },
  { value: 'VP8', label: 'VP8' },
  { value: 'VP9', label: 'VP9' },
  { value: 'AV1', label: 'AV1' },
];

// Auto, deliberately. Filtering the offer down to one codec is the only way to make a
// choice stick, but a server that does not accept that codec answers by rejecting the whole
// video line - so a wrong explicit default loses video entirely rather than merely
// negotiating something unexpected. Auto keeps the browser's full offer on the table.
export const DEFAULT_VIDEO_CODEC = 'auto';

/**
 * Returns the capability list reordered so that codecs matching `preferred` come first,
 * with everything else following in its original order. Auxiliary payload types (rtx, red,
 * fec) are left in place relative to the rest, because removing them breaks retransmission.
 *
 * Pure, so it can be tested without a peer connection.
 */
/** rtx, red and the FEC payloads are machinery, not codecs; they must never be filtered out. */
const AUXILIARY = /^(rtx|red|ulpfec|flexfec)/i;

const codecName = (c) => String(c.mimeType || '').split('/')[1] || '';

/**
 * Keeps only the preferred codec plus the auxiliary payload types.
 *
 * Reordering alone is not enough. Wowza Streaming Engine picks from the offer rather than
 * honouring its order, and has been observed answering H.265 even when the browser ranks it
 * last of twelve and the client has explicitly put H.264 first. Removing the alternatives is
 * the only way a client can make the choice stick.
 *
 * This matters beyond tidiness: Edge on Windows cannot decode H.265 unless the HEVC Video
 * Extensions are installed, so an H.265 answer leaves those viewers with no picture.
 */
export const filterCodecs = (codecs, preferred) => {
  if (!Array.isArray(codecs) || codecs.length === 0) return [];
  if (!preferred || preferred === 'auto') return [...codecs];

  const wanted = String(preferred).toLowerCase();
  const kept = codecs.filter((c) => codecName(c).toLowerCase() === wanted);
  if (kept.length === 0) return [...codecs]; // not supported here; leave the offer alone

  return [...kept, ...codecs.filter((c) => AUXILIARY.test(codecName(c)))];
};

export const orderCodecs = (codecs, preferred) => {
  if (!Array.isArray(codecs) || codecs.length === 0) return [];
  if (!preferred || preferred === 'auto') return [...codecs];

  const wanted = String(preferred).toLowerCase();
  const matches = (c) => {
    const name = String(c.mimeType || '').split('/')[1] || '';
    return name.toLowerCase() === wanted;
  };

  const preferredCodecs = codecs.filter(matches);
  if (preferredCodecs.length === 0) return [...codecs]; // not supported here; leave it alone

  return [...preferredCodecs, ...codecs.filter((c) => !matches(c))];
};

/**
 * Applies the preference to the transceiver that owns `sender`.
 * Returns the codec actually put first, or null if nothing was changed.
 */
export const applyVideoCodecPreference = (peerConnection, sender, preferred) => {
  if (!peerConnection || !sender || !preferred || preferred === 'auto') return null;
  if (typeof RTCRtpSender === 'undefined' || !RTCRtpSender.getCapabilities) return null;

  try {
    const transceiver = peerConnection
      .getTransceivers()
      .find((t) => t.sender === sender);
    if (!transceiver || typeof transceiver.setCodecPreferences !== 'function') return null;

    const capabilities = RTCRtpSender.getCapabilities('video');
    if (!capabilities || !capabilities.codecs) return null;

    const ordered = filterCodecs(capabilities.codecs, preferred);
    const first = ordered[0];
    const firstName = first ? String(first.mimeType || '').split('/')[1] : null;
    if (!firstName || firstName.toLowerCase() !== String(preferred).toLowerCase()) return null;

    transceiver.setCodecPreferences(ordered);
    return firstName;
  } catch {
    // An unsupported preference must not stop the publish; fall back to browser order.
    return null;
  }
};

/**
 * Whether this browser can offer a codec for sending at all.
 *
 * Worth asking before the negotiation rather than after: a browser that cannot encode the
 * chosen codec simply leaves it out of the offer, the server then has nothing in common to
 * answer with, and the resulting failure looks like a server problem. Edge sends no H.265
 * over WebRTC, and Chrome only does on Windows, macOS and Android with a hardware encoder.
 *
 * Returns null when the question cannot be answered here (no RTCRtpSender, or codec 'auto'),
 * which callers treat as "no reason to warn".
 */
export const isVideoCodecOfferable = (codec) => {
  if (!codec || codec === 'auto') return null;
  if (typeof RTCRtpSender === 'undefined' || !RTCRtpSender.getCapabilities) return null;

  try {
    const capabilities = RTCRtpSender.getCapabilities('video');
    if (!capabilities || !Array.isArray(capabilities.codecs)) return null;
    return capabilities.codecs.some(
      (c) => codecName(c).toLowerCase() === String(codec).toLowerCase()
    );
  } catch {
    return null;
  }
};
