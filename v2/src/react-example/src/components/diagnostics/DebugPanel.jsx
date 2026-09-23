import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { clearLog, getEntries, subscribe } from '../../diagnostics/signalLog';
import Resizer from '../shell/Resizer';
import { useResizable } from '../../hooks/useResizable';

/*
 * Collapsible view of the signaling conversation with the Engine, collapsed by default and
 * resizable from its top edge when open.
 */

// `empty` explains a channel the session did not use, so it does not read as broken.
const CHANNELS = [
  { key: 'all', label: 'All', empty: 'Nothing yet. Start publishing or playing and the exchange with the Engine appears here.' },
  { key: 'ws', label: 'Signaling', empty: 'No signalling socket on this session. A WHIP or WHEP session negotiates over HTTP instead, which is on the WHIP/WHEP tab.' },
  { key: 'http', label: 'WHIP/WHEP', empty: 'No HTTP negotiation on this session. A wss session negotiates over the signalling socket instead, which is on the Signaling tab.' },
  { key: 'ice', label: 'ICE', empty: 'No ICE activity recorded yet.' },
  { key: 'pc', label: 'Connection', empty: 'No peer connection state changes recorded yet.' },
];

const ARROW = { out: '\u2191', in: '\u2193', info: '\u00b7', error: '!' };

const time = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

const Row = ({ entry }) => {
  const [open, setOpen] = useState(false);
  const hasDetail = entry.detail !== null && entry.detail !== undefined;

  return (
    <div className={`wz-debug__row wz-debug__row--${entry.direction}`}>
      <button
        type="button"
        className="wz-debug__head"
        onClick={() => hasDetail && setOpen((v) => !v)}
        aria-expanded={hasDetail ? open : undefined}
        disabled={!hasDetail}
      >
        <span className="wz-debug__time">{time(entry.at)}</span>
        <span className="wz-debug__arrow" aria-hidden="true">{ARROW[entry.direction] || '\u00b7'}</span>
        <span className="wz-debug__chan">{entry.channel}</span>
        <span className="wz-debug__label">{entry.label}</span>
        {hasDetail ? <span className="wz-debug__chev" aria-hidden="true">{open ? '\u2212' : '+'}</span> : null}
      </button>
      {open && hasDetail ? (
        <pre className="wz-debug__detail">
          {typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail, null, 2)}
        </pre>
      ) : null}
    </div>
  );
};

const DebugPanel = ({ defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  const entries = useSyncExternalStore(subscribe, getEntries);
  const [channel, setChannel] = useState('all');
  const [follow, setFollow] = useState(true);
  const [newestFirst, setNewestFirst] = useState(true);
  const scrollerRef = useRef(null);

  // At most two thirds of the window, so the stage above stays usable.
  const maxHeight = useCallback(() => Math.max(120, Math.round(window.innerHeight * 0.66)), []);
  const { size, handleProps, targetRef } = useResizable({
    axis: 'y',
    initial: 200,
    min: 90,
    max: maxHeight,
    invert: true,
    storageKey: 'wz.debug.height',
  });

  const filtered = channel === 'all' ? entries : entries.filter((e) => e.channel === channel);

  const shown = newestFirst ? [...filtered].reverse() : filtered;

  useEffect(() => {
    if (!open || !follow) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = newestFirst ? 0 : el.scrollHeight;
  }, [shown.length, open, follow, newestFirst]);

  const copyAll = () => {
    const text = shown
      .map((e) => `${time(e.at)} [${e.channel}] ${e.direction} ${e.label}`
        + (e.detail ? `\n${typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail, null, 2)}` : ''))
      .join('\n');
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  return (
    <section className="wz-debug">
      <button
        type="button"
        className="wz-debug__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="wz-debug__chev" aria-hidden="true">{open ? '\u25be' : '\u25b8'}</span>
        Server communication
        <span className="wz-debug__count">{entries.length}</span>
      </button>

      {open ? (
        <>
        <Resizer label="Resize the server communication panel" {...handleProps} />
        <div ref={targetRef} className="wz-debug__body" style={{ height: size }}>
          <div className="wz-debug__bar">
            <div className="wz-debug__filters" role="group" aria-label="Filter by channel">
              {CHANNELS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={`wz-chip${channel === c.key ? ' wz-chip--on' : ''}`}
                  onClick={() => setChannel(c.key)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <label className="wz-debug__follow">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
              Follow
            </label>
            <button
              type="button"
              className="wz-chip"
              id="debug-order"
              onClick={() => setNewestFirst((v) => !v)}
              title="Change which end of the log the newest line appears at"
            >
              {newestFirst ? 'Newest first' : 'Oldest first'}
            </button>
            <button type="button" className="wz-chip" onClick={copyAll}>Copy</button>
            <button type="button" className="wz-chip" onClick={clearLog}>Clear</button>
          </div>

          <div className="wz-debug__scroller" ref={scrollerRef}>
            {shown.length === 0 ? (
              <p className="wz-debug__empty">
                {(CHANNELS.find((c) => c.key === channel) || CHANNELS[0]).empty}
              </p>
            ) : (
              shown.map((e) => <Row key={e.id} entry={e} />)
            )}
          </div>
        </div>
        </>
      ) : null}
    </section>
  );
};

export default DebugPanel;