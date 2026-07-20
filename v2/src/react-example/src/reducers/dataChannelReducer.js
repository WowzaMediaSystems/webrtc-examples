import * as DataChannelActions from '../actions/dataChannelActions';

// One slice per context. `handle` is the { send, close } object returned by attachDataChannel
// (used by the chat panel to send); `channel` is the current lifecycle state shown in the UI;
// `messages` is the chat log (both sent and received entries).
const emptyContext = () => ({ handle: undefined, channel: null, messages: [] });

const initialState = {
  publish: emptyContext(),
  play: emptyContext(),
};

const updateContext = (state, context, changes) => ({
  ...state,
  [context]: { ...state[context], ...changes },
});

const dataChannelReducer = (state = initialState, action) => {
  switch (action.type) {
    case DataChannelActions.SET_DATA_CHANNEL_HANDLE:
      return updateContext(state, action.context, { handle: action.handle });
    case DataChannelActions.SET_DATA_CHANNEL_STATE:
      return updateContext(state, action.context, {
        channel: { label: action.label, id: action.id, state: action.state, local: action.local },
      });
    case DataChannelActions.ADD_DATA_CHANNEL_MESSAGE:
      return updateContext(state, action.context, {
        messages: [...state[action.context].messages, action.message],
      });
    case DataChannelActions.RESET_DATA_CHANNEL:
      return { ...state, [action.context]: emptyContext() };
    default:
      return state;
  }
};

export default dataChannelReducer;
