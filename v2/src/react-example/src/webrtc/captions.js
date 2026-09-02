// Fake live captions over a second, one-way (publisher -> players) text data channel.
//
// This is the counterpart to the chat channel and exists to show a single peer connection carrying
// more than one data channel at once, multiplexed by label. The publisher creates the "captions"
// channel and, while it is open, cycles a fixed pool of placeholder lines on a timer; players
// receive them and render them as subtitles over the video. Nothing is ever sent back on this one.

import { CAPTIONS_CHANNEL_LABEL } from "./attachDataChannel";

const CAPTION_INTERVAL_MS = 3000;

// Placeholder subtitle lines. Purely cosmetic - cycled in order, wrapping around.
const CAPTION_PHRASES = [
  "Welcome to the live stream.",
  "These captions travel over a WebRTC data channel.",
  "This is a second channel, separate from chat.",
  "The publisher sends; every viewer receives.",
  "Captions are plain text, one message per line.",
  "No renegotiation is needed once the channel is open.",
  "The chat channel runs at the same time as this one.",
  "Data channels are handy for timed metadata like this.",
  "This line will loop back to the beginning soon.",
  "Thanks for watching this WebRTC example.",
];

// Publisher side: create the captions channel and, once it is open, cycle the phrase pool on a
// timer, sending one line per tick. `onCaption(text)` (optional) fires for every line sent so the
// publish UI can mirror what viewers see. Returns a stop() that clears the timer and releases the
// channel; the timer also self-stops when the channel closes.
export const startCaptionBroadcast = (peerConnection, onCaption) => {
  const channel = peerConnection.createDataChannel(CAPTIONS_CHANNEL_LABEL);
  let timer = null;
  let index = 0;

  const stopTimer = () => {
    if (timer) { clearInterval(timer); timer = null; }
  };

  channel.onopen = () => {
    timer = setInterval(() => {
      const text = CAPTION_PHRASES[index % CAPTION_PHRASES.length];
      index++;
      try {
        channel.send(text);
      } catch (_) {
        stopTimer(); // channel went away between ticks; nothing more to send
        return;
      }
      if (onCaption) onCaption(text);
    }, CAPTION_INTERVAL_MS);
  };

  channel.onclose = stopTimer;

  return () => { stopTimer(); channel.close(); };
};
