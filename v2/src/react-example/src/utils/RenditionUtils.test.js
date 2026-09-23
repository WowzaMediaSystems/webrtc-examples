import { describe, it, expect } from 'vitest';
import { baseStreamName, renditionsFor, signalingLookupUrl } from './RenditionUtils';

// The shape the Engine actually returned for a simulcast publish, plus unrelated streams.
const ENGINE = ['myStream', 'diag123', 'diag123_m', 'diag123_l', 'test'];

describe('baseStreamName', () => {
  it('strips a rendition suffix when the base is itself live', () => {
    expect(baseStreamName('diag123_m', ENGINE)).toBe('diag123');
  });

  it('leaves a name alone when nothing was published under the stripped form', () => {
    expect(baseStreamName('camera_north', ENGINE)).toBe('camera_north');
  });

  it('leaves a bare name alone', () => {
    expect(baseStreamName('diag123', ENGINE)).toBe('diag123');
    expect(baseStreamName('myStream', ENGINE)).toBe('myStream');
  });

  it('survives an empty or missing list', () => {
    expect(baseStreamName('diag123_m', null)).toBe('diag123_m');
    expect(baseStreamName('', ENGINE)).toBe('');
  });
});

describe('renditionsFor', () => {
  it('lists the source first, then each rendition', () => {
    expect(renditionsFor('diag123', ENGINE)).toEqual([
      { value: 'diag123', label: 'Source (highest rendition)' },
      { value: 'diag123_m', label: 'Rendition "m"' },
      { value: 'diag123_l', label: 'Rendition "l"' },
    ]);
  });

  it('orders default-ladder rids highest first, then any others alphabetically', () => {
    const list = ['s', 's_l', 's_zz', 's_h', 's_aa', 's_m'];
    expect(renditionsFor('s', list).map((r) => r.value))
      .toEqual(['s', 's_h', 's_m', 's_l', 's_aa', 's_zz']);
  });

  it('gives the same list when asked from one of the renditions', () => {
    expect(renditionsFor('diag123_l', ENGINE)).toEqual(renditionsFor('diag123', ENGINE));
  });

  // One entry is not a choice, so there is nothing to draw.
  it('returns nothing for a stream published without simulcast', () => {
    expect(renditionsFor('myStream', ENGINE)).toEqual([]);
  });

  it('returns nothing for a stream that is not live', () => {
    expect(renditionsFor('absent', ENGINE)).toEqual([]);
    expect(renditionsFor('', ENGINE)).toEqual([]);
  });

  it('survives a missing list', () => {
    expect(renditionsFor('diag123', null)).toEqual([]);
  });
});

describe('signalingLookupUrl', () => {
  it('passes a socket URL through unchanged', () => {
    expect(signalingLookupUrl('wss://engine.example/webrtc-session.json'))
      .toBe('wss://engine.example/webrtc-session.json');
    expect(signalingLookupUrl('ws://engine.example:8080/webrtc-session.json'))
      .toBe('ws://engine.example:8080/webrtc-session.json');
  });

  // Under WHEP the field holds an origin; the same host serves the signaling endpoint.
  it('derives a socket URL from a WHIP/WHEP origin', () => {
    expect(signalingLookupUrl('https://engine.example'))
      .toBe('wss://engine.example/webrtc-session.json');
    expect(signalingLookupUrl('https://engine.example:8443'))
      .toBe('wss://engine.example:8443/webrtc-session.json');
    expect(signalingLookupUrl('http://localhost:1935'))
      .toBe('ws://localhost:1935/webrtc-session.json');
  });

  it('ignores any path on the origin, because the endpoint is fixed', () => {
    expect(signalingLookupUrl('https://engine.example/webrtc/myStream/whep'))
      .toBe('wss://engine.example/webrtc-session.json');
  });

  it('returns null when there is nothing to derive from', () => {
    expect(signalingLookupUrl('')).toBeNull();
    expect(signalingLookupUrl(null)).toBeNull();
    expect(signalingLookupUrl('not a url')).toBeNull();
    expect(signalingLookupUrl('ftp://engine.example')).toBeNull();
  });

  // new URL('wss:///webrtc-session.json') reads the path segment as the host.
  it('refuses a URL with no host', () => {
    expect(signalingLookupUrl('wss:///webrtc-session.json')).toBeNull();
    expect(signalingLookupUrl('wss://')).toBeNull();
    expect(signalingLookupUrl('https://')).toBeNull();
  });
});
