import React from 'react';
import { useSelector } from 'react-redux';

// Subtitle overlay for the received captions data channel (player side). Renders the latest caption
// line over the video, or nothing when empty (the caption resets to '' on disconnect). The
// publisher shows its outgoing captions in a separate box instead - see PublishCaptionBox. `context`
// is kept as a prop so the overlay stays reusable. See captions.js and dataChannelReducer.
const CaptionOverlay = ({ context }) => {
  const caption = useSelector((state) => state.dataChannel[context].caption);

  if (!caption) return null;

  return <div className="caption-overlay">{caption}</div>;
};

export default CaptionOverlay;
