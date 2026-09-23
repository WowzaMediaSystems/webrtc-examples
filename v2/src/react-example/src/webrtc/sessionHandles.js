/*
 * Everything a session opened that has to be shut when the session ends: the data channels,
 * the capture-track listeners and, with the latency probe on, its frame transforms and the
 * clock channel. Each call site hands its handle to keepUntilStopped().
 *
 * The handles hang off the RTCPeerConnection because that is the one object the stop paths
 * receive. A handle is a function, or anything with stop() or close().
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
