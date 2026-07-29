// Runtime state for the chat data channel, keyed by context ('publish' | 'play') since the same
// store backs both pages. See dataChannelReducer.
export const SET_DATA_CHANNEL_HANDLE = 'SET_DATA_CHANNEL_HANDLE';
export const SET_DATA_CHANNEL_STATE = 'SET_DATA_CHANNEL_STATE';
export const ADD_DATA_CHANNEL_MESSAGE = 'ADD_DATA_CHANNEL_MESSAGE';
export const SET_DATA_CHANNEL_CAPTION = 'SET_DATA_CHANNEL_CAPTION';
export const RESET_DATA_CHANNEL = 'RESET_DATA_CHANNEL';

// Action creators. `context` is always 'publish' | 'play'. Keeping the action shape here (rather
// than building it inline in each component) means Publisher and Player can't drift apart.

export const setDataChannelHandle = (context, handle) => ({
  type: SET_DATA_CHANNEL_HANDLE, context, handle,
});

export const setDataChannelState = (context, { label, id, state, local }) => ({
  type: SET_DATA_CHANNEL_STATE, context, label, id, state, local,
});

export const addDataChannelMessage = (context, message) => ({
  type: ADD_DATA_CHANNEL_MESSAGE, context, message,
});

// Latest caption line for the context, shown as a subtitle overlay on the video.
export const setCaption = (context, caption) => ({
  type: SET_DATA_CHANNEL_CAPTION, context, caption,
});

export const resetDataChannel = (context) => ({
  type: RESET_DATA_CHANNEL, context,
});
