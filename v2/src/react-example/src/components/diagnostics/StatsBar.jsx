import React from 'react';

import Sparkline from './Sparkline';

/*
 * Live connection readout, in two groups.
 *
 * Media is what the stream is: codecs, size, rate, and the frame counters, for video and
 * audio. Network is where the time goes: state, round trip, latency, jitter buffer, loss.
 * One undifferentiated row made you read every tile to find the two you wanted, and put
 * "which codec" next to "how far behind" as though they answered the same question.
 *
 * The latency tile says "est." and carries its method in the title attribute. It is a
 * receiver-side estimate, not glass-to-glass, and must not be presented as though it were.
 * On a publisher there is no receive path, so the latency and jitter buffer tiles are
 * hidden rather than shown with a misleading number.
 *
 * Tile tone (the coloured rule on the left) is never the only carrier of meaning: every
 * tile also states its value and unit in text.
 */

const fmt = (value, digits = 0, suffix = '') =>
  value === null || value === undefined || Number.isNaN(value)
    ? '\u2014'
    : `${value.toFixed(digits)}${suffix}`;

const band = (value, good, fair) => {
  if (value === null || value === undefined) return 'unknown';
  if (value <= good) return 'good';
  if (value <= fair) return 'fair';
  return 'poor';
};

const Tile = ({ label, value, sub, tone = 'unknown', title, history, format, sparkLabel }) => (
  <div className={'wz-stat wz-stat--' + tone} title={title}>
    <div className="wz-stat__label">{label}</div>
    <div className="wz-stat__row">
      <span className="wz-stat__value">{value}</span>
      {history ? <Sparkline points={history} format={format} ariaLabel={sparkLabel || label} /> : null}
    </div>
    {sub ? <div className="wz-stat__sub">{sub}</div> : null}
  </div>
);

/* The heading names the group for a reader; aria-label names the tile row itself, so the
   group is addressable rather than being an unnamed box inside a named region. */
const Group = ({ title, children }) => (
  <section className="wz-statgroup">
    <h3 className="wz-statgroup__title">{title}</h3>
    <div className="wz-stats" role="group" aria-label={title}>{children}</div>
  </section>
);

const seriesOf = (history, key) =>
  Array.isArray(history) && history.length > 1
    ? history.map((h) => (h ? h[key] : null))
    : null;

/*
 * role says which side of the connection this bar belongs to, and it comes from the page
 * rather than from the stats. Deriving it from isReceiving alone meant a player that had
 * not connected yet reported "Frames encoded", which a player never does.
 */
const StatsBar = ({ stats, history, connectionState, role = 'publish' }) => {
  const s = stats || {};
  const isPlayer = role === 'play';
  const receiving = isPlayer || s.isReceiving === true;

  const latencyTitle = s.latencyIsPartial
    ? 'Incomplete: only one of the two components is available so far.'
    : 'Estimate = half the measured round trip time, plus the average jitter buffer delay. '
      + 'Excludes capture, encode, Engine processing, decode and display, so true '
      + 'glass-to-glass latency is higher.';

  const packetLoss = (
    <Tile
      label="Packet loss"
      value={fmt(s.packetLossPct, 2, ' %')}
      tone={band(s.packetLossPct, 0.5, 2)}
      title="Lost packets as a share of lost plus received, or of what was sent when this side only sends."
      history={seriesOf(history, 'packetLossPct')}
      format={(v) => `${v.toFixed(2)} %`}
      sparkLabel="Packet loss over the last minute"
    />
  );

  return (
    <div className="wz-statgroups">
      <Group title="Network">
        <Tile
          label="State"
          value={connectionState || 'idle'}
          tone={connectionState === 'connected' ? 'good' : connectionState === 'failed' ? 'poor' : 'unknown'}
          title="RTCPeerConnection.connectionState"
        />
        <Tile
          label="Round trip"
          value={fmt(s.rttMs, 0, ' ms')}
          sub="measured"
          tone={band(s.rttMs, 60, 150)}
          title="Round trip time on the active ICE candidate pair, as reported by the browser."
          history={seriesOf(history, 'rttMs')}
          format={(v) => `${v.toFixed(0)} ms`}
          sparkLabel="Round trip time over the last minute"
        />
        {receiving ? (
          <>
            <Tile
              label="Latency"
              value={fmt(s.estimatedLatencyMs, 0, ' ms')}
              sub={s.latencyIsPartial ? 'est. (partial)' : 'est. receiver side'}
              tone={band(s.estimatedLatencyMs, 150, 400)}
              title={latencyTitle}
              history={seriesOf(history, 'estimatedLatencyMs')}
              format={(v) => `${v.toFixed(0)} ms est.`}
              sparkLabel="Estimated latency over the last minute"
            />
            <Tile
              label="Jitter buffer"
              value={fmt(s.jitterBufferMs, 0, ' ms')}
              tone={band(s.jitterBufferMs, 80, 200)}
              title="Average time a frame waits in the jitter buffer before it is played."
              history={seriesOf(history, 'jitterBufferMs')}
              format={(v) => `${v.toFixed(0)} ms`}
              sparkLabel="Jitter buffer delay over the last minute"
            />
          </>
        ) : null}
        {packetLoss}
      </Group>

      <Group title="Media">
        <Tile
          label="Video codec"
          value={s.codec || '\u2014'}
          tone={s.codec ? 'good' : 'unknown'}
          title={'The video codec actually negotiated for this connection. If a downstream '
            + 'workflow expects H264, a VP8 or VP9 result here is the thing to look at first.'}
        />
        <Tile
          label="Video"
          value={
            s.frameWidth && s.frameHeight
              ? String(s.frameWidth) + '\u00d7' + String(s.frameHeight)
              : (connectionState === 'connected' && s.hasVideo === false ? 'none' : '\u2014')
          }
          sub={
            s.framesPerSecond
              ? Math.round(s.framesPerSecond) + ' fps'
              : (connectionState === 'connected' && s.hasVideo === false ? 'audio only' : null)
          }
          tone={connectionState === 'connected' && s.hasVideo === false ? 'poor' : 'unknown'}
          title={'Frame size and rate currently being sent or received. "none" means the '
            + 'connection is up but carries no video track at all, which is not the same as '
            + 'video that has not started yet.'}
          history={seriesOf(history, 'framesPerSecond')}
          format={(v) => v.toFixed(0) + ' fps'}
          sparkLabel="Frame rate over the last minute"
        />
        <Tile
          label="Video bitrate"
          value={fmt(s.inboundKbps ?? s.outboundKbps, 0, ' kbps')}
          sub={receiving ? 'inbound' : 'outbound'}
          title="Derived from the byte counter delta between the last two samples. On a simulcast publish this is every encoding added together."
          history={seriesOf(history, receiving ? 'inboundKbps' : 'outboundKbps')}
          format={(v) => `${v.toFixed(0)} kbps`}
          sparkLabel="Video bitrate over the last minute"
        />
        <Tile
          label={isPlayer ? 'Frames decoded' : 'Frames encoded'}
          value={fmt(isPlayer ? s.framesDecoded : s.framesEncoded, 0)}
          sub={isPlayer && s.framesDropped ? `${s.framesDropped} dropped` : null}
          tone={(isPlayer ? s.framesDecoded : s.framesEncoded) ? 'good' : 'unknown'}
          title={isPlayer
            ? 'Frames the browser has actually decoded. If this stays at zero while the '
              + 'bitrate climbs, packets are arriving but cannot be decoded.'
            : 'Frames this browser has encoded and sent.'}
        />
        <Tile
          label="Audio codec"
          value={s.audioCodec || (connectionState === 'connected' && s.hasAudio === false ? 'none' : '\u2014')}
          tone={connectionState === 'connected' && s.hasAudio === false ? 'poor' : 'unknown'}
          title={'The audio codec negotiated for this connection. "none" means the connection '
            + 'carries no audio track at all.'}
        />
        <Tile
          label="Audio bitrate"
          value={fmt(s.audioKbps, 0, ' kbps')}
          sub={receiving ? 'inbound' : 'outbound'}
          title="Audio is easy to lose sight of behind the video figures, so it gets its own reading."
          history={seriesOf(history, 'audioKbps')}
          format={(v) => `${v.toFixed(0)} kbps`}
          sparkLabel="Audio bitrate over the last minute"
        />
      </Group>
    </div>
  );
};

export default StatsBar;