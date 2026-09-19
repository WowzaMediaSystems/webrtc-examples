import { releasePeerConnection } from '../diagnostics/connections';
import { loggedFetch, markWebSocketClosing } from '../diagnostics/signalLog';
import { releaseSessionHandles } from './sessionHandles';

// callbacks:
// - onSetPeerConnection
// - onSetWebsocket
// - onPublishStopped

const stopPublish = (useWhip, peerConnection, websocket, callbacks) =>
{
  // Before anything closes. close() fires no state change, so the diagnostics have to be
  // told the session is over rather than left to notice.
  releasePeerConnection('publish');
  // See markWebSocketClosing: a deliberate close can still raise an error event.
  markWebSocketClosing(websocket);
  // The frame stamp, the clock responder and the data channels. Before close(), so the sender
  // stops reporting itself as stamping and the transform does not log the teardown as an error.
  releaseSessionHandles(peerConnection);

  if(useWhip) {
    stopPublishWhip(peerConnection);
  } else {
    if (peerConnection != null) {
      peerConnection.close();
      if (callbacks.onSetPeerConnection)
        callbacks.onSetPeerConnection({peerConnection:undefined});
    }
    if (websocket != null) {
      websocket.close();
      if (callbacks.onSetWebsocket)
        callbacks.onSetWebsocket({websocket:undefined});
    }
  }
  
  if (callbacks.onPublishStopped)
    callbacks.onPublishStopped();
}

const stopPublishWhip = async (peerConnection) => {
  try {
    if (peerConnection?._whipSessionUrl) {
      // Logged like every other HTTP exchange. See stopPlay.js.
      await loggedFetch(peerConnection._whipSessionUrl, {
        method: "DELETE",
        headers: peerConnection._whipAuthToken ? { "Authorization": `Bearer ${peerConnection._whipAuthToken}` } : {}
      });
    }

    if (peerConnection) {
      peerConnection.close();
    }
  } catch (e) {
    console.error("Error stopping WHIP session", e);
  }
};

export default stopPublish;
