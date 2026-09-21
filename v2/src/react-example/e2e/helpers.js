import { expect } from '@playwright/test';

/*
 * Shared helpers for the end-to-end suites.
 *
 * Everything that talks to a real Engine goes through here, so the URL, application and
 * stream naming live in one place and the "no Engine available" skip is consistent.
 */

export const SIGNALING_URL =
  process.env.WOWZA_SIGNALING_URL || 'wss://localhost.localhost/webrtc-session.json';

export const APPLICATION = process.env.WOWZA_APPLICATION || 'webrtc';

/** A stream name unique to this run, so parallel or repeated runs never collide. */
export const uniqueStream = (prefix) =>
  `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** The WHIP/WHEP base derived from the signaling URL: wss://host/... -> https://host */
export const httpOrigin = () => {
  const u = new URL(SIGNALING_URL);
  return `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}`;
};

/**
 * Asks the Engine, over its own signaling socket, which streams are live.
 * Returns null when the Engine cannot be reached at all, which callers treat as "skip".
 */

/**
 * Asks the Engine, over its own signaling socket, which streams are live.
 * Returns null when the Engine cannot be reached at all, which callers treat as "skip".
 */
export const listStreams = async (page) =>
  page.evaluate(async ({ url, applicationName }) => {
    return await new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      let ws;
      try { ws = new WebSocket(url); } catch { return done(null); }
      const timer = setTimeout(() => { try { ws.close(); } catch { /* closing */ } done(null); }, 6000);
      ws.onopen = () => ws.send(JSON.stringify({ messageType: 'GET_AVAILABLE_STREAMS', applicationName }));
      ws.onmessage = (e) => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(e.data);
          done(Array.isArray(parsed.availableStreams) ? parsed.availableStreams.map((s) => s.streamName) : []);
        } catch { done([]); }
        try { ws.close(); } catch { /* closing */ }
      };
      ws.onerror = () => { clearTimeout(timer); done(null); };
      ws.onclose = () => { clearTimeout(timer); done(null); };
    });
  }, { url: SIGNALING_URL, applicationName: APPLICATION });

/** Skips the test when no Engine is reachable, with a message that says why. */
export const requireEngine = async (page, test) => {
  const streams = await listStreams(page);
  test.skip(streams === null, `No Engine reachable at ${SIGNALING_URL}. Set WOWZA_SIGNALING_URL to run this suite.`);
  return streams;
};

/**
 * Waits until the local camera preview actually has frames.
 *
 * Clicking Publish before getUserMedia resolves produces a connection with no media: it
 * reaches "connected" and reports an RTT, but there is no outbound RTP at all, so every
 * codec, bitrate and frame figure stays empty. That looks like an application bug and is
 * really a race in the test.
 */
/**
 * Switches the inspector to a tab. Fields outside the active tab stay mounted but hidden,
 * so they must be revealed before they can be clicked or typed into.
 */

/** Fails loudly on page errors so a silent exception cannot pass as success. */
export const failOnPageErrors = (page, errors) => {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
};
