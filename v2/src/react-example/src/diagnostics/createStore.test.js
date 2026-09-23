import { describe, expect, it, vi } from 'vitest';

import { createStore } from './createStore';

describe('createStore', () => {
  it('hands a new subscriber the current value, then every change', () => {
    const store = createStore(1);
    const seen = vi.fn();
    store.subscribe(seen);
    store.set(2);
    expect(seen.mock.calls).toEqual([[1], [2]]);
    expect(store.get()).toBe(2);
  });

  it('stops calling a listener after unsubscribe', () => {
    const store = createStore(null);
    const seen = vi.fn();
    const off = store.subscribe(seen);
    off();
    store.set('x');
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
