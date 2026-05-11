// callbacks:
// - onSetPeerConnection
// - onSetWebsocket
// - onPublishStopped

const stopPublish = (useWhip, peerConnection, websocket, callbacks) =>
{

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
      await fetch(peerConnection._whipSessionUrl, {
        method: "DELETE"
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
