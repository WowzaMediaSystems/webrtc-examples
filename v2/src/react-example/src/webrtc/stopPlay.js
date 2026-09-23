import { releasePeerConnection } from '../diagnostics/connections';
import { loggedFetch, markWebSocketClosing } from '../diagnostics/signalLog';
import { releaseSessionHandles } from './sessionHandles';

// callbacks:
// - onSetPeerConnection
// - onSetWebsocket
// - onPlayStopped

const stopPlay = (playSettings, peerConnection, websocket, callbacks) =>
{
  // Before anything closes. close() fires no state change, so the diagnostics have to be
  // told the session is over rather than left to notice.
  releasePeerConnection('play');
  // See markWebSocketClosing: a deliberate close can still raise an error event.
  markWebSocketClosing(websocket);
  // Everything the session registered (see sessionHandles). Before close().
  releaseSessionHandles(peerConnection);
  if (peerConnection != null) {
    peerConnection.onicecandidate = null;
    peerConnection.onnegotiationneeded = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.close();
    if (callbacks.onSetPeerConnection)
      callbacks.onSetPeerConnection({peerConnection:undefined});
  }
  if (playSettings.useWhep) {
    stopPlayWhep(playSettings);
  }
  if (websocket != null) {
    websocket.close();
    if (callbacks.onSetWebsocket)
      callbacks.onSetWebsocket({websocket:undefined});
  }
  if (callbacks.onPlayStopped)
    callbacks.onPlayStopped();
}

const stopPlayWhep = async (playSettings) => {
  if (playSettings._whepSessionUrl) {
    // Logged like every other HTTP exchange: the DELETE that ends a WHEP session was the
    // only one missing from the panel, which made a session look like it never ended.
    await loggedFetch(playSettings._whepSessionUrl, {
      method: "DELETE",
      headers: playSettings.authToken ? { "Authorization": `Bearer ${playSettings.authToken}` } : {}
    });
  }
};
export default stopPlay;