import React from 'react';

import Errors from './Errors';
import StatusBadges from './StatusBadges';

/*
 * The centre column: a title bar, the video area, the stat strip, and whatever is docked
 * below it. Kept as a shell so each page supplies its own content without repeating the
 * chrome.
 *
 * LIVE and PLAYING live at the right end of the topbar. `badges` can add to them for a page
 * that has something else to say up there.
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
