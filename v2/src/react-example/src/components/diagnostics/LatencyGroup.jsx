import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { latencyProbeSupport, subscribe } from '../../diagnostics/latencyProbe';
import MeasurementHelp from './MeasurementHelp';

/*
 * Publisher-to-player latency from the frame stamp, split into the Engine leg and this
 * browser's decode and display leg. Display only: it renders what latencyProbe.js reports
 * and computes nothing. Stalled, unstamped, unsupported and unsyncable states each get a
 * visible form, and none of them may show a plausible number.
 */

/*
 * The clock descriptor from the probe:
 *
 *   sample.clock = {
 *     mode: 'same-context' | 'same-clock' | 'cross-machine',
 *     exact: boolean,               // true when both ends read one clock
 *     offsetMs: number | null,      // far clock minus this clock, cross-machine only
 *     uncertaintyMs: number | null, // rtt_min / 2, the bound on the asymmetry error
 *     reason: string | null,        // set when the offset could not be trusted
 *   }
 *
 * A missing or unrecognized descriptor fails closed and suppresses the figures.
 */
/*
 * 'one clock' rather than 'same machine': a zero offset says the ends share a clock, not
 * where the far end runs.
 */
const MODE_LABELS = {
  'same-context': 'exact (one browser)',
  'same-clock': 'exact (one clock)',
  'cross-machine': 'estimated across two machines',
};

/* Re-render cadence for the age of the last sample. */
const TICK_MS = 500;

/*
 * A gap this long at 30 fps is not jitter: the publisher stopped, the track muted, or the tab
 * went to the background.
 */
const STALE_AFTER_MS = 1500;

/*
 * Grace period before a missing stamp is a finding: the first stamped frame needs a keyframe
 * and a pass through the Engine.
 */
const NO_STAMP_AFTER_MS = 3000;

const ms = (value) =>
  value === null || value === undefined || Number.isNaN(value)
    ? '\u2014'
    : `${Math.round(value)} ms`;

/* What the total leaves out: short form in the footnote, long form in the tooltip. */
const TOTAL_EXCLUDES_SHORT =
  'Excludes camera capture, the encoder queue ahead of the stamp, and panel emission, so the '
  + 'delay you can see with your eyes is larger than this.';

const TOTAL_EXCLUDES =
  'Excludes camera capture (sensor and image processing before the browser sees a frame), '
  + 'the encoder queue ahead of the stamp, and panel emission: the display time is the '
  + "browser's own prediction of when the frame will be shown, not an observation of light "
  + 'leaving the screen. The delay you can see with your eyes is larger than this.';

/**
 * Turns the clock descriptor into something displayable, and says whether the figures beside
 * it may be shown at all.
 */
const describeClock = (clock) => {
  if (!clock || typeof clock !== 'object') {
    return {
      usable: false,
      text: 'not described',
      detail: 'The probe did not report how the publisher and player clocks relate, so the '
        + 'difference between the two timestamps cannot be read as a latency.',
    };
  }

  if (clock.reason) {
    return { usable: false, text: 'too uncertain to measure', detail: clock.reason };
  }

  if (clock.exact === true) {
    return {
      usable: true,
      text: MODE_LABELS[clock.mode] || 'exact',
      detail: 'Both ends read the same operating system clock, so the difference between the '
        + 'two timestamps is the latency and nothing else. Two browser windows on one machine '
        + 'count as one clock.',
    };
  }

  if (Number.isFinite(clock.uncertaintyMs)) {
    return {
      usable: true,
      text: `\u00b1 ${Math.round(clock.uncertaintyMs)} ms`,
      uncertaintyMs: clock.uncertaintyMs,
      detail: 'The two machines have independent clocks. The offset is estimated over a data '
        + 'channel, and the bound shown is half the fastest round trip: the most a one-way '
        + 'figure taken from a round trip can be wrong by when the two directions are not '
        + 'equally fast.',
    };
  }

  return {
    usable: false,
    text: 'unknown',
    detail: 'The clock descriptor carried neither an exact-clock flag nor an uncertainty, so '
      + 'how far apart the two clocks sit is unknown.',
  };
};

/* Head and table follow the simulcast layer panel, so the two read as one family. */
const Shell = ({ summary, summaryTone, children }) => (
  <div className="wz-latency" id="latency-group">
    <div className="wz-latency__head">
      <span className="wz-latency__title">Frame stamp latency</span>
      {/* In the head so it is present in every state of the panel. */}
      <MeasurementHelp />
      {summary ? (
        <span
          className={'wz-latency__summary' + (summaryTone ? ' wz-latency__summary--' + summaryTone : '')}
        >
          {summary}
        </span>
      ) : null}
    </div>
    {children}
  </div>
);

const Row = ({ label, note, value, title, muted }) => (
  <tr className={muted ? 'wz-latency__row--muted' : undefined}>
    <th scope="row">
      {label}
      {note ? <span className="wz-latency__note">{note}</span> : null}
    </th>
    <td className="wz-latency__value" title={title}>{value}</td>
  </tr>
);

/*
 * Why there is no stamp. The stamp is H.264 only, so a known non-H.264 codec is named as the
 * cause.
 */
const noStampReason = (videoCodec) => {
  const codec = String(videoCodec || '').trim();
  if (codec !== '' && !/^h\.?264$/i.test(codec)) {
    return `This stream is ${codec}, and the frame stamp is an H.264 SEI NAL. Nothing else `
      + 'carries one. Set Video Codec to H.264 on the publisher: on Auto the server picks, and '
      + 'this one picked something else.';
  }
  return 'No frame stamp in this stream. Either the publisher does not have the probe on '
    + '(both ends need it), or something between the two re-encoded the video and dropped the '
    + 'marker. A transcoding application reads exactly like this.';
};

const LatencyGroup = ({ connected, videoCodec = null }) => {
  const enabled = useSelector((state) => state.playSettings.latencyProbe) === true;

  const [sample, setSample] = useState(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const listening = enabled && connected;

  useEffect(() => {
    if (!listening) {
      // So a figure from the previous session cannot reappear as this one's.
      setSample(null);
      return undefined;
    }

    setStartedAt(Date.now());
    setNow(Date.now());

    const unsubscribe = subscribe((next) => {
      // A replayed null before the first frame is not a sample and must not end the grace period.
      if (!next) return;
      setSample(next);
      setReceivedAt(Date.now());
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [listening]);

  // Stall and grace period are wall-time checks, so re-render without a new sample.
  useEffect(() => {
    if (!listening) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [listening]);

  if (!enabled) return null;

  /*
   * Checked even though the toggle is disabled here: a cookie or share link can turn the flag
   * on in a browser that cannot honor it.
   */
  const support = latencyProbeSupport();
  if (!support.supported) {
    return (
      <Shell summary="unavailable" summaryTone="bad">
        <p className="wz-latency__caveat">{support.reason}</p>
      </Shell>
    );
  }

  if (!sample) {
    if (!connected) return null;

    const waiting = now - startedAt < NO_STAMP_AFTER_MS;
    return (
      <Shell summary={waiting ? 'waiting' : 'no stamp'} summaryTone={waiting ? null : 'bad'}>
        <p className="wz-latency__caveat">
          {waiting ? 'Waiting for the first stamped frame.' : noStampReason(videoCodec)}
        </p>
      </Shell>
    );
  }

  const clock = describeClock(sample.clock);
  const age = now - receivedAt;
  const stale = age > STALE_AFTER_MS;
  const missed = Number.isFinite(sample.missedFrames) ? sample.missedFrames : null;

  /*
   * A stale sample was a real measurement, so its figures stay, grayed. An unusable clock
   * means there was never a measurement, so nothing is shown.
   */
  const showFigures = clock.usable;

  const withUncertainty = (value) => {
    if (!showFigures || value === null || value === undefined) return '\u2014';
    return clock.uncertaintyMs
      ? `${ms(value)} \u00b1 ${Math.round(clock.uncertaintyMs)} ms`
      : ms(value);
  };

  // The head shows only what the rows cannot: that the figures are stale.
  const summary = stale ? `no stamped frame for ${(age / 1000).toFixed(1)} s` : null;

  return (
    <Shell summary={summary} summaryTone={stale ? 'bad' : null}>
      <table className={'wz-latency__table' + (stale ? ' wz-latency__table--stale' : '')}>
        <tbody>
          <Row
            label="Publisher to player"
            note="the Engine leg"
            value={showFigures ? ms(sample.transportMs) : '\u2014'}
            title={'Stamped after the publisher encoded the frame and read before this browser '
              + 'decoded it. Covers packetizing, the network to the Engine, everything inside '
              + 'the Engine, the network back, and the wait in the jitter buffer.'}
          />
          <Row
            label="Player decode and display"
            note="this browser"
            value={showFigures ? ms(sample.playerMs) : '\u2014'}
            title={'From the frame being read off the wire to the moment the browser expects to '
              + 'show it: decode, the compositor, and the wait for the next display refresh. '
              + 'That last part is a prediction, not an observation.'}
          />
          <Row
            label="Total"
            note="stamp to expected display"
            value={withUncertainty(showFigures ? sample.totalMs : null)}
            title={TOTAL_EXCLUDES}
          />
          <Row
            label="Clock"
            note={clock.usable ? null : 'no figures without this'}
            value={clock.text}
            title={clock.detail}
            muted={!clock.usable}
          />
          <Row
            label="Frames missed"
            note="gaps in the stamp sequence"
            value={missed === null ? '\u2014' : String(missed)}
            title={'Counted from the sequence numbers in the stamp, so a publisher that stalls '
              + 'shows up here rather than as a latency that quietly drifts upwards. '
              + (Number.isFinite(sample.lastSequence)
                ? `Last stamp seen: ${sample.lastSequence}.`
                : '')}
          />
        </tbody>
      </table>

      {/* The stale warning is never hidden behind the help button. */}
      <p className="wz-latency__caveat">
        {stale
          ? `Last stamped frame ${(age / 1000).toFixed(1)} s ago, so these figures describe a `
            + 'frame that is no longer on screen. '
          : ''}
        {clock.usable ? TOTAL_EXCLUDES_SHORT : clock.detail}
      </p>
    </Shell>
  );
};

export default LatencyGroup;
