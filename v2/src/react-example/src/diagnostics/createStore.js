/*
 * A value plus subscribers: the shape useSyncExternalStore expects. The signal log and the
 * connection registry both use it, so there is one subscribe/notify implementation.
 * subscribe() calls the listener once with the current value, then on every change.
 */
export const createStore = (initial) => {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      for (const fn of listeners) fn(value);
    },
    subscribe: (fn) => {
      listeners.add(fn);
      fn(value);
      return () => listeners.delete(fn);
    },
  };
};
