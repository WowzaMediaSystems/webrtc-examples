import React from 'react';
import { useSelector } from 'react-redux';

// Publisher-side view of the outgoing captions channel: shows the line currently being broadcast.
// Deliberately a separate box rather than an overlay on the video - the captions travel over their
// own data channel, not baked into the media, and a box makes that obvious. The player, which
// consumes them, renders them as a subtitle overlay instead (see CaptionOverlay).
const PublishCaptionBox = () => {
  const enabled = useSelector((state) => state.publishSettings.captionsEnabled);
  const caption = useSelector((state) => state.dataChannel.publish.caption);

  if (!enabled) return null;

  return (
    <div className="card caption-sender mt-3" id="publish-caption-box">
      <div className="card-header">Captions (outgoing)</div>
      <div className="card-body p-2">
        {caption
          ? <span className="text-break">{caption}</span>
          : <span className="text-muted small">No captions sent yet</span>}
      </div>
    </div>
  );
};

export default PublishCaptionBox;
