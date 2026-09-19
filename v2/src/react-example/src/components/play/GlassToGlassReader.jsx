import React, { useEffect } from 'react';

import { decodeTimecode, latencyFromTimecode } from '../../utils/timecode';
import { createTimecodeReader } from '../../utils/timecodeStream';
import { logEvent } from '../../diagnostics/signalLog';

/*
 * Reads the publisher's timecode out of the decoded picture.
 *
 * Nothing is rendered. It exists only while the player is connected, samples a few times a
 * second, and reports what it finds. A frame with no timecode in it reads as nothing rather
 * than as zero, so a stream from a publisher that is not stamping simply produces no
 * measurement.
 *
 * Half of a feature, and deliberately kept rather than hidden: the reader works, and the
 * publisher-side stamping is not yet wired into the publish path (see timecodeStream.js and
 * the note in that file about who owns the media stream). So today this finds nothing on an
 * ordinary stream and stays silent, and the moment a stamped stream does arrive it says so
 * in the log with the delay it implies.
 *
 * The reading is only meaningful when both ends share a clock. On the combined page they
 * are the same browser, so it is exact. Across two machines it is the clock difference plus
 * the latency, which is why the log line says so.
 */

const SAMPLE_INTERVAL_MS = 250;

// Two readings that disagree wildly mean one of them was misread; the median of a short
// window is steadier than the last value without hiding a real change.
const WINDOW = 5;

const GlassToGlassReader = ({ videoElementId = 'player-video', connected }) => {
  useEffect(() => {
    if (!connected) return undefined;

    const element = document.getElementById(videoElementId);
    if (!element) return undefined;

    const reader = createTimecodeReader(element);
    const recent = [];
    let announced = false;
    let timer = null;

    const tick = () => {
      const sampler = reader.sampler();
      const value = sampler ? decodeTimecode(sampler) : null;
      const latency = latencyFromTimecode(value, Date.now());

      if (latency === null) {
        recent.length = 0;
        return;
      }

      recent.push(latency);
      if (recent.length > WINDOW) recent.shift();

      /*
       * Once the window is full, not on the first reading. It announced immediately, so the
       * median it logged was the median of one sample: the smoothing this reader exists for
       * never took part in the number anybody saw.
       */
      if (!announced && recent.length === WINDOW) {
        announced = true;
        const sorted = [...recent].sort((a, b) => a - b);
        logEvent('info', 'pc', 'play glass-to-glass timecode found in the picture', {
          readingMs: Math.round(sorted[Math.floor(sorted.length / 2)]),
          note: 'Measured from the timestamp drawn into the frame, so it includes capture, '
            + 'encode, the Engine, the network, the jitter buffer and decode. Only valid '
            + 'while both ends share a clock.',
        });
      }
    };

    timer = window.setInterval(tick, SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [connected, videoElementId]);

  return null;
};

export default GlassToGlassReader;
