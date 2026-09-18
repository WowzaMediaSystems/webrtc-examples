import { beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetRecent, forgetValue, readRecent, rememberValue } from './RecentValues';

describe('recent values', () => {
  beforeEach(() => window.localStorage.clear());

  it('offers nothing before anything has been used', () => {
    expect(readRecent('streamName')).toEqual([]);
  });

  it('keeps the most recent first', () => {
    rememberValue('streamName', 'one');
    rememberValue('streamName', 'two');
    expect(readRecent('streamName')).toEqual(['two', 'one']);
  });

  it('moves a repeat to the front rather than duplicating it', () => {
    ['a', 'b', 'a'].forEach((v) => rememberValue('streamName', v));
    expect(readRecent('streamName')).toEqual(['a', 'b']);
  });

  it('caps the list so the dropdown stays usable', () => {
    for (let i = 0; i < 20; i += 1) rememberValue('streamName', `s${i}`);
    expect(readRecent('streamName')).toHaveLength(8);
    expect(readRecent('streamName')[0]).toBe('s19');
  });

  it('trims, and ignores a blank', () => {
    rememberValue('streamName', '  spaced  ');
    rememberValue('streamName', '   ');
    expect(readRecent('streamName')).toEqual(['spaced']);
  });

  it('keeps each field separate', () => {
    rememberValue('streamName', 'stream');
    rememberValue('applicationName', 'app');
    expect(readRecent('streamName')).toEqual(['stream']);
    expect(readRecent('applicationName')).toEqual(['app']);
  });

  it('forgets one value without touching the rest', () => {
    ['a', 'b', 'c'].forEach((v) => rememberValue('streamName', v));
    expect(forgetValue('streamName', 'b')).toEqual(['c', 'a']);
    expect(readRecent('streamName')).toEqual(['c', 'a']);
  });

  it('forgets on request', () => {
    rememberValue('streamName', 'gone');
    forgetRecent('streamName');
    expect(readRecent('streamName')).toEqual([]);
  });

  // A private window throws on every storage call; suggestions are a convenience, not a
  // feature worth breaking the page for.
  it('survives storage being unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readRecent('streamName')).toEqual([]);
    expect(() => rememberValue('streamName', 'x')).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});

/*
 * A wss:// URL and an https:// origin cannot be used in each other's place, so offering them
 * in one list offers values that cannot work under the transport selected.
 */
describe('signalling URLs per transport', () => {
  beforeEach(() => window.localStorage.clear());

  it('keeps the two transports apart', () => {
    rememberValue('signalingURL', 'wss://engine.example/webrtc-session.json', 'wss');
    rememberValue('signalingURL', 'https://engine.example', 'http');

    expect(readRecent('signalingURL', 'wss')).toEqual(['wss://engine.example/webrtc-session.json']);
    expect(readRecent('signalingURL', 'http')).toEqual(['https://engine.example']);
  });

  it('forgets within one transport only', () => {
    rememberValue('signalingURL', 'wss://a/webrtc-session.json', 'wss');
    rememberValue('signalingURL', 'https://a', 'http');

    forgetValue('signalingURL', 'wss://a/webrtc-session.json', 'wss');
    expect(readRecent('signalingURL', 'wss')).toEqual([]);
    expect(readRecent('signalingURL', 'http')).toEqual(['https://a']);
  });
});

/*
 * Everything remembered before the split lived under one key. Dropping it would empty the
 * panel's memory, which is the opposite of what a memory is for, so it is sorted into the
 * two lists once. The module remembers having done it, so each case re-imports.
 */
describe('migrating what was remembered before the split', () => {
  const freshImport = async () => {
    vi.resetModules();
    return import('./RecentValues');
  };

  beforeEach(() => window.localStorage.clear());

  it('sorts the old list by the transport each URL is written for', async () => {
    window.localStorage.setItem('wz.recent.signalingURL', JSON.stringify([
      'wss://engine.example/webrtc-session.json',
      'https://engine.example:8443',
      'ws://localhost:8080/webrtc-session.json',
    ]));

    const { readRecent: read } = await freshImport();
    expect(read('signalingURL', 'wss')).toEqual([
      'wss://engine.example/webrtc-session.json',
      'ws://localhost:8080/webrtc-session.json',
    ]);
    expect(read('signalingURL', 'http')).toEqual(['https://engine.example:8443']);
    expect(window.localStorage.getItem('wz.recent.signalingURL')).toBeNull();
  });

  it('drops what cannot be read as either transport rather than guessing', async () => {
    window.localStorage.setItem('wz.recent.signalingURL',
      JSON.stringify(['ftp://engine.example', 'not a url']));

    const { readRecent: read } = await freshImport();
    expect(read('signalingURL', 'wss')).toEqual([]);
    expect(read('signalingURL', 'http')).toEqual([]);
  });

  it('leaves the other fields alone', async () => {
    window.localStorage.setItem('wz.recent.streamName', JSON.stringify(['keepMe']));

    const { readRecent: read } = await freshImport();
    expect(read('streamName')).toEqual(['keepMe']);
  });
});
