import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { latencyProbeSupport, subscribe } from '../../diagnostics/latencyProbe';
import MeasurementHelp from './MeasurementHelp';

/*
 * Publisher-to-player latency, read from the frame stamp.
 *
 * The probe stamps every encoded frame at the publisher with a sequence number and a
 * timestamp, and reads it back at the player before decode. That gives two legs rather than
 * one figure: the part the Engine owns, and the part this browser's own decoder and
 * compositor own. Splitting them is the point of the whole exercise, because "how much of
 * the delay is yours?" is the question a customer call actually asks.
 *
 * This component only displays. It subscribes to src/diagnostics/latencyProbe.js and renders
 * what arrives; it measures nothing itself and never computes a figure the probe did not
 * report.
 *
 * Each state below was seen during the research runs, so each one has a visible form here.
 * None of them may show a plausible number:
 *
 *   - the publisher stops sending      -> the figures grey out and the age is stated
 *   - nothing in the stream is stamped -> "No frame stamp in this stream", with the causes
 *   - the browser cannot do this       -> the reason, in words
 *   - the two clocks cannot be related -> no figures at all, and why
 */

/*
 * The clock descriptor this component reads, as agreed with the probe module:
 *
 *   sample.clock = {
 *     mode: 'same-context' | 'same-clock' | 'cross-machine',
 *     exact: boolean,               // true when both ends read one clock
 *     offsetMs: number | null,      // far clock minus this clock, cross-machine only
 *     uncertaintyMs: number | null, // rtt_min / 2, the bound on the asymmetry error
 *     reason: string | null,        // set when the offset could not be trusted
 *   }
 *
 * A missing or unrecognized descriptor is treated as "cannot say", which suppresses the
 * figures. Fail closed deliberately: an undescribed clock and an unsynchronized one look
 * identical from here, and one of the two produces a confidently wrong latency, which is the
 * exact failure this feature exists to delete.
 */
/*
 * The map used to carry 'same-machine', which the probe has never emitted: it reports
 * 'same-clock'. An unlisted mode renders as nothing, so two tabs on one machine, the ordinary
 * two-window test, showed "exact" followed by a blank where the reason should be.
 *
 * 'one clock' rather than 'same machine' because that is what was measured. A zero offset says
 * the two ends read the same clock; it does not say where the far end is running.
 */
const MODE_LABELS = {
  'same-context': 'exact (one browser)',
  'same-clock': 'exact (one clock)',
  'cross-machine': 'estimated across two machines',
};

/* Re-render cadence for the age of the last sample: fast enough that a stall is obvious
   within a second, slow enough to be invisible in a profile. */
const TICK_MS = 500;

/*
 * A sample older than this describes a frame that is no longer on screen. At 30 fps the
 * probe has a sample every 33 ms and the Engine leg measured about 100 ms, so a gap of a
 * second and a half is not jitter: the publisher stopped, the track muted, or the tab went
 * to the background.
 */
const STALE_AFTER_MS = 1500;

/*
 * How long to wait before calling the absence of a stamp a finding rather than a startup.
 * The first stamped frame cannot arrive until the publisher has encoded a keyframe and the
 * Engine has passed it on, and the Engine leg was measured at about 100 ms. Three seconds
 * covers that with room to spare and is short enough that nobody sits looking at an empty
 * panel wondering whether the feature works.
 */
const NO_STAMP_AFTER_MS = 3000;

const ms = (value) =>
  value === null || value === undefined || Number.isNaN(value)
    ? '\u2014'
    : `${Math.round(value)} ms`;

/*
 * What the total leaves out. It appears in the tooltip on the total and again in the footnote
 * under the table, because a figure this quotable has to carry its own qualifications
 * wherever someone reads it from.
 */
/* The one sentence worth repeating under every reading. The rest is in MeasurementHelp. */
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
      {/* In the head rather than beside the footnote, so it is there in every state of the
          panel: the question is asked most often when the panel is showing something
          unexpected, which is exactly when the footnote is a different footnote. */}
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
 * Why there is no stamp, named rather than listed.
 *
 * The panel used to offer three possibilities and leave the reader to work out which. It knows
 * the answer in the commonest case: the stamp is an H.264 SEI NAL, the stream's codec is in the
 * stats beside it, and a stream that is not H.264 was never going to carry one. Publishing to a
 * server that answers VP8 is exactly how this is met, and the codec selector is where it is
 * fixed.
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
      // Dropped rather than kept: a figure from the previous session would otherwise reappear
      // as though it described this one.
      setSample(null);
      return undefined;
    }

    setStartedAt(Date.now());
    setNow(Date.now());

    const unsubscribe = subscribe((next) => {
      // A subscribe that replays its current value hands over null before the first frame.
      // That is not a sample, and it must not stop the clock on the grace period.
      if (!next) return;
      setSample(next);
      setReceivedAt(Date.now());
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [listening]);

  // The stall and the grace period are both measured against wall time, so the panel has to
  // re-render without a new sample arriving. That is the only reason this ticker exists.
  useEffect(() => {
    if (!listening) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [listening]);

  if (!enabled) return null;

  /*
   * Checked even though the toggle is disabled in this case: the setting is remembered in a
   * cookie and can arrive in a share link, so the flag can be on in a browser that cannot
   * honour it. Silence there would read as a broken feature.
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
   * Two separate reasons to withhold a figure, and they are not the same reason. A stale
   * sample is a real measurement of a frame that has gone, so the last figures stay and are
   * greyed rather than flashing empty on one late frame. An unusable clock means there was
   * never a measurement to make, so nothing is shown at all.
   */
  const showFigures = clock.usable;

  const withUncertainty = (value) => {
    if (!showFigures || value === null || value === undefined) return '\u2014';
    return clock.uncertaintyMs
      ? `${ms(value)} \u00b1 ${Math.round(clock.uncertaintyMs)} ms`
      : ms(value);
  };

  /*
   * The missed count has a row of its own, so it is not repeated up here. What belongs in the
   * head is a state the rows cannot show: that the figures below are stale.
   */
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

      {/* The long form of this used to sit here in full. It is the kind of thing that is read
          once and then skipped over every time afterwards, so the line stays short and the
          rest moves behind the button. The stale warning is never hidden: it says the figures
          beside it are out of date, which cannot wait for a click. */}
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
