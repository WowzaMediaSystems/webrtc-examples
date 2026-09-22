/*
 * Video codec preference for publishing.
 *
 * Why this exists: a browser offers its codecs in a preference order, but the answering
 * server chooses. Wowza Streaming Engine has been observed answering with H.265 even when
 * the browser ranks it last of twelve, which produces a stream that Chrome can decode but
 * Firefox cannot, and that downstream workflows expecting H.264 may not handle at all.
 *
 * setCodecPreferences filters the offer down to the wanted codec, which is the only
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

/** rtx, red and the FEC payloads are machinery, not codecs; they must never be filtered out. */
const AUXILIARY = /^(rtx|red|ulpfec|flexfec)/i;

const codecName = (c) => String(c.mimeType || '').split('/')[1] || '';

/**
 * Keeps only the preferred codec plus the auxiliary payload types.
 *
 * Reordering alone is not enough: Engine picks from the offer rather than honoring its
 * order (see the header), so removing the alternatives is the only way to make the
 * choice stick. When the wanted codec is not in the capability list the offer is left
 * alone, so an unsupported choice behaves like Auto rather than losing video.
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

/**
 * Applies the preference to the transceiver that owns `sender`.
 * Returns the codec the offer was filtered down to, or null when nothing was changed.
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

    const filtered = filterCodecs(capabilities.codecs, preferred);
    const first = filtered[0];
    const firstName = first ? codecName(first) : null;
    if (!firstName || firstName.toLowerCase() !== String(preferred).toLowerCase()) return null;

    transceiver.setCodecPreferences(filtered);
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
