// replaceAudioTrack

const replaceAudioTrack = (newAudioTrack, audioSender, peerConnection, callbacks) => 
{
  if (typeof newAudioTrack !== 'undefined')
  {
    if (audioSender == null)
    {
      let newAudioSender = peerConnection.addTrack(newAudioTrack);
      if (callbacks.onSetSenders)
        callbacks.onSetSenders({audioSender:newAudioSender});
    }
    else
    {
      audioSender.replaceTrack(newAudioTrack);
    }
  }

}
export default replaceAudioTrack;