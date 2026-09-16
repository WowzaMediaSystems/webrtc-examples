import DataChannelRequirements from '../constants/DataChannelRequirements';

// Wowza Streaming Engine before 4.12.0 doesn't understand the data channel section that Chat and
// Captions add to the offer. Over WebSocket signaling it never replies, over WHIP/WHEP it fails with a
// bare 500, and it never tells the browser its version. So when negotiation dies in one of those two
// shapes with Chat or Captions on, the best we can do is point at the version.

// How long the initial offer over WebSocket signaling waits for the engine to answer.
export const ANSWER_TIMEOUT_MS = 20000;

const DATA_CHANNEL_VERSION_HINT =
  `This can happen when running against Wowza Streaming Engine 4.11.x, which does not support Chat or ` +
  `Captions (they require ${DataChannelRequirements.minEngineVersion} or later). Try again with Chat and Captions disabled.`;

const dataChannelsRequested = (settings) => !!(settings.chatEnabled || settings.captionsEnabled);

export const getAnswerTimeoutMessage = (settings) => {
  const message = `No answer from the server after ${ANSWER_TIMEOUT_MS / 1000} seconds.`;
  return dataChannelsRequested(settings) ? `${message} ${DATA_CHANNEL_VERSION_HINT}` : message;
};

export const getWhipWhepFailureMessage = (label, status, settings) => {
  const message = `${label} request failed: ${status}.`;
  return status === 500 && dataChannelsRequested(settings) ? `${message} ${DATA_CHANNEL_VERSION_HINT}` : message;
};

// One pending answer timer per session, kept on the session so the message handler can clear it.
export const armAnswerTimeout = (session, onTimeout) => {
  clearAnswerTimeout(session);
  session.answerTimeout = setTimeout(() => {
    session.answerTimeout = null;
    onTimeout();
  }, ANSWER_TIMEOUT_MS);
};

export const clearAnswerTimeout = (session) => {
  if (session.answerTimeout == null) return;
  clearTimeout(session.answerTimeout);
  session.answerTimeout = null;
};
