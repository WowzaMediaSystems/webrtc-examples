import React, { useState, useCallback, useEffect } from 'react';

import ExternalLinks from '../../constants/ExternalLinks';
import Resizer from './Resizer';
import { useResizable } from '../../hooks/useResizable';

/*
 * The right-hand settings panel.
 *
 * `tabs` is [{ id, label, render }]. An optional `sides` renders a segmented switch above the
 * tabs, which the Publish + Play page uses to point one panel at either connection.
 * `actions` is the sticky footer: the primary control belongs there, not buried in a tab.
 *
 * The panel is resizable from its left edge. The upper bound leaves room for the stage
 * rather than being a fixed number, so the video never gets squeezed out of existence.
 */
const Inspector = ({ tabs, actions, legacyHref = null, sides = null, side = null, onSideChange = null }) => {
  const [active, setActive] = useState(tabs[0].id);

  /*
   * The combined page hands this one component two different tab arrays, so a tab selected
   * on one side can be absent from the other. Without this the body falls back to tabs[0]
   * while the strip shows nothing selected at all, and helpers.js asserts aria-selected.
   */
  useEffect(() => {
    if (!tabs.some((t) => t.id === active)) setActive(tabs[0].id);
  }, [tabs, active]);

  const current = tabs.find((t) => t.id === active) || tabs[0];

  const maxWidth = useCallback(() => Math.max(300, window.innerWidth - 520), []);
  const { size, handleProps } = useResizable({
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
    <aside className="wz-inspector" aria-label="Settings" style={{ width: size }}>
      {sides ? (
        <div className="wz-inspector__switch">
          <div className="wz-segment" role="group" aria-label="Which connection these settings apply to">
            {sides.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={side === s.id}
                onClick={() => onSideChange && onSideChange(s.id)}
                data-label={s.label}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

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

      {/* Permanent, and outside the scrolling body on purpose: the primary action is sticky
          to the body's bottom edge, so anything inside the body would sit under it. */}
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