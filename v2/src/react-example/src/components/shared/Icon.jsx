import React from 'react';

/*
 * The two icons this example draws, inline.
 *
 * They used to come from the bootstrap-icons webfont, which is 314 KB of font files and a
 * 100 KB stylesheet defining around two thousand glyphs, to draw these two. An icon font
 * also has to load before anything appears, so the buttons sat empty on a cold cache.
 *
 * The paths are bootstrap-icons' own (MIT), copied from its x-lg.svg and plus-lg.svg, so
 * they are the same shapes at the same 16px grid. Anything new goes in here beside them.
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
 * Decorative by default: every one of these sits inside a button that already carries its own
 * accessible name, and an icon that repeats it is read twice. Pass a label for an icon that
 * is the only thing naming its control.
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
