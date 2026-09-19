/*
 * The Signaling URL field, which means two different things depending on the transport.
 *
 * Over the WebSocket path the field holds a complete signalling URL and startPlay/startPublish
 * open it directly. Over WHIP and WHEP it holds an origin and those files append
 * /<application>/<stream>/whip. Both are stored in the same string, under the same cookie key,
 * and nothing here changes that: an old cookie and an old share link keep working.
 *
 * The field is not pre-filled. It carries a placeholder showing the shape the current
 * transport wants, and switching transport rewrites what is already there rather than asking
 * for it again.
 *
 * The internal names are 'wss' and 'http', never 'whip' or 'whep'. The user-facing word
 * differs by page (WHIP when publishing, WHEP when playing) and a label must never be a key.
 */

export const SIGNALING_PATH = '/webrtc-session.json';

/** The two internal transport names. */
export const WSS = 'wss';
export const HTTP = 'http';

/**
 * No host to connect to: a scheme and nothing usable after it.
 *
 * Empty, a bare scheme, or a scheme followed by the signalling path. The last of those is
 * not hypothetical: 'wss:///webrtc-session.json' parses as a URL whose host is
 * "webrtc-session.json", so every ordinary check reads it as a real address.
 */
export const isHostless = (value) => {
  const text = String(value ?? '').trim();
  if (text === '') return true;
  return ['ws://', 'wss://', 'http://', 'https://']
    .some((scheme) => text === scheme || text === scheme + SIGNALING_PATH);
};

/**
 * Which transport a value is written for, or null when it cannot be told.
 *
 * Null rather than a guess: a proxy on some other scheme should not be nagged at, and an
 * unparseable fragment mid-typing is not a mismatch.
 */
export const transportOf = (value) => {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') return WSS;
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return HTTP;
  return null;
};

/** True when the field holds a real URL written for the other transport. */
export const mismatched = (value, transport) => {
  if (isHostless(value)) return false;
  const found = transportOf(value);
  return found !== null && found !== transport;
};

/**
 * The same server, written for the other transport.
 *
 * Switching transport is a statement about how to reach the server, not about which server.
 * The host and port are the part that was typed and the part worth keeping; the scheme and
 * the path are the part that follows from the transport, so those are rewritten.
 *
 * Security level is carried across with the host: an http:// origin becomes ws://, not wss://.
 * Downgrading it would be a silent change to how the session is protected, and upgrading it
 * would produce a URL that does not answer.
 *
 * Nothing to carry gives back an empty field, so the placeholder shows through.
 */
export const convertTo = (value, transport) => {
  const text = String(value ?? '').trim();
  if (isHostless(text)) return '';

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return '';
  }
  if (!parsed.host) return '';

  const secure = parsed.protocol === 'wss:' || parsed.protocol === 'https:';
  return transport === HTTP
    ? `${secure ? 'https' : 'http'}://${parsed.host}`
    : `${secure ? 'wss' : 'ws'}://${parsed.host}${SIGNALING_PATH}`;
};
