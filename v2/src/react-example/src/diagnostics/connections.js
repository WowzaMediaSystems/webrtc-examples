/*
 * The live RTCPeerConnection per role ('play' | 'publish'), so the diagnostics UI can read
 * stats without threading the connection through Redux.
 *
 * Registration happens inside instrumentPeerConnection(), the one place a connection enters.
 */
import { createStore } from './createStore';

const stores = new Map();

const storeFor = (role) => {
  if (!stores.has(role)) stores.set(role, createStore(null));
  return stores.get(role);
};

export const registerPeerConnection = (role, peerConnection) => {
  const store = storeFor(role);
  store.set(peerConnection || null);
  if (peerConnection) {
    // Drop the reference once the connection is finished so stats polling stops.
    peerConnection.addEventListener('connectionstatechange', () => {
      if (['closed', 'failed'].includes(peerConnection.connectionState)
          && store.get() === peerConnection) {
        store.set(null);
      }
    });
  }
};

/*
 * Give up the connection for a role. RTCPeerConnection.close() does not fire
 * connectionstatechange, so the stop paths call this; they are the only places that know a
 * teardown was deliberate.
 *
 * Releases only the connection the caller meant: an abandoned attempt that times out after
 * a new session started must not deregister the live one. With no connection given it means
 * "whatever is current", which is what the stop buttons want.
 */
export const releasePeerConnection = (role, peerConnection = null) => {
  const store = storeFor(role);
  const held = store.get();
  if (!held) return;
  if (peerConnection && held !== peerConnection) return;
  store.set(null);
};

export const getPeerConnection = (role) => storeFor(role).get();

export const subscribePeerConnection = (role, fn) => storeFor(role).subscribe(fn);
