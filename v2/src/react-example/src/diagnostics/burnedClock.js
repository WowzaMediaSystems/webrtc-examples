/*
 * A wall clock drawn into the picture, so a latency figure can be checked by eye.
 *
 * The frame stamp the probe uses is invisible: it rides inside the encoded bitstream and only
 * the panel can read it. This is the opposite. It puts the time on the frame in digits, so a
 * publisher preview and a player showing the same stream can be photographed together and the
 * difference read off them. It proves nothing to the software and everything to a person.
 *
 * It is drawn per captured frame, not on a render tick. MediaStreamTrackProcessor hands over
 * each frame the camera produced, so the time written on a frame is the time that frame passed
 * through, within one frame interval. Drawing on requestAnimationFrame instead would put an
 * unmeasured gap between capture and stamp, and would stop entirely when the tab is in the
 * background, which is exactly when someone is comparing two windows.
 *
 * The cost is honest: every frame is decoded to a canvas and re-wrapped, so this is a
 * diagnostic to switch on while looking, not something to leave running.
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

/**
 * HH:MM:SS.mmm on a 24 hour clock, local time.
 *
 * Local rather than UTC because the two screens being compared are in front of the same
 * person. Milliseconds are the whole point: without them the display cannot resolve anything
 * under a second, which is the range this is used in.
 */
export const formatClock = (epochMs) => {
  const at = new Date(epochMs);
  const pad = (value, width) => String(value).padStart(width, '0');
  return `${pad(at.getHours(), 2)}:${pad(at.getMinutes(), 2)}:${pad(at.getSeconds(), 2)}`
    + `.${pad(at.getMilliseconds(), 3)}`;
};

/*
 * Sized from the frame, not fixed, so it stays legible when the encoder drops the resolution
 * and does not swamp a small one. A floor in pixels, because below about 13px the digits stop
 * surviving the encoder at a low bitrate.
 */
export const textSizeFor = (frameHeight) => Math.max(MIN_TEXT_PX, Math.round(frameHeight / 18));

/**
 * Draws the clock onto a 2D context sized to the frame.
 *
 * Solid black plate behind white digits: this has to survive being scaled down and squeezed
 * through a lossy codec, and flat high contrast is what does that. Exported so the drawing can
 * be tested without a camera.
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
 * A video track carrying the source's frames with the time drawn on them.
 *
 * Returns { track, stop }. `stop` ends the derived track and releases the pipeline; it never
 * touches the source track, which belongs to whoever opened the camera.
 *
 * Returns { track: sourceTrack, stop } unchanged when this browser cannot do it, so a caller
 * that forgets to check the reason still gets a working publish rather than none.
 */
/*
 * Where a derived track records the camera behind it. The reader lives in VideoTrackUtils,
 * because "which track is the camera" is a question about tracks, not about latency.
 */
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

        // The source frame's own timestamp is carried over, so nothing downstream sees this
        // as a new capture with a new clock.
        controller.enqueue(new VideoFrame(canvas, {
          timestamp: frame.timestamp,
          duration: frame.duration ?? undefined,
        }));
      } catch {
        // A frame that cannot be drawn is passed through rather than dropped: a diagnostic
        // must not take the video away.
        controller.enqueue(frame);
        return;
      }
      // Every frame taken from the processor has to be closed or the pool runs dry and the
      // camera stalls after a few dozen frames.
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
 * One derived track per camera, held here rather than by whichever component asked for it.
 *
 * The first version tied the pipeline to a React effect and stopped it in the effect's
 * cleanup. The effect re-runs for reasons that have nothing to do with the camera, and each
 * re-run stopped the track the sender was already publishing: the publish went to three
 * encoded frames and stayed there. Unmounting is just as bad, because switching sides on the
 * combined page unmounts the settings form while the publish carries on.
 *
 * So the lifetime follows the thing it depends on. The same camera gets the same derived
 * track, and it is stopped only when the camera changes or the setting goes off.
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
