import { configureStore } from '@reduxjs/toolkit';

import rootReducer from './reducers/rootReducer';

// configureStore wires up the Redux DevTools extension and the default middleware,
// so the deprecated createStore() call and the separate devtools package are both gone.
//
// The WebRTC reducers deliberately hold live MediaStream, RTCPeerConnection and
// RTCDataChannel objects. Those are not serializable and must not be walked on every
// action, so both development-only checks are turned off here rather than left to
// flood the console.
const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
      immutableCheck: false,
    }),
});

export default store;
