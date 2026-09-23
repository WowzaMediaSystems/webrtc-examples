import React from 'react';
import { useSelector } from 'react-redux';

/*
 * LIVE while publishing, PLAYING while receiving; renders nothing when neither is connected.
 * `compact` shows only the dot and moves the word into the accessible name (legacy Nav).
 */
const StatusBadges = ({ compact = false }) => {
  const publishing = useSelector((state) => state.webrtcPublish.connected);
  const playing = useSelector((state) => state.webrtcPlay.connected);

  if (!publishing && !playing) return null;

  const badge = (key, id, label, modifier) => (
    <span
      key={key}
      id={id}
      className={'wz-status__badge wz-status__badge--' + modifier + (compact ? ' wz-status__badge--compact' : '')}
      title={compact ? label : undefined}
    >
      <span className="wz-status__dot" aria-hidden="true" />
      {compact ? <span className="wz-visually-hidden">{label}</span> : label}
    </span>
  );

  return (
    <div className={'wz-status' + (compact ? ' wz-status--compact' : '')} role="status" aria-live="polite">
      {publishing ? badge('live', 'video-live-indicator-live', 'LIVE', 'live') : null}
      {playing ? badge('playing', 'video-play-indicator', 'PLAYING', 'playing') : null}
    </div>
  );
};

export default StatusBadges;