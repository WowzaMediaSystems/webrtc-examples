/*
 * A small append-only ring buffer of everything that passes between this page and the
 * Engine: signaling over the WebSocket, the WHIP/WHEP HTTP exchanges, ICE candidates and
 * peer-connection state changes.
 *
 * It exists so the debug panel can show the conversation without every call site having
 * to know a panel exists. Instrumentation attaches at the two places a WebSocket and a
 * RTCPeerConnection are created, so the signaling code itself stays readable.
 */

import { registerPeerConnection } from './connections';

const MAX_ENTRIES = 500;

let entries = [];
let seq = 0;
const listeners = new Set();

const emit = () => {
  for (const fn of listeners) fn(entries);
};

export const subscribe = (fn) => {
  listeners.add(fn);
  fn(entries);
  return () => listeners.delete(fn);
};

export const clearLog = () => {
  entries = [];
  emit();
};

export const getEntries = () => entries;

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
  entries = entries.length >= MAX_ENTRIES
    ? [...entries.slice(entries.length - MAX_ENTRIES + 1), entry]
    : [...entries, entry];
  emit();
};

const summarize = (raw) => {
  if (typeof raw !== "string") return { label: typeof raw, detail: raw };
  try {
    const parsed = JSON.parse(raw);
    // The v2 signaling protocol keys every frame on messageType (OFFER, ANSWER,
    // CANDIDATE, ICE_RESTART, CLOSE, GET_AVAILABLE_STREAMS). Older frames used
    // direction/command, so both are read, newest first.
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
    return { label: "text", detail: raw.length > 2000 ? `${raw.slice(0, 2000)}...` : raw };
  }
};

/**
 * Wraps send() and listens for the lifecycle events. Returns the same socket so the
 * caller can keep using it unchanged.
 */
export const instrumentWebSocket = (websocket, role) => {
  if (!websocket || websocket.__wzInstrumented) return websocket;
  websocket.__wzInstrumented = true;

  const originalSend = websocket.send.bind(websocket);
  websocket.send = (data) => {
    // Logging must never be able to stop a frame going out. Anything that throws in
    // here is a diagnostics bug, not a reason to break signalling.
    try {
      const { label, detail } = summarize(data);
      logEvent('out', 'ws', role + ' → ' + label, detail);
    } catch {
      /* ignored on purpose */
    }
    return originalSend(data);
  };

  websocket.addEventListener("message", (event) => {
    const { label, detail } = summarize(event.data);
    logEvent("in", "ws", `${role} \u2190 ${label}`, detail);
  });
  websocket.addEventListener("open", () => logEvent("info", "ws", `${role} socket open`, websocket.url));
  websocket.addEventListener("close", (e) =>
    logEvent("info", "ws", `${role} socket closed`, { code: e.code, reason: e.reason || null }));
  websocket.addEventListener("error", () => (isWebSocketClosing(websocket)
    ? logEvent("info", "ws", `${role} socket error while closing`, CLOSING_EXPLANATION)
    : logEvent("error", "ws", `${role} socket error`, SIGNALING_ERROR_EXPLANATION)));

  return websocket;
};

/*
 * Closing a WebSocket does not always end quietly. The Engine can have a frame in flight when
 * we close, and the browser then fails the connection with "Data frame received after close"
 * and dispatches an error event. Nothing is wrong: the session is over and that is why the
 * socket was closed.
 *
 * Marked by the stop paths, which are the only code that knows a teardown was deliberate, and
 * read here and by the signalling code so the same event is not reported as a failure.
 */
const CLOSING = '__wzClosingDeliberately';

export const CLOSING_EXPLANATION =
  'The server sent a frame after the socket was closed. Expected while shutting down.';

/*
 * A WebSocket error event carries no detail at all. The specification withholds it on purpose,
 * so that a page cannot use a socket to probe the network it is running on. Reading .message
 * off it is how the panel came to say "Websocket Error: undefined".
 */
export const SIGNALING_ERROR_EXPLANATION =
  'The browser does not say why. Check the server address and port, its certificate, and that '
  + 'the Engine is running.';

export const markWebSocketClosing = (websocket) => {
  if (websocket) websocket[CLOSING] = true;
};

export const isWebSocketClosing = (websocket) => Boolean(websocket && websocket[CLOSING]);

/**
 * What to show a person about a signalling failure.
 *
 * Three shapes arrive here: an Event from the socket, which carries nothing; an Error from a
 * throw; and a plain object carrying a status description from the Engine.
 */
export const describeSignalingError = (error) => {
  if (error == null) return SIGNALING_ERROR_EXPLANATION;
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string' && error.message !== '') return error.message;
  return SIGNALING_ERROR_EXPLANATION;
};

/** Records ICE and connection-state transitions without changing behaviour. */
export const instrumentPeerConnection = (peerConnection, role) => {
  if (!peerConnection || peerConnection.__wzInstrumented) return peerConnection;
  peerConnection.__wzInstrumented = true;

  registerPeerConnection(role, peerConnection);

  peerConnection.addEventListener("icecandidate", (event) => {
    if (event.candidate) {
      logEvent("out", "ice", `${role} local candidate`, {
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
      });
    } else {
      logEvent("info", "ice", `${role} end of candidates`, null);
    }
  });
  peerConnection.addEventListener("iceconnectionstatechange", () =>
    logEvent("info", "pc", `${role} ICE ${peerConnection.iceConnectionState}`, null));
  peerConnection.addEventListener("connectionstatechange", () =>
    logEvent("info", "pc", `${role} connection ${peerConnection.connectionState}`, null));
  peerConnection.addEventListener("icegatheringstatechange", () =>
    logEvent("info", "pc", `${role} gathering ${peerConnection.iceGatheringState}`, null));

  return peerConnection;
};

/** For the WHIP/WHEP HTTP exchanges, which do not go through the socket. */
export const logHttp = (method, url, status, detail) =>
  logEvent(
    status >= 400 ? "error" : "info",
    "http",
    `${method} ${url}${status ? ` \u2192 ${status}` : ""}`,
    detail ?? null
  );

/** The path and query of a URL, because the origin repeats on every line and rows are narrow. */
const shortUrl = (url) => {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.pathname + parsed.search;
  } catch {
    return String(url);
  }
};

/**
 * fetch, with the exchange recorded.
 *
 * WHIP and WHEP carry the whole negotiation over HTTP, so without this the log has nothing
 * to show for a session on that path. logHttp above existed and was unit tested, but was
 * never called from either flow, which left the WHIP/WHEP channel permanently empty.
 *
 * The response is cloned before its body is read, so logging can never consume what the
 * caller is about to parse.
 */
export const loggedFetch = async (url, init = {}) => {
  const method = String(init.method || "GET").toUpperCase();
  const label = `${method} ${shortUrl(url)}`;

  logEvent("out", "http", label, typeof init.body === "string" ? init.body : null);

  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    logEvent("error", "http", `${label} failed`, error?.message ?? String(error));
    throw error;
  }

  let body = null;
  try {
    body = await response.clone().text();
  } catch {
    // A response that cannot be cloned is still worth recording by status alone.
  }

  logEvent(
    response.ok ? "in" : "error",
    "http",
    `${label} → ${response.status}`,
    body || null
  );

  return response;
};

/**
 * Watches a track that is being sent or received, and says when it stops carrying media.
 *
 * A publish that quietly stops is the hardest kind to diagnose, because the peer connection
 * stays "connected" and the page still says LIVE: the transport is fine, it is the source
 * that went away. The browser mutes a capture track when the operating system takes the
 * device back, and ends it when the device is gone for good, and neither event shows up
 * anywhere unless something is listening.
 *
 * So this turns an invisible failure into a line in the log, with the page's own visibility
 * beside it, because the usual cause is the window no longer being the one in front.
 */
export const instrumentTrack = (track, role, direction) => {
  if (!track || track.__wzInstrumented) return track;
  track.__wzInstrumented = true;

  const describe = () => ({
    kind: track.kind,
    label: track.label,
    readyState: track.readyState,
    muted: track.muted,
    documentVisibility: typeof document === 'undefined' ? null : document.visibilityState,
  });

  track.addEventListener('mute', () =>
    logEvent('error', 'pc', `${role} ${direction} ${track.kind} track muted by the browser`, describe()));

  track.addEventListener('unmute', () =>
    logEvent('info', 'pc', `${role} ${direction} ${track.kind} track resumed`, describe()));

  track.addEventListener('ended', () =>
    logEvent('error', 'pc', `${role} ${direction} ${track.kind} track ended`, describe()));

  return track;
};
