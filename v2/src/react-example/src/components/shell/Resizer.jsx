import React from 'react';

/*
 * The drag handle itself. All behaviour lives in useResizable; this is the thing you grab.
 */
const Resizer = ({ label, ...handleProps }) => (
  <div {...handleProps} aria-label={label} />
);

export default Resizer;
