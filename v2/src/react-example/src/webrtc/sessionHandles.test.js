import { describe, expect, it, vi } from 'vitest';

import { heldHandleCount, keepUntilStopped, releaseSessionHandles } from './sessionHandles';

const fakeConnection = () => ({});

describe('holding what a session opened', () => {
  it('hands the handle straight back, so it can wrap a call', () => {
    const handle = { stop: () => {} };
    expect(keepUntilStopped(fakeConnection(), handle)).toBe(handle);
  });

  it('takes both spellings, because both exist in this codebase', () => {
    const pc = fakeConnection();
    const stopped = vi.fn();
    const closed = vi.fn();
    const called = vi.fn();

    keepUntilStopped(pc, { stop: stopped });
    keepUntilStopped(pc, { close: closed });
    keepUntilStopped(pc, called);

    releaseSessionHandles(pc);
    expect(stopped).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
    expect(called).toHaveBeenCalledOnce();
  });

  // Anything layered on top comes off first.
  it('releases in reverse order', () => {
    const pc = fakeConnection();
    const order = [];
    keepUntilStopped(pc, () => order.push('first'));
    keepUntilStopped(pc, () => order.push('second'));

    releaseSessionHandles(pc);
    expect(order).toEqual(['second', 'first']);
  });

  /*
   * A teardown that gives up halfway leaves exactly the leaks it was called to collect, and
   * the throw would surface as a failure to stop rather than as one handle misbehaving.
   */
  it('keeps going when a handle throws', () => {
    const pc = fakeConnection();
    const after = vi.fn();
    keepUntilStopped(pc, after);
    keepUntilStopped(pc, () => { throw new Error('already gone'); });

    expect(() => releaseSessionHandles(pc)).not.toThrow();
    expect(after).toHaveBeenCalledOnce();
  });

  it('lets go, so a second stop does not run them again', () => {
    const pc = fakeConnection();
    const stopped = vi.fn();
    keepUntilStopped(pc, stopped);

    releaseSessionHandles(pc);
    releaseSessionHandles(pc);
    expect(stopped).toHaveBeenCalledOnce();
    expect(heldHandleCount(pc)).toBe(0);
  });

  it('survives being asked about nothing, because a stop can run with no connection', () => {
    expect(() => releaseSessionHandles(null)).not.toThrow();
    expect(() => releaseSessionHandles(fakeConnection())).not.toThrow();
    expect(keepUntilStopped(null, { stop: () => {} })).toEqual({ stop: expect.any(Function) });
    expect(heldHandleCount(null)).toBe(0);
  });

  it('keeps one session apart from another', () => {
    const publish = fakeConnection();
    const play = fakeConnection();
    const publishStop = vi.fn();
    const playStop = vi.fn();

    keepUntilStopped(publish, publishStop);
    keepUntilStopped(play, playStop);

    releaseSessionHandles(publish);
    expect(publishStop).toHaveBeenCalledOnce();
    expect(playStop).not.toHaveBeenCalled();
    expect(heldHandleCount(play)).toBe(1);
  });
});
