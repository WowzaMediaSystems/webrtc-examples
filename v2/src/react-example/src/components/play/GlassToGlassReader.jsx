import React, { useEffect } from 'react';

import { decodeTimecode, latencyFromTimecode } from '../../utils/timecode';
import { createTimecodeReader } from '../../utils/timecodeStream';
import { logEvent } from '../../diagnostics/signalLog';

/*
 * Reads the publisher's timecode out of the decoded picture while connected, and logs the
 * implied delay. Renders nothing; an unstamped frame yields no measurement, not zero.
 *
 * Publisher-side stamping is not yet wired into the publish path, so today this is silent on
 * ordinary streams. Only valid when both ends share a clock.
 */

const SAMPLE_INTERVAL_MS = 250;

// Median of a short window, to ride over a single misread.
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

      // Announce only once the window is full, so the logged median is a real median.
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
