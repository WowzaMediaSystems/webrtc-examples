/*
 * A wall clock drawn into the picture, so a latency figure can be checked by eye: photograph
 * the publisher preview and the player together and read off the difference.
 *
 * Drawn per captured frame via MediaStreamTrackProcessor, not on requestAnimationFrame, which
 * would add an unmeasured gap and stop in a background tab. Every frame is redrawn to a
 * canvas, so switch it on while looking, not permanently.
 */

import { CAMERA_SOURCE_KEY } from '../utils/VideoTrackUtils';

const MIN_TEXT_PX = 13;

/** Why this browser cannot do it, or null. */
export const burnedClockUnavailableReason = () => {
  if (typeof window === 'undefined') return 'The burned-in clock needs a browser.';
  if (typeof window.MediaStreamTrackProcessor !== 'function'
    || typeof window.MediaStreamTrackGenerator !== 'function') {
    return 'Needs MediaStreamTrackProcessor, which today means a Chromium browser: Chrome, '
      + 'Edge or Brave.';
  }
  if (typeof window.VideoFrame !== 'function' || typeof window.OffscreenCanvas !== 'function') {
    return 'Needs WebCodecs and OffscreenCanvas, which this browser does not have.';
  }
  return null;
};

export const isBurnedClockAvailable = () => burnedClockUnavailableReason() === null;

/** HH:MM:SS.mmm on a 24 hour clock, local time. */
export const formatClock = (epochMs) => {
  const at = new Date(epochMs);
  const pad = (value, width) => String(value).padStart(width, '0');
  return `${pad(at.getHours(), 2)}:${pad(at.getMinutes(), 2)}:${pad(at.getSeconds(), 2)}`
    + `.${pad(at.getMilliseconds(), 3)}`;
};

/*
 * Sized from the frame so it survives resolution drops. Below about 13px the digits stop
 * surviving the encoder at a low bitrate.
 */
export const textSizeFor = (frameHeight) => Math.max(MIN_TEXT_PX, Math.round(frameHeight / 18));

/**
 * Draws the clock onto a 2D context sized to the frame. White on a solid black plate, because
 * flat high contrast survives downscaling and a lossy codec.
 */
export const drawClock = (ctx, { width, height, text }) => {
  const size = textSizeFor(height);
  const padding = Math.round(size * 0.35);

  ctx.font = `600 ${size}px ui-monospace, "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  const textWidth = ctx.measureText(text).width;
  const plateWidth = Math.min(width, textWidth + padding * 2);
  const plateHeight = size + padding * 2;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, plateWidth, plateHeight);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, padding, padding);

  return { plateWidth, plateHeight };
};

/**
 * A video track carrying the source's frames with the time drawn on them. Returns
 * { track, stop }; `stop` never touches the source track. When unsupported, returns the
 * source track unchanged so the publish still works.
 */
/* Where a derived track records the camera behind it; the reader lives in VideoTrackUtils. */
const SOURCE = CAMERA_SOURCE_KEY;

export const burnClockIntoTrack = (sourceTrack, { now = Date.now } = {}) => {
  if (!sourceTrack || burnedClockUnavailableReason() !== null) {
    return { track: sourceTrack, stop: () => {} };
  }

  const processor = new MediaStreamTrackProcessor({ track: sourceTrack });
  const generator = new MediaStreamTrackGenerator({ kind: 'video' });

  let canvas = null;
  let ctx = null;

  const transformer = new TransformStream({
    transform(frame, controller) {
      try {
        const width = frame.displayWidth;
        const height = frame.displayHeight;

        // The encoder changes resolution under load, so the canvas follows the frame.
        if (canvas === null || canvas.width !== width || canvas.height !== height) {
          canvas = new OffscreenCanvas(width, height);
          ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
        }

        ctx.drawImage(frame, 0, 0, width, height);
        drawClock(ctx, { width, height, text: formatClock(now()) });

        // Keep the source timestamp so downstream does not see a new capture clock.
        controller.enqueue(new VideoFrame(canvas, {
          timestamp: frame.timestamp,
          duration: frame.duration ?? undefined,
        }));
      } catch {
        // Pass an undrawable frame through: a diagnostic must not take the video away.
        controller.enqueue(frame);
        return;
      }
      // Every processor frame must be closed or the pool runs dry and the camera stalls.
      frame.close();
    },
  });

  processor.readable
    .pipeThrough(transformer)
    .pipeTo(generator.writable)
    .catch(() => {
      // Expected on stop: the writable closes under the pipe. Nothing to report.
    });

  generator[SOURCE] = sourceTrack;

  return {
    track: generator,
    stop: () => {
      try {
        generator.stop();
      } catch {
        // Already stopped.
      }
    },
  };
};

/*
 * One derived track per camera, held here rather than in a component: a React effect cleanup
 * or an unmount would stop the track the sender is still publishing. Stopped only when the
 * camera changes or the setting goes off.
 */
let current = null;

/** The clock-bearing track for this camera, making it if there is not one already. */
export const clockedTrackFor = (sourceTrack) => {
  if (!sourceTrack) {
    releaseClockedTrack();
    return sourceTrack;
  }
  if (current && current.source === sourceTrack && current.track.readyState === 'live') {
    return current.track;
  }
  releaseClockedTrack();
  const made = burnClockIntoTrack(sourceTrack);
  current = { source: sourceTrack, track: made.track, stop: made.stop };
  return current.track;
};

/** Give up the derived track, if there is one. The camera is never touched. */
export const releaseClockedTrack = () => {
  if (!current) return;
  current.stop();
  current = null;
};
