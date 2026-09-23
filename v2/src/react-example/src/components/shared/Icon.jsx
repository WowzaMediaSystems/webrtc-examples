import React from 'react';

/*
 * The icons this example draws, as inline SVG. Paths are copied from bootstrap-icons (MIT)
 * x-lg.svg and plus-lg.svg, on its 16px grid. Add new icons here.
 */
const PATHS = {
  close: {
    d: 'M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z',
    rule: null,
  },
  plus: {
    d: 'M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2',
    rule: 'evenodd',
  },
};

/*
 * Decorative by default, since the enclosing button already names it. Pass a label when the
 * icon alone names its control.
 */
const Icon = ({ name, size = 16, label = null, className = '' }) => {
  const glyph = PATHS[name];
  if (!glyph) return null;

  return (
    <svg
      className={className ? `wz-icon ${className}` : 'wz-icon'}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
    >
      <path d={glyph.d} fillRule={glyph.rule || undefined} />
    </svg>
  );
};

export default Icon;
