/*
 * Simulcast renditions, as the Engine exposes them. The Engine republishes each rendition
 * as its own stream: the first keeps the published name, the rest get "_<rid>" appended
 * (rids h/m/l give "name", "name_m", "name_l"). Choosing a rendition is choosing a stream name.
 */

import { SIGNALING_PATH, isHostless } from './SignalingUrlUtils';
import { DEFAULT_SIMULCAST_RENDITIONS } from './SimulcastUtils';

export const RENDITION_SEPARATOR = '_';

/**
 * The WebSocket URL for a stream lookup, from the Signaling URL field. Under WHEP the field
 * holds an https origin; the same host serves the signaling endpoint. Returns null when
 * nothing usable can be derived.
 */
export const signalingLookupUrl = (signalingURL) => {
  const text = String(signalingURL || '').trim();

  // new URL('wss:///webrtc-session.json') reads the path segment as the host.
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
 * The published name behind a possibly rendition-suffixed one. Strips only when the result
 * is itself live, so "camera_north" is left alone.
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
 * Every rendition of one published stream, source first. Returns [] when the stream is not
 * live or has no rendition siblings.
 */
/*
 * The player cannot see the publisher's ladder, so rids in the default ladder (h, m, l) keep
 * that order, highest first; any others follow alphabetically.
 */
const LADDER = DEFAULT_SIMULCAST_RENDITIONS.map((r) => r.rid);
const byLadder = (a, b) => {
  const ia = LADDER.indexOf(a.rid);
  const ib = LADDER.indexOf(b.rid);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.rid.localeCompare(b.rid);
};

export const renditionsFor = (streamName, streams) => {
  const list = Array.isArray(streams) ? streams.filter((s) => typeof s === 'string') : [];
  const base = baseStreamName(streamName, list);
  if (base === '' || !list.includes(base)) return [];

  const prefix = base + RENDITION_SEPARATOR;
  const variants = list
    .filter((s) => s.startsWith(prefix) && s.length > prefix.length)
    .map((s) => ({ value: s, rid: s.slice(prefix.length) }))
    .sort(byLadder);

  if (variants.length === 0) return [];

  return [
    { value: base, label: 'Source (highest rendition)' },
    ...variants.map((v) => ({ value: v.value, label: `Rendition "${v.rid}"` })),
  ];
};

/**
 * Asks the Engine which streams are live on an application, on its own short-lived socket
 * so it cannot disturb a session. Resolves to null when the Engine cannot be reached.
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
        // An error or status frame (bad application, auth failure) is not a stream list, and
        // must not read as "not live". availableStreams holds objects: [{ streamName, ... }].
        if (!Array.isArray(parsed.availableStreams)) return finish(null);
        finish(parsed.availableStreams.map((entry) => (typeof entry === 'string' ? entry : entry?.streamName)));
      } catch {
        finish(null);
      }
    };

    socket.onerror = () => finish(null);
    socket.onclose = () => done(null);
  });
