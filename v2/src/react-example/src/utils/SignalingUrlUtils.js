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

// A pasted WHIP/WHEP endpoint; the page builds this part itself from the form.
const ENDPOINT_TAIL = /\/[^/]+\/[^/]+\/(whip|whep)$/i;

/**
 * The same server written for the other transport: host, port and any path prefix (a reverse
 * proxy mount) kept; scheme and the transport's own path rewritten. Security level carries
 * over (http:// becomes ws://, not wss://). Returns '' when there is no host to carry, and
 * the text unchanged when it cannot be read as a web URL, so nothing typed is lost.
 */
export const convertTo = (value, transport) => {
  const text = String(value ?? '').trim();
  if (isHostless(text)) return '';

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return text;
  }
  const web = ['ws:', 'wss:', 'http:', 'https:'].includes(parsed.protocol);
  if (!web || !parsed.host) return text;

  let prefix = parsed.pathname;
  if (prefix.endsWith(SIGNALING_PATH)) prefix = prefix.slice(0, -SIGNALING_PATH.length);
  prefix = prefix.replace(ENDPOINT_TAIL, '').replace(/\/+$/, '');

  const secure = parsed.protocol === 'wss:' || parsed.protocol === 'https:';
  return transport === HTTP
    ? `${secure ? 'https' : 'http'}://${parsed.host}${prefix}`
    : `${secure ? 'wss' : 'ws'}://${parsed.host}${prefix}${SIGNALING_PATH}`;
};
