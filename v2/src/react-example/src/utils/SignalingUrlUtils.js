/*
 * The Signaling URL field. Over WebSocket it holds a full signaling URL; over WHIP/WHEP it
 * holds an origin that /<application>/<stream>/whip is appended to. Same string and cookie
 * key either way, so old cookies and share links keep working.
 *
 * Internal names are 'wss' and 'http', never 'whip' or 'whep': a label must never be a key.
 */

export const SIGNALING_PATH = '/webrtc-session.json';

/** The two internal transport names. */
export const WSS = 'wss';
export const HTTP = 'http';

/**
 * No host to connect to: empty, a bare scheme, or scheme plus the signaling path.
 * 'wss:///webrtc-session.json' parses with host "webrtc-session.json", so URL checks miss it.
 */
export const isHostless = (value) => {
  const text = String(value ?? '').trim();
  if (text === '') return true;
  return ['ws://', 'wss://', 'http://', 'https://']
    .some((scheme) => text === scheme || text === scheme + SIGNALING_PATH);
};

/**
 * Which transport a value is written for, or null when it cannot be told (another scheme,
 * a half-typed fragment), so those are never flagged as mismatches.
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
 * The same server written for the other transport: host and port kept, scheme and path
 * rewritten. Security level carries over (http:// becomes ws://, not wss://). Returns ''
 * when there is no host to carry, so the placeholder shows through.
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
