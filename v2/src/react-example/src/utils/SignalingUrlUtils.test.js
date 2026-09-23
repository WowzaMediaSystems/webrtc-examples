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

  // Null rather than a guess: other schemes and half-typed fragments are not mismatches.
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

  // The security level carries over with the host.
  it('keeps the security level rather than upgrading or downgrading it', () => {
    expect(convertTo('ws://localhost:8080/webrtc-session.json', HTTP))
      .toBe('http://localhost:8080');
    expect(convertTo('http://localhost:1935', WSS))
      .toBe('ws://localhost:1935/webrtc-session.json');
  });

  it('drops the path each transport builds itself', () => {
    // The WHIP and WHEP request path is built from the application and stream.
    expect(convertTo('wss://engine.example/webrtc-session.json', HTTP))
      .toBe('https://engine.example');
    expect(convertTo('https://engine.example/webrtc/myStream/whep', WSS))
      .toBe('wss://engine.example/webrtc-session.json');
  });

  // An Engine behind a reverse proxy mounted under a path.
  it('keeps a path prefix in both directions', () => {
    expect(convertTo('https://proxy.example.com/wowza', WSS))
      .toBe('wss://proxy.example.com/wowza/webrtc-session.json');
    expect(convertTo('wss://proxy.example.com/wowza/webrtc-session.json', HTTP))
      .toBe('https://proxy.example.com/wowza');
    expect(convertTo('https://proxy.example.com/wowza/live/myStream/whip', WSS))
      .toBe('wss://proxy.example.com/wowza/webrtc-session.json');
    const start = 'https://proxy.example.com/wowza';
    expect(convertTo(convertTo(start, WSS), HTTP)).toBe(start);
  });

  it('leaves text it cannot read as a web URL unchanged', () => {
    expect(convertTo('not a url', WSS)).toBe('not a url');
    expect(convertTo('myserver:8443', HTTP)).toBe('myserver:8443');
    expect(convertTo('myserver.com/webrtc-session.json', HTTP)).toBe('myserver.com/webrtc-session.json');
  });

  // An empty field shows its placeholder, which is the hint for the transport now chosen.
  it('gives back an empty field when there is no host to keep', () => {
    expect(convertTo('', HTTP)).toBe('');
    expect(convertTo('wss://', HTTP)).toBe('');
    expect(convertTo('wss:///webrtc-session.json', HTTP)).toBe('');
    expect(convertTo('https://', WSS)).toBe('');
    expect(convertTo(null, WSS)).toBe('');
  });
});
