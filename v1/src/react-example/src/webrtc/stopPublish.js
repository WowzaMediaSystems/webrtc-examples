// callbacks:
// - onSetPeerConnection
// - onSetWebsocket
// - onPublishStopped

const stopPublish = (peerConnection, websocket, callbacks) =>
{
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
  if (callbacks.onPublishStopped)
    callbacks.onPublishStopped();
}
export default stopPublish;
