// replaceVideoTrack

const replaceVideoTrack = (newVideoTrack, videoSender, peerConnection, callbacks) => 
{
  console.log(newVideoTrack);
  if (typeof newVideoTrack !== 'undefined')
  {
    if (videoSender == null)
    {
      let newVideoSender = peerConnection.addTrack(newVideoTrack);
      if (callbacks.onSetSenders)
        callbacks.onSetSenders({videoSender:newVideoSender});
    }
    else
    {
      videoSender.replaceTrack(newVideoTrack);
    }
  }

}
export default replaceVideoTrack;