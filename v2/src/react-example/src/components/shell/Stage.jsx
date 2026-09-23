import React from 'react';

import Errors from './Errors';

/*
 * The center column shell: topbar, video area, stat strip, and docked content.
 */
const Stage = ({ title, target, badges, children }) => (
  <div className="wz-stage">
    <div className="wz-topbar">
      <span className="wz-topbar__title">{title}</span>
      {target ? <span className="wz-topbar__target">{target}</span> : null}
      <div style={{ flexGrow: 1 }} />
      {badges}
    </div>
    <Errors />
    {children}
  </div>
);

export default Stage;
