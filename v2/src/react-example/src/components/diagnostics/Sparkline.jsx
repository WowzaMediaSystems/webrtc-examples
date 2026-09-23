import React, { useMemo, useState } from 'react';

/*
 * Single-series trend line for a stat tile: no legend or axes, and only the current point
 * carries the accent color.
 */

const WIDTH = 62;
const HEIGHT = 18;
const PAD = 2;

const Sparkline = ({ points, format, ariaLabel }) => {
  const [hover, setHover] = useState(null);

  const series = useMemo(
    () => (points || []).filter((p) => typeof p === 'number' && Number.isFinite(p)),
    [points]
  );

  const geometry = useMemo(() => {
    if (series.length < 2) return null;
    const min = Math.min(...series);
    const max = Math.max(...series);
    // A flat series would divide by zero; draw it down the middle instead.
    const span = max - min || 1;
    const stepX = (WIDTH - PAD * 2) / (series.length - 1);
    const coords = series.map((v, i) => [
      PAD + i * stepX,
      HEIGHT - PAD - ((v - min) / span) * (HEIGHT - PAD * 2),
    ]);
    return { coords, min, max };
  }, [series]);

  if (!geometry) {
    return <div className="wz-spark wz-spark--empty" aria-hidden="true" />;
  }

  const { coords } = geometry;
  const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lastX, lastY] = coords[coords.length - 1];
  const active = hover === null ? null : coords[hover];

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(ratio * (coords.length - 1));
    setHover(Math.max(0, Math.min(coords.length - 1, idx)));
  };

  return (
    <div className="wz-spark">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <path d={path} className="wz-spark__line" />
        {active ? (
          <>
            <line
              x1={active[0]} y1={0} x2={active[0]} y2={HEIGHT}
              className="wz-spark__crosshair"
            />
            <circle cx={active[0]} cy={active[1]} r="2.5" className="wz-spark__hover" />
          </>
        ) : null}
        <circle cx={lastX} cy={lastY} r="2.5" className="wz-spark__now" />
      </svg>
      {hover !== null && format ? (
        <span className="wz-spark__tip">{format(series[hover])}</span>
      ) : null}
    </div>
  );
};

export default Sparkline;