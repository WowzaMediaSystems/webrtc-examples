import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CLOSING_EXPLANATION, SIGNALING_ERROR_EXPLANATION, clearLog, describeSignalingError, getEntries,
  instrumentPeerConnection, instrumentWebSocket, isWebSocketClosing, logEvent, logHttp,
  markWebSocketClosing, subscribe,
} from './signalLog';

// A minimal EventTarget-based stand-in. Real WebSocket/RTCPeerConnection are not in jsdom.
class FakeSocket extends EventTarget {
  constructor() { super(); this.url = 'wss://engine.example/webrtc-session.json'; this.sent = []; }
  send(data) { this.sent.push(data); }
}

beforeEach(() => clearLog());

describe('log buffer', () => {
  it('appends in order and notifies subscribers', () => {
    const seen = vi.fn();
    const off = subscribe(seen);
    logEvent('out', 'ws', 'first');
    logEvent('in', 'ws', 'second');
    expect(getEntries().map((e) => e.label)).toEqual(['first', 'second']);
    expect(seen).toHaveBeenCalledTimes(3); // initial + two events
    off();
  });

  it('stops notifying after unsubscribe', () => {
    const seen = vi.fn();
    subscribe(seen)();
    logEvent('info', 'pc', 'ignored');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('caps the buffer and drops the oldest', () => {
    for (let i = 0; i < 520; i += 1) logEvent('info', 'pc', `e${i}`);
    const entries = getEntries();
    expect(entries.length).toBe(500);
    expect(entries[0].label).toBe('e20');
    expect(entries[entries.length - 1].label).toBe('e519');
  });
});

describe('WebSocket instrumentation', () => {
  it('still delivers the payload to the real send', () => {
    const ws = instrumentWebSocket(new FakeSocket(), 'play');
    ws.send('{"direction":"play"}');
    expect(ws.sent).toEqual(['{"direction":"play"}']);
  });

  it('labels an outbound frame by its direction field', () => {
    const ws = instrumentWebSocket(new FakeSocket(), 'play');
    ws.send(JSON.stringify({ direction: 'play', command: 'sendOffer' }));
    expect(getEntries().at(-1).label).toContain('play');
    expect(getEntries().at(-1).direction).toBe('out');
  });

  it('records inbound messages', () => {
    const ws = instrumentWebSocket(new FakeSocket(), 'play');
    ws.dispatchEvent(Object.assign(new Event('message'), { data: '{"status":200}' }));
    const last = getEntries().at(-1);
    expect(last.direction).toBe('in');
    expect(last.detail).toEqual({ status: 200 });
  });

  it('keeps non-JSON payloads as text rather than throwing', () => {
    const ws = instrumentWebSocket(new FakeSocket(), 'play');
    ws.send('not json at all');
    expect(getEntries().at(-1).detail).toBe('not json at all');
  });

  it('does not double-wrap the same socket', () => {
    const ws = new FakeSocket();
    instrumentWebSocket(ws, 'play');
    instrumentWebSocket(ws, 'play');
    ws.send('x');
    expect(getEntries().filter((e) => e.channel === 'ws').length).toBe(1);
  });
});

describe('peer connection instrumentation', () => {
  it('records state transitions', () => {
    const pc = new EventTarget();
    pc.iceConnectionState = 'checking';
    pc.connectionState = 'connecting';
    instrumentPeerConnection(pc, 'publish');
    pc.dispatchEvent(new Event('iceconnectionstatechange'));
    expect(getEntries().at(-1).label).toBe('publish ICE checking');
  });

  it('distinguishes a candidate from end-of-candidates', () => {
    const pc = new EventTarget();
    instrumentPeerConnection(pc, 'publish');
    pc.dispatchEvent(Object.assign(new Event('icecandidate'), {
      candidate: { candidate: 'candidate:1 1 udp', sdpMid: '0' },
    }));
    expect(getEntries().at(-1).label).toContain('local candidate');
    pc.dispatchEvent(Object.assign(new Event('icecandidate'), { candidate: null }));
    expect(getEntries().at(-1).label).toContain('end of candidates');
  });

  it('tolerates a null connection', () => {
    expect(() => instrumentPeerConnection(null, 'play')).not.toThrow();
    expect(() => instrumentWebSocket(null, 'play')).not.toThrow();
  });
});

describe('HTTP logging', () => {
  it('marks 4xx and 5xx as errors', () => {
    logHttp('POST', '/whip', 201);
    expect(getEntries().at(-1).direction).toBe('in');
    logHttp('POST', '/whip', 503);
    expect(getEntries().at(-1).direction).toBe('error');
  });
});
describe('v2 protocol labelling', () => {
  // The live Engine keys every frame on messageType.
  it('labels an outbound frame by its messageType', () => {
    const ws = instrumentWebSocket(new FakeSocket(), 'play');
    ws.send(JSON.stringify({ messageType: 'OFFER', action: 'VIEW', streamName: 'myStream' }));
    expect(getEntries().at(-1).label).toBe('play \u2192 OFFER');
  });

  it('labels an inbound frame by its messageType', () => {
    const ws = instrumentWebSocket(new FakeSocket(), 'play');
    ws.dispatchEvent(Object.assign(new Event('message'), {
      data: JSON.stringify({ messageType: 'ANSWER', sdp: 'v=0...' }),
    }));
    expect(getEntries().at(-1).label).toBe('play \u2190 ANSWER');
  });

  it('falls back to a status code when there is no messageType', () => {
    const ws = instrumentWebSocket(new FakeSocket(), 'play');
    ws.dispatchEvent(Object.assign(new Event('message'), {
      data: JSON.stringify({ statusCode: 400, statusDescription: 'Missing required field' }),
    }));
    expect(getEntries().at(-1).label).toBe('play \u2190 status 400');
  });

  it('still reads the older direction field', () => {
    const ws = instrumentWebSocket(new FakeSocket(), 'publish');
    ws.send(JSON.stringify({ direction: 'publish', command: 'sendResponse' }));
    expect(getEntries().at(-1).label).toBe('publish \u2192 publish');
  });
});

// A deliberate close can still raise an error event ("Data frame received after close").
describe('a socket closed on purpose', () => {
  beforeEach(() => clearLog());

  it('is not marked until something marks it', () => {
    const socket = new FakeSocket();
    expect(isWebSocketClosing(socket)).toBe(false);
    markWebSocketClosing(socket);
    expect(isWebSocketClosing(socket)).toBe(true);
  });

  it('takes null without complaining, because a stop can run with no socket', () => {
    expect(() => markWebSocketClosing(null)).not.toThrow();
    expect(isWebSocketClosing(null)).toBe(false);
    expect(isWebSocketClosing(undefined)).toBe(false);
  });

  it('logs the error as a failure while the session is live', () => {
    const socket = instrumentWebSocket(new FakeSocket(), 'publish');
    socket.dispatchEvent(new Event('error'));

    const entry = getEntries().find((e) => e.label.includes('socket error'));
    expect(entry.direction).toBe('error');
    expect(entry.label).toBe('publish socket error');
  });

  it('logs it as an expected part of shutting down once it is closing', () => {
    const socket = instrumentWebSocket(new FakeSocket(), 'publish');
    markWebSocketClosing(socket);
    socket.dispatchEvent(new Event('error'));

    const entry = getEntries().find((e) => e.label.includes('socket error'));
    expect(entry.direction).toBe('info');
    expect(entry.label).toBe('publish socket error while closing');
    expect(entry.detail).toBe(CLOSING_EXPLANATION);
  });
});

// A WebSocket error event carries no detail by design.
describe('describing a signalling failure', () => {
  it('says something true about an event that carries nothing', () => {
    expect(describeSignalingError(new Event('error'))).toBe(SIGNALING_ERROR_EXPLANATION);
    expect(describeSignalingError(null)).toBe(SIGNALING_ERROR_EXPLANATION);
    expect(describeSignalingError({})).toBe(SIGNALING_ERROR_EXPLANATION);
    expect(describeSignalingError({ message: '' })).toBe(SIGNALING_ERROR_EXPLANATION);
  });

  it('never returns the word undefined', () => {
    [new Event('error'), null, undefined, {}, { message: undefined }]
      .forEach((error) => expect(describeSignalingError(error)).not.toContain('undefined'));
  });

  it('keeps what the Engine or a thrown error had to say', () => {
    expect(describeSignalingError(new Error('boom'))).toBe('boom');
    expect(describeSignalingError({ message: 'Stream not found' })).toBe('Stream not found');
    expect(describeSignalingError('plain words')).toBe('plain words');
  });
});
