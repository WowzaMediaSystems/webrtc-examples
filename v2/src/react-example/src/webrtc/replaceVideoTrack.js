// replaceVideoTrack

const replaceVideoTrack = (newVideoTrack, videoSender, peerConnection, callbacks) =>
{
  if (newVideoTrack === undefined) return;
  // Accept null (to remove the current track) or a real MediaStreamTrack.
  // Anything else (e.g. the `{}` initial state) is a no-op — guards against
  // RTCPeerConnection.addTrack throwing on non-track values.
  if (newVideoTrack !== null && typeof newVideoTrack.kind !== 'string') return;

  if (videoSender == null)
  {
    if (newVideoTrack === null) return;
    let newVideoSender = peerConnection.addTrack(newVideoTrack);
    if (callbacks.onSetSenders)
      callbacks.onSetSenders({videoSender:newVideoSender});
  }
  else
  {
    videoSender.replaceTrack(newVideoTrack);
  }
}
export default replaceVideoTrack;