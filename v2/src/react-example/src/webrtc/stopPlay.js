// callbacks:
// - onSetPeerConnection
// - onSetWebsocket
// - onPlayStopped

const stopPlay = (playSettings, peerConnection, websocket, callbacks) => 
{
  if (peerConnection != null) {
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
    await fetch(playSettings._whepSessionUrl, {
      method: "DELETE"
    });
  }
};
export default stopPlay;