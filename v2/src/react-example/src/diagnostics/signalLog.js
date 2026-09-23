/*
 * Append-only ring buffer of traffic between this page and the Engine: WebSocket signaling,
 * WHIP/WHEP HTTP, ICE candidates and peer-connection state. Instrumentation attaches where
 * sockets and peer connections are created, so call sites need not know the panel exists.
 */

import { registerPeerConnection } from './connections';
import { createStore } from './createStore';

const MAX_ENTRIES = 500;

let seq = 0;
const store = createStore([]);

export const subscribe = store.subscribe;

export const clearLog = () => store.set([]);

export const getEntries = store.get;

/**
 * direction: 'out' | 'in' | 'info' | 'error'
 * channel:   'ws' | 'http' | 'ice' | 'pc'
 */
export const logEvent = (direction, channel, label, detail) => {
  const entry = {
    id: ++seq,
    at: Date.now(),
    direction,
    channel,
    label,
    detail: detail === undefined ? null : detail,
  };
  // Newest last, oldest dropped. A new array each time so React sees the change.
  const entries = store.get();
  store.set(entries.length >= MAX_ENTRIES
    ? [...entries.slice(entries.length - MAX_ENTRIES + 1), entry]
    : [...entries, entry]);
};

const summarize = (raw) => {
  if (typeof raw !== 'string') return { label: typeof raw, detail: raw };
  try {
    const parsed = JSON.parse(raw);
    // v2 signaling keys frames on messageType; older frames use direction/command.
    const label =
      parsed.messageType ||
      parsed.direction ||
      parsed.command ||
      (parsed.sdp ? `sdp ${parsed.sdp.type || ''}`.trim() : null) ||
      (parsed.iceCandidates || parsed.candidate ? 'iceCandidate' : null) ||
      (parsed.statusCode ? `status ${parsed.statusCode}` : null) ||
      'message';
    return { label, detail: parsed };
  } catch {
    return { label: 'text', detail: raw.length > 2000 ? `${raw.slice(0, 2000)}...` : raw };
  }
};

/** Wraps send() and listens for lifecycle events. Returns the same socket. */
export const instrumentWebSocket = (websocket, role) => {
  if (!websocket || websocket.__wzInstrumented) return websocket;
  websocket.__wzInstrumented = true;

  const originalSend = websocket.send.bind(websocket);
  websocket.send = (data) => {
    // Logging must never stop a frame going out.
    try {
      const { label, detail } = summarize(data);
      logEvent('out', 'ws', role + ' → ' + label, detail);
    } catch {
      /* ignored on purpose */
    }
    return originalSend(data);
  };

  websocket.addEventListener('message', (event) => {
    const { label, detail } = summarize(event.data);
    logEvent('in', 'ws', `${role} \u2190 ${label}`, detail);
  });
  websocket.addEventListener('open', () => logEvent('info', 'ws', `${role} socket open`, websocket.url));
  websocket.addEventListener('close', (e) =>
    logEvent('info', 'ws', `${role} socket closed`, { code: e.code, reason: e.reason || null }));
  websocket.addEventListener('error', () => (isWebSocketClosing(websocket)
    ? logEvent('info', 'ws', `${role} socket error while closing`, CLOSING_EXPLANATION)
    : logEvent('error', 'ws', `${role} socket error`, SIGNALING_ERROR_EXPLANATION)));

  return websocket;
};

/*
 * With a frame in flight at close, the browser fails the socket with "Data frame received
 * after close" and fires an error event. The stop paths mark deliberate teardowns so that
 * event is not reported as a failure.
 */
const CLOSING = '__wzClosingDeliberately';

export const CLOSING_EXPLANATION =
  'The server sent a frame after the socket was closed. Expected while shutting down.';

// A WebSocket error event carries no detail by spec, so a page cannot probe its network.
export const SIGNALING_ERROR_EXPLANATION =
  'The browser does not say why. Check the server address and port, its certificate, and that '
  + 'the Engine is running.';

export const markWebSocketClosing = (websocket) => {
  if (websocket) websocket[CLOSING] = true;
};

export const isWebSocketClosing = (websocket) => Boolean(websocket && websocket[CLOSING]);

/**
 * User-facing text for a signaling failure. Accepts a socket Event (no detail), an Error, or
 * an Engine status object.
 */
export const describeSignalingError = (error) => {
  if (error == null) return SIGNALING_ERROR_EXPLANATION;
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string' && error.message !== '') return error.message;
  return SIGNALING_ERROR_EXPLANATION;
};

/** Records ICE and connection-state transitions without changing behavior. */
export const instrumentPeerConnection = (peerConnection, role) => {
  if (!peerConnection || peerConnection.__wzInstrumented) return peerConnection;
  peerConnection.__wzInstrumented = true;

  registerPeerConnection(role, peerConnection);

  peerConnection.addEventListener('icecandidate', (event) => {
    if (event.candidate) {
      logEvent('out', 'ice', `${role} local candidate`, {
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
      });
    } else {
      logEvent('info', 'ice', `${role} end of candidates`, null);
    }
  });
  peerConnection.addEventListener('iceconnectionstatechange', () =>
    logEvent('info', 'pc', `${role} ICE ${peerConnection.iceConnectionState}`, null));
  peerConnection.addEventListener('connectionstatechange', () =>
    logEvent('info', 'pc', `${role} connection ${peerConnection.connectionState}`, null));
  peerConnection.addEventListener('icegatheringstatechange', () =>
    logEvent('info', 'pc', `${role} gathering ${peerConnection.iceGatheringState}`, null));

  return peerConnection;
};

/** The one formatter for an HTTP response line; loggedFetch records every exchange with it. */
export const logHttp = (method, url, status, detail) =>
  logEvent(
    status >= 200 && status < 300 ? 'in' : 'error',
    'http',
    `${method} ${shortUrl(url)}${status ? ` \u2192 ${status}` : ''}`,
    detail ?? null
  );

/** Path and query only; the origin repeats on every row. */
const shortUrl = (url) => {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.pathname + parsed.search;
  } catch {
    return String(url);
  }
};

/**
 * fetch, with the exchange recorded; WHIP and WHEP negotiate entirely over HTTP. The response
 * is cloned before reading so logging never consumes the caller's body.
 */
export const loggedFetch = async (url, init = {}) => {
  const method = String(init.method || 'GET').toUpperCase();
  const label = `${method} ${shortUrl(url)}`;

  logEvent('out', 'http', label, typeof init.body === 'string' ? init.body : null);

  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    logEvent('error', 'http', `${label} failed`, error?.message ?? String(error));
    throw error;
  }

  let body = null;
  try {
    body = await response.clone().text();
  } catch {
    // A response that cannot be cloned is still worth recording by status alone.
  }

  logHttp(method, url, response.status, body || null);

  return response;
};

/**
 * Logs when a sent or received track stops carrying media. The peer connection stays
 * "connected" when the browser mutes a capture track (OS reclaimed the device) or ends it
 * (device gone). Page visibility is logged too, since a background window is the usual cause.
 */
export const instrumentTrack = (track, role, direction) => {
  if (!track || track.__wzInstrumented) return null;
  track.__wzInstrumented = true;

  const describe = () => ({
    kind: track.kind,
    label: track.label,
    readyState: track.readyState,
    muted: track.muted,
    documentVisibility: typeof document === 'undefined' ? null : document.visibilityState,
  });

  const listeners = {
    mute: () => logEvent('error', 'pc', `${role} ${direction} ${track.kind} track muted by the browser`, describe()),
    unmute: () => logEvent('info', 'pc', `${role} ${direction} ${track.kind} track resumed`, describe()),
    ended: () => logEvent('error', 'pc', `${role} ${direction} ${track.kind} track ended`, describe()),
  };
  for (const [type, fn] of Object.entries(listeners)) track.addEventListener(type, fn);

  // The track outlives the session (the camera stays open), so the session's stop removes
  // these; otherwise a later camera switch logs against a session that no longer exists.
  return {
    stop: () => {
      for (const [type, fn] of Object.entries(listeners)) track.removeEventListener(type, fn);
      delete track.__wzInstrumented;
    },
  };
};
