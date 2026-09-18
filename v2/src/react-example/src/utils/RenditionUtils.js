/*
 * Simulcast renditions, as the Engine actually exposes them.
 *
 * A simulcast ingest does not stay one stream with switchable layers on the playback side.
 * The Engine republishes each rendition under its own name: the first keeps the published
 * name and the rest get the RID appended after an underscore.
 *
 * Verified against a live Engine on 2026-09-17: publishing "diagmu5xnekj8881" with the
 * default rids h/m/l produced three entries in GET_AVAILABLE_STREAMS —
 * "diagmu5xnekj8881", "diagmu5xnekj8881_m" and "diagmu5xnekj8881_l".
 *
 * So choosing a rendition on the player is choosing a stream name, and nothing about the
 * signalling exchange changes.
 */

import { SIGNALING_PATH, isHostless } from './SignalingUrlUtils';

export const RENDITION_SEPARATOR = '_';

/**
 * The websocket URL to ask about available streams, given whatever is in the Signaling URL
 * field.
 *
 * Over WHEP that field holds an https origin, not a socket URL. The lookup still works:
 * the same host serves the signalling endpoint, so the origin is enough to reach it.
 * Verified against a live Engine on 2026-09-17 - "https://localhost.localhost" derived
 * "wss://localhost.localhost/webrtc-session.json", which answered GET_AVAILABLE_STREAMS
 * with the same list the socket URL returns.
 *
 * Returns null when there is nothing usable to derive from.
 */
export const signalingLookupUrl = (signalingURL) => {
  const text = String(signalingURL || '').trim();

  /*
   * A bare scheme is not an address, and 'wss:///webrtc-session.json' parses badly: new URL
   * reads the path segment as the host, so it came back as a lookup target pointing at a
   * server called webrtc-session.json, with the Find button enabled against it.
   */
  if (isHostless(text)) return null;

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }

  if (!parsed.host) return null;

  if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') return text;

  if (parsed.protocol === 'https:') return `wss://${parsed.host}${SIGNALING_PATH}`;
  if (parsed.protocol === 'http:') return `ws://${parsed.host}${SIGNALING_PATH}`;

  return null;
};

/**
 * The published name behind a possibly-rendition-suffixed one.
 *
 * Only strips a suffix when the stripped name is itself a live stream, so a stream that
 * genuinely contains an underscore ("camera_north") is left alone.
 */
export const baseStreamName = (streamName, streams) => {
  const name = String(streamName || '');
  const index = name.lastIndexOf(RENDITION_SEPARATOR);
  if (index <= 0) return name;

  const stripped = name.slice(0, index);
  const list = Array.isArray(streams) ? streams : [];
  return list.includes(stripped) ? stripped : name;
};

/**
 * Every rendition of one published stream, source first.
 *
 * Returns [] when the stream is not live or has no rendition siblings, which is the signal
 * to say so rather than to draw a picker with one entry in it.
 */
export const renditionsFor = (streamName, streams) => {
  const list = Array.isArray(streams) ? streams.filter((s) => typeof s === 'string') : [];
  const base = baseStreamName(streamName, list);
  if (base === '' || !list.includes(base)) return [];

  const prefix = base + RENDITION_SEPARATOR;
  const variants = list
    .filter((s) => s.startsWith(prefix) && s.length > prefix.length)
    .map((s) => ({ value: s, rid: s.slice(prefix.length) }))
    .sort((a, b) => a.rid.localeCompare(b.rid));

  if (variants.length === 0) return [];

  return [
    { value: base, label: 'Source (highest rendition)' },
    ...variants.map((v) => ({ value: v.value, label: `Rendition "${v.rid}"` })),
  ];
};

/**
 * Asks the Engine which streams are live on an application.
 *
 * Read-only, and on its own short-lived socket so it can never disturb a session in
 * progress. Resolves to null when the Engine cannot be reached, which callers report as
 * "could not look this up" rather than "there are none".
 */
export const listAvailableStreams = (signalingURL, applicationName, timeoutMs = 6000) =>
  new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let socket;
    try {
      socket = new WebSocket(signalingURL);
    } catch {
      return done(null);
    }

    const timer = setTimeout(() => {
      try { socket.close(); } catch { /* already closing */ }
      done(null);
    }, timeoutMs);

    const finish = (value) => {
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closing */ }
      done(value);
    };

    socket.onopen = () =>
      socket.send(JSON.stringify({ messageType: 'GET_AVAILABLE_STREAMS', applicationName }));

    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        // availableStreams is a list of objects, not of names: [{ streamName, ... }].
        const entries = Array.isArray(parsed.availableStreams) ? parsed.availableStreams : [];
        finish(entries.map((entry) => (typeof entry === 'string' ? entry : entry?.streamName)));
      } catch {
        finish(null);
      }
    };

    socket.onerror = () => finish(null);
    socket.onclose = () => done(null);
  });
