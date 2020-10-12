import React from 'react';
import { useSelector } from 'react-redux';

const CompositeLiveIndicator = () => {

  const webrtcPublish = useSelector ((state) => state.webrtcPublish);

  if (!webrtcPublish.connected)
    return null;
    
  return (
    <div id="video-live-indicator">
      <span id="video-live-indicator-live" className="badge badge-pill badge-danger">LIVE</span>
    </div>
  );
}

export default CompositeLiveIndicator;