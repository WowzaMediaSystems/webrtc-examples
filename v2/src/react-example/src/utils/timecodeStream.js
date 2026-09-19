import { blockSize, drawTimecode } from './timecode';

/*
 * Wraps a camera track in a canvas that stamps every frame with the current time.
 *
 * The stamped track is what gets published and what the local preview shows, so both sides
 * of a round trip carry the same marks and the delay between them is the real one.
 *
 * Two details are load bearing, both found by measurement rather than reasoning.
 *
 * The source element is attached to the document, off-screen. Detached, it presents frames
 * for a while and then stops: the canvas froze the moment the page got busy, the published
 * track went black, and the player received nothing decodable while the publisher's own
 * preview still looked fine for a second or two.
 *
 * And the loop is driven by requestAnimationFrame rather than requestVideoFrameCallback.
 * rVFC is the better signal in principle, because it fires when a frame actually arrives,
 * but on an off-screen element it is throttled to a stop for the same reason.
 */

export const createTimecodeStream = (sourceTrack, { now = () => Date.now() } = {}) => {
  const settings = sourceTrack.getSettings ? sourceTrack.getSettings() : {};
  const width = settings.width || 1280;
  const height = settings.height || 720;
  const frameRate = settings.frameRate || 30;

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  // Off-screen but in the document: see the note above.
  video.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
  document.body.appendChild(video);
  video.srcObject = new MediaStream([sourceTrack]);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: false });

  let stopped = false;
  let rafId = null;

  const paint = () => {
    if (stopped) return;
    // The source can change size mid-session (a constraint change, a different camera).
    if (video.videoWidth && video.videoWidth !== canvas.width) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    if (video.videoWidth) {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      drawTimecode(context, canvas.width, canvas.height, now());
    }
    schedule();
  };

  const schedule = () => {
    if (stopped) return;
    rafId = window.requestAnimationFrame(paint);
  };

  const started = video.play().catch(() => {
    // Autoplay of a muted, source-less-of-audio element is allowed; if it is refused the
    // draw loop still runs, it just has nothing to draw until the element starts.
  });
  Promise.resolve(started).then(schedule);

  const stream = canvas.captureStream(frameRate);
  const track = stream.getVideoTracks()[0];

  const stop = () => {
    stopped = true;
    if (rafId !== null) window.cancelAnimationFrame(rafId);
    try { video.pause(); } catch { /* already stopped */ }
    video.srcObject = null;
    video.remove();
    // The canvas track is ours; the camera track belongs to the device registry.
    try { track.stop(); } catch { /* already stopped */ }
  };

  return { track, stop, canvas };
};

/*
 * Reads the stamp back out of a decoded <video>.
 *
 * Sampling the element rather than the stream is the point: this is the picture as it is
 * about to be shown, so everything between the two - encode, the Engine, the network, the
 * jitter buffer, decode - is inside the measurement.
 */
export const createTimecodeReader = (videoElement) => {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });

  return {
    /** The luminance sampler for decodeTimecode, or null when there is nothing to read. */
    sampler() {
      const width = videoElement.videoWidth;
      const height = videoElement.videoHeight;
      if (!width || !height) return null;

      const size = blockSize(width);
      // Only the strip the blocks live in is copied, which keeps this cheap enough to run
      // several times a second on a 1080p picture.
      const stripHeight = Math.min(height, size);
      if (canvas.width !== width || canvas.height !== stripHeight) {
        canvas.width = width;
        canvas.height = stripHeight;
      }

      context.drawImage(videoElement, 0, 0, width, stripHeight, 0, 0, width, stripHeight);

      let strip;
      try {
        strip = context.getImageData(0, 0, width, stripHeight);
      } catch {
        // A tainted canvas cannot be read; there is no measurement to be had here.
        return null;
      }

      const y = Math.min(stripHeight - 1, Math.round(size / 2));
      return (index) => {
        const x = Math.round(index * size + size / 2);
        if (x >= width) return null;
        const offset = (y * width + x) * 4;
        const [r, g, b] = [strip.data[offset], strip.data[offset + 1], strip.data[offset + 2]];
        // Rec. 601 luma: the codec works in this space, so the reader should too.
        return 0.299 * r + 0.587 * g + 0.114 * b;
      };
    },
  };
};
