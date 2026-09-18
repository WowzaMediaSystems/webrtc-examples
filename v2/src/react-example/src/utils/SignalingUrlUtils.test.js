import { describe, expect, it } from 'vitest';

import {
  HTTP, SIGNALING_PATH, WSS,
  convertTo, isHostless, mismatched, transportOf,
} from './SignalingUrlUtils';

describe('isHostless', () => {
  it('counts an empty field and a bare scheme as nothing typed', () => {
    expect(isHostless('')).toBe(true);
    expect(isHostless('   ')).toBe(true);
    expect(isHostless('wss://')).toBe(true);
    expect(isHostless('https://')).toBe(true);
    expect(isHostless(`wss://${SIGNALING_PATH}`)).toBe(true);
    expect(isHostless(null)).toBe(true);
  });

  it('counts one typed character as typed', () => {
    expect(isHostless(`wss://e${SIGNALING_PATH}`)).toBe(false);
    expect(isHostless('https://engine.example')).toBe(false);
  });
});

describe('transportOf', () => {
  it('reads the transport off the scheme', () => {
    expect(transportOf('wss://engine.example/webrtc-session.json')).toBe(WSS);
    expect(transportOf('ws://engine.example/webrtc-session.json')).toBe(WSS);
    expect(transportOf('https://engine.example:8443')).toBe(HTTP);
    expect(transportOf('http://localhost:1935')).toBe(HTTP);
  });

  /*
   * Null rather than a guess. A proxy on some other scheme should not be nagged at, and a
   * half-typed fragment is not a mismatch.
   */
  it('says nothing when it cannot tell', () => {
    expect(transportOf('')).toBeNull();
    expect(transportOf('engine.example')).toBeNull();
    expect(transportOf('srt://engine.example')).toBeNull();
    expect(transportOf(null)).toBeNull();
  });
});

describe('mismatched', () => {
  it('flags a real URL written for the other transport', () => {
    expect(mismatched('wss://e/webrtc-session.json', HTTP)).toBe(true);
    expect(mismatched('https://e:8443', WSS)).toBe(true);
  });

  it('does not flag a matching URL', () => {
    expect(mismatched('wss://e/webrtc-session.json', WSS)).toBe(false);
    expect(mismatched('https://e:8443', HTTP)).toBe(false);
  });

  // A bare scheme is not a mismatch; it is the field waiting to be filled in.
  it('does not flag a bare scheme or an unreadable value', () => {
    expect(mismatched('', WSS)).toBe(false);
    expect(mismatched('https://', WSS)).toBe(false);
    expect(mismatched(`wss://${SIGNALING_PATH}`, HTTP)).toBe(false);
    expect(mismatched('engine.example', WSS)).toBe(false);
  });
});

describe('convertTo', () => {
  it('keeps the host and port, and rewrites only the scheme and path', () => {
    expect(convertTo('wss://engine.example:8443/webrtc-session.json', HTTP))
      .toBe('https://engine.example:8443');
    expect(convertTo('https://engine.example:8443', WSS))
      .toBe('wss://engine.example:8443/webrtc-session.json');
  });

  it('round trips without losing the port', () => {
    const start = 'wss://engine.example:8443/webrtc-session.json';
    expect(convertTo(convertTo(start, HTTP), WSS)).toBe(start);
  });

  // Carrying the host across must not quietly carry the session onto a different footing.
  it('keeps the security level rather than upgrading or downgrading it', () => {
    expect(convertTo('ws://localhost:8080/webrtc-session.json', HTTP))
      .toBe('http://localhost:8080');
    expect(convertTo('http://localhost:1935', WSS))
      .toBe('ws://localhost:1935/webrtc-session.json');
  });

  it('drops a path that the other transport cannot use', () => {
    // The WHIP and WHEP request path is built from the application and stream, so the
    // origin is all that can be carried.
    expect(convertTo('wss://engine.example/webrtc-session.json', HTTP))
      .toBe('https://engine.example');
    expect(convertTo('https://engine.example/webrtc/myStream/whep', WSS))
      .toBe('wss://engine.example/webrtc-session.json');
  });

  // An empty field shows its placeholder, which is the hint for the transport now chosen.
  it('gives back an empty field when there is no host to keep', () => {
    expect(convertTo('', HTTP)).toBe('');
    expect(convertTo('wss://', HTTP)).toBe('');
    expect(convertTo('wss:///webrtc-session.json', HTTP)).toBe('');
    expect(convertTo('https://', WSS)).toBe('');
    expect(convertTo('not a url', WSS)).toBe('');
    expect(convertTo(null, WSS)).toBe('');
  });
});
