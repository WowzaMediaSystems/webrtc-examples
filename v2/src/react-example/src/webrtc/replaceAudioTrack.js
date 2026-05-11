// replaceAudioTrack

const replaceAudioTrack = (newAudioTrack, audioSender, peerConnection, callbacks) =>
{
  if (newAudioTrack === undefined) return;
  // Accept null (to remove the current track) or a real MediaStreamTrack.
  if (newAudioTrack !== null && typeof newAudioTrack.kind !== 'string') return;

  if (audioSender == null)
  {
    if (newAudioTrack === null) return;
    let newAudioSender = peerConnection.addTrack(newAudioTrack);
    if (callbacks.onSetSenders)
      callbacks.onSetSenders({audioSender:newAudioSender});
  }
  else
  {
    audioSender.replaceTrack(newAudioTrack);
  }
}
export default replaceAudioTrack;