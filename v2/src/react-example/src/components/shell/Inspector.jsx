import React, { useState, useCallback } from 'react';

import ExternalLinks from '../../constants/ExternalLinks';
import Resizer from './Resizer';
import { useResizable } from '../../hooks/useResizable';

/*
 * The right-hand settings panel. `tabs` is [{ id, label, render }]; `actions` is the sticky
 * footer for the primary control. Resizable from its left edge, capped so the stage always
 * keeps room.
 */
const Inspector = ({ tabs, actions, legacyHref = null }) => {
  const [active, setActive] = useState(tabs[0].id);

  const current = tabs.find((t) => t.id === active) || tabs[0];

  const maxWidth = useCallback(() => Math.max(300, window.innerWidth - 520), []);
  const { size, handleProps, targetRef } = useResizable({
    axis: 'x',
    initial: 340,
    min: 280,
    max: maxWidth,
    invert: true,
    storageKey: 'wz.inspector.width',
  });

  return (
    <>
    <Resizer label="Resize the settings panel" {...handleProps} />
    <aside ref={targetRef} className="wz-inspector" aria-label="Settings" style={{ width: size }}>
      <div className="wz-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={'tab-' + t.id}
            aria-selected={active === t.id}
            aria-controls={'panel-' + t.id}
            onClick={() => setActive(t.id)}
            /* The label again, for the width reservation in shell.css. */
            data-label={t.label}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        className="wz-inspector__body"
        role="tabpanel"
        id={'panel-' + current.id}
        aria-labelledby={'tab-' + current.id}
      >
        {current.render()}
      </div>

      {actions ? <div className="wz-inspector__actions">{actions}</div> : null}

      {/* Outside the scrolling body: the sticky primary action would cover it there. */}
      {legacyHref ? (
        <div className="wz-inspector__foot">
          <small>
            {ExternalLinks.legacyLinkText}{' '}
            <a href={legacyHref} target="_blank" rel="noopener noreferrer">
              {ExternalLinks.legacyLinkLabel}
            </a>
          </small>
        </div>
      ) : null}
    </aside>
    </>
  );
};

export default Inspector;