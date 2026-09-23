import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Drag-to-resize for the shell's panels. The handle is a focusable separator, so the keyboard
 * works too. Pointer capture keeps a fast drag tracking after it leaves the handle or window.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const read = (key, fallback) => {
  if (!key) return fallback;
  try {
    const saved = window.localStorage.getItem(key);
    const parsed = saved == null ? NaN : Number(saved);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    // Private windows and blocked storage both throw; the default size is fine.
    return fallback;
  }
};

const write = (key, value) => {
  if (!key) return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Failing to remember the size must not stop resizing.
  }
};

/**
 * axis    'x' for a vertical divider (drag sideways), 'y' for a horizontal one.
 * invert  true for panels docked right or bottom, where dragging toward the origin grows them.
 */
export const useResizable = ({ axis, initial, min, max, invert = false, storageKey }) => {
  const [size, setSize] = useState(() => clamp(read(storageKey, initial), min, max()));
  const [dragging, setDragging] = useState(false);
  const origin = useRef(null);

  // The element being resized. During a drag its size is written to it directly and state is
  // committed on release, so what it contains does not re-render on every pointer move.
  const targetRef = useRef(null);
  const property = axis === 'x' ? 'width' : 'height';

  // Size as of the last move: a release in the same frame would otherwise save the old value.
  const latest = useRef(size);

  // The window can shrink below a size chosen when it was larger.
  useEffect(() => {
    const onResize = () => setSize((current) => {
      const bounded = clamp(current, min, max());
      latest.current = bounded;
      return bounded;
    });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [min, max]);

  const apply = useCallback((next) => {
    const bounded = clamp(next, min, max());
    latest.current = bounded;
    setSize(bounded);
    return bounded;
  }, [min, max]);

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = { at: axis === 'x' ? event.clientX : event.clientY, size };
    setDragging(true);
  };

  const onPointerMove = (event) => {
    if (origin.current === null) return;
    const now = axis === 'x' ? event.clientX : event.clientY;
    const delta = (now - origin.current.at) * (invert ? -1 : 1);
    if (!targetRef.current) {
      apply(origin.current.size + delta);
      return;
    }
    const bounded = clamp(origin.current.size + delta, min, max());
    latest.current = bounded;
    targetRef.current.style[property] = `${bounded}px`;
    event.currentTarget.setAttribute('aria-valuenow', String(Math.round(bounded)));
  };

  const finish = (event) => {
    if (origin.current === null) return;
    origin.current = null;
    setDragging(false);
    setSize(latest.current);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already be gone; nothing to release.
    }
    write(storageKey, latest.current);
  };

  const onKeyDown = (event) => {
    const step = event.shiftKey ? 48 : 16;
    const grow = axis === 'x'
      ? (invert ? 'ArrowLeft' : 'ArrowRight')
      : (invert ? 'ArrowUp' : 'ArrowDown');
    const shrink = axis === 'x'
      ? (invert ? 'ArrowRight' : 'ArrowLeft')
      : (invert ? 'ArrowDown' : 'ArrowUp');

    let next = null;
    if (event.key === grow) next = size + step;
    else if (event.key === shrink) next = size - step;
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max();
    if (next === null) return;

    event.preventDefault();
    write(storageKey, apply(next));
  };

  const handleProps = {
    role: 'separator',
    tabIndex: 0,
    'aria-orientation': axis === 'x' ? 'vertical' : 'horizontal',
    'aria-valuenow': Math.round(size),
    'aria-valuemin': min,
    'aria-valuemax': Math.round(max()),
    className: `wz-resizer wz-resizer--${axis}${dragging ? ' wz-resizer--dragging' : ''}`,
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: finish,
    onKeyDown,
  };

  return { size, handleProps, targetRef };
};
