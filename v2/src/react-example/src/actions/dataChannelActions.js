// Runtime state for the chat data channel, keyed by context ('publish' | 'play') since the same
// store backs both pages. See dataChannelReducer.
export const SET_DATA_CHANNEL_HANDLE = 'SET_DATA_CHANNEL_HANDLE';
export const SET_DATA_CHANNEL_STATE = 'SET_DATA_CHANNEL_STATE';
export const ADD_DATA_CHANNEL_MESSAGE = 'ADD_DATA_CHANNEL_MESSAGE';
export const RESET_DATA_CHANNEL = 'RESET_DATA_CHANNEL';
