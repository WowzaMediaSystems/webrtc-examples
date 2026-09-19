/*
 * Everything a session opened that has to be shut when the session ends.
 *
 * The probe transforms, the clock channel and the data channels all hand back a handle, and
 * every call site was dropping it. Nothing stopped when a publish or a play stopped: the clock
 * kept its 250 ms timer chain running for the life of the tab, the probe kept its 500 ms emit
 * interval and a reference to the closed peer connection, and the sender kept reporting itself
 * as stamping. That last one is the worst of them, because "the publisher is stamping in this
 * page" is what lets the panel call two clocks identical, so a later play-only session against
 * somebody else's stream could be told its figures were exact.
 *
 * The handles hang off the RTCPeerConnection because that is the one object the stop paths
 * receive. `_whipSessionUrl` already rides there for the same reason.
 *
 * A handle is anything with stop() or close(). Both spellings exist in this codebase and
 * neither is worth renaming to suit a registry.
 */

const HANDLES = '__wzSessionHandles';

/** Keep this handle until the session stops. Returns the handle, so it can wrap a call. */
export const keepUntilStopped = (peerConnection, handle) => {
  if (!peerConnection || !handle) return handle;
  if (!peerConnection[HANDLES]) peerConnection[HANDLES] = [];
  peerConnection[HANDLES].push(handle);
  return handle;
};

/**
 * Shut everything this session opened.
 *
 * Every handle is tried even if one throws: a teardown that gives up halfway leaves the
 * leaks it was called to collect. In reverse order, so anything layered on top goes first.
 */
export const releaseSessionHandles = (peerConnection) => {
  if (!peerConnection || !peerConnection[HANDLES]) return;
  const handles = peerConnection[HANDLES];
  peerConnection[HANDLES] = [];

  for (let index = handles.length - 1; index >= 0; index -= 1) {
    const handle = handles[index];
    try {
      if (typeof handle === 'function') handle();
      else if (typeof handle.stop === 'function') handle.stop();
      else if (typeof handle.close === 'function') handle.close();
    } catch {
      // Already shut, or shutting. Nothing here is worth failing a teardown over.
    }
  }
};

/** For tests: how many handles are still held. */
export const heldHandleCount = (peerConnection) =>
  (peerConnection && peerConnection[HANDLES] ? peerConnection[HANDLES].length : 0);
