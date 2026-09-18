/*

 * Keeps a reference to the live RTCPeerConnection per role ('play' | 'publish') so the

 * diagnostics UI can read stats from it without the connection having to be threaded

 * through Redux and half a dozen components.

 *

 * Registration happens inside instrumentPeerConnection(), which the signaling code already

 * calls, so there is exactly one place a connection enters the system.

 */



const current = new Map();

const listeners = new Map();



const notify = (role) => {

  const set = listeners.get(role);

  if (set) for (const fn of set) fn(current.get(role) || null);

};



export const registerPeerConnection = (role, peerConnection) => {

  current.set(role, peerConnection);

  notify(role);



  if (peerConnection) {

    // Drop the reference once the connection is finished so stats polling stops.

    peerConnection.addEventListener('connectionstatechange', () => {

      if (['closed', 'failed'].includes(peerConnection.connectionState)

          && current.get(role) === peerConnection) {

        current.set(role, null);

        notify(role);

      }

    });

  }

};



/*

 * Give up the connection for a role.

 *

 * This exists because RTCPeerConnection.close() does not fire connectionstatechange. The

 * listener above only sees states the browser transitions into on its own, so a session the

 * user ends by hand left the connection registered here and the stats panel went on

 * reporting the last state it saw, "connected", against a connection that was shut.

 *

 * Called by the stop paths, which are the only places that know a teardown was deliberate.

 */

export const releasePeerConnection = (role, peerConnection = null) => {
  const held = current.get(role);
  if (!held) return;

  /*
   * Release the connection the caller meant, not whichever one is current.
   *
   * The abandoned-attempt path calls this too, and an attempt that times out after a new
   * session has already started would otherwise deregister the live connection and blank the
   * stats panel on a session that is working. The statechange listener above does the same
   * check for the same reason. Called with no connection, it still means "whatever is
   * current", which is what the stop buttons want.
   */
  if (peerConnection && held !== peerConnection) return;

  current.set(role, null);
  notify(role);
};



export const getPeerConnection = (role) => current.get(role) || null;



export const subscribePeerConnection = (role, fn) => {

  if (!listeners.has(role)) listeners.set(role, new Set());

  listeners.get(role).add(fn);

  fn(current.get(role) || null);

  return () => listeners.get(role)?.delete(fn);

};