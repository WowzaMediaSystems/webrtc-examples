import React from 'react';
import { useSelector } from 'react-redux';

/* LIVE while publishing, PLAYING while receiving; renders nothing when neither is connected. */
const StatusBadges = () => {
  const publishing = useSelector((state) => state.webrtcPublish.connected);
  const playing = useSelector((state) => state.webrtcPlay.connected);

  if (!publishing && !playing) return null;

  const badge = (key, id, label, modifier) => (
    <span
      key={key}
      id={id}
      className={'wz-status__badge wz-status__badge--' + modifier}
    >
      <span className="wz-status__dot" aria-hidden="true" />
      {label}
    </span>
  );

  return (
    <div className="wz-status" role="status" aria-live="polite">
      {publishing ? badge('live', 'video-live-indicator-live', 'LIVE', 'live') : null}
      {playing ? badge('playing', 'video-play-indicator', 'PLAYING', 'playing') : null}
    </div>
  );
};

export default StatusBadges;