import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getPeerConnection, registerPeerConnection, releasePeerConnection, subscribePeerConnection,
} from './connections';

// Like Chromium, this stand-in does NOT dispatch connectionstatechange on close().
const fakeConnection = () => {
  const listeners = [];
  return {
    connectionState: 'connected',
    addEventListener: (type, fn) => { if (type === 'connectionstatechange') listeners.push(fn); },
    close() { this.connectionState = 'closed'; },
    /** For the cases that model a state the browser does report. */
    transitionTo(state) {
      this.connectionState = state;
      listeners.forEach((fn) => fn());
    },
  };
};

describe('the live connection per role', () => {
  beforeEach(() => {
    releasePeerConnection('publish');
    releasePeerConnection('play');
  });

  it('hands a new subscriber whatever is current', () => {
    const pc = fakeConnection();
    registerPeerConnection('publish', pc);

    const seen = vi.fn();
    subscribePeerConnection('publish', seen);
    expect(seen).toHaveBeenCalledWith(pc);
    expect(getPeerConnection('publish')).toBe(pc);
  });

  it('tells subscribers when a state the browser reports ends the session', () => {
    const pc = fakeConnection();
    registerPeerConnection('publish', pc);
    const seen = vi.fn();
    subscribePeerConnection('publish', seen);

    pc.transitionTo('failed');
    expect(seen).toHaveBeenLastCalledWith(null);
  });

  // The case the event does not cover.
  it('tells subscribers when a connection is closed without an event', () => {
    const pc = fakeConnection();
    registerPeerConnection('publish', pc);
    const seen = vi.fn();
    subscribePeerConnection('publish', seen);

    pc.close();
    expect(seen).toHaveBeenLastCalledWith(pc);

    releasePeerConnection('publish');
    expect(seen).toHaveBeenLastCalledWith(null);
    expect(getPeerConnection('publish')).toBeNull();
  });

  it('does not disturb anyone when there is nothing to release', () => {
    const seen = vi.fn();
    subscribePeerConnection('publish', seen);
    seen.mockClear();

    releasePeerConnection('publish');
    expect(seen).not.toHaveBeenCalled();
  });

  it('keeps the two roles apart', () => {
    const publish = fakeConnection();
    const play = fakeConnection();
    registerPeerConnection('publish', publish);
    registerPeerConnection('play', play);

    releasePeerConnection('publish');
    expect(getPeerConnection('publish')).toBeNull();
    expect(getPeerConnection('play')).toBe(play);
  });
});

// An abandoned attempt timing out after a newer session started must not release the live one.
describe('releasing the connection you meant', () => {
  beforeEach(() => {
    releasePeerConnection('publish');
    releasePeerConnection('play');
  });

  it('ignores a release naming a connection that is no longer current', () => {
    const abandoned = fakeConnection();
    const live = fakeConnection();
    registerPeerConnection('publish', abandoned);
    registerPeerConnection('publish', live);

    releasePeerConnection('publish', abandoned);
    expect(getPeerConnection('publish')).toBe(live);
  });

  it('releases when the named connection is the current one', () => {
    const live = fakeConnection();
    registerPeerConnection('publish', live);

    releasePeerConnection('publish', live);
    expect(getPeerConnection('publish')).toBeNull();
  });

  it('still releases whatever is current when no connection is named', () => {
    registerPeerConnection('publish', fakeConnection());
    releasePeerConnection('publish');
    expect(getPeerConnection('publish')).toBeNull();
  });
});
