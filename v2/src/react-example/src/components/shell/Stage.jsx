import React from 'react';

import Errors from './Errors';
import StatusBadges from './StatusBadges';

/*
 * The center column shell: topbar, video area, stat strip, and docked content. `badges`
 * adds to LIVE and PLAYING at the right end of the topbar.
 */
const Stage = ({ title, target, badges, children }) => (
  <div className="wz-stage">
    <div className="wz-topbar">
      <span className="wz-topbar__title">{title}</span>
      {target ? <span className="wz-topbar__target">{target}</span> : null}
      <div style={{ flexGrow: 1 }} />
      {badges}
      <StatusBadges />
    </div>
    <Errors />
    {children}
  </div>
);

export default Stage;
