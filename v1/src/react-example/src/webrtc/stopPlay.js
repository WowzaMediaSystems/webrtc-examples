// callbacks:
// - onSetPeerConnection
// - onSetWebsocket
// - onPlayStopped

const stopPlay = (peerConnection, websocket, callbacks) => 
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
  if (callbacks.onPlayStopped)
    callbacks.onPlayStopped();
}
export default stopPlay;