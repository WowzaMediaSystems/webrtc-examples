/*
 * The one browser question this example asks.
 *
 * It used to come from webrtc-adapter, which is 114 KB of source (the shim plus its sdp
 * dependency) pulled into the bundle to answer it. Nothing else in the example used the
 * shim: every browser it supports has had unprefixed getUserMedia and RTCPeerConnection for
 * years, so the polyfilling had nothing left to do.
 *
 * The test is webrtc-adapter's own, in its own order: Firefox and Chromium are identified
 * first by their prefixed entry points, so a Chromium build is never mistaken for Safari on
 * the strength of carrying AppleWebKit in its user agent, which all of them do.
 */
export const isSafari = () => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;

  if (navigator.mozGetUserMedia) return false;
  if (navigator.webkitGetUserMedia
    || (window.isSecureContext === false && window.webkitRTCPeerConnection)) return false;

  return Boolean(window.RTCPeerConnection && /AppleWebKit\/(\d+)\./.test(navigator.userAgent));
};
