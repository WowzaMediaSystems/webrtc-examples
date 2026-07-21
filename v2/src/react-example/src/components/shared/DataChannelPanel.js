import React, { useState, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';

import * as DataChannelActions from '../../actions/dataChannelActions';
import * as ErrorsActions from '../../actions/errorsActions';
import { buildTextMessage } from '../../utils/DataChannelUtils';
import { CHAT_CHANNEL_LABEL } from '../../webrtc/attachDataChannel';

// Shared chat panel for the data channel. `context` selects which slice of the dataChannel store
// to read/write ('publish' | 'play'). Renders nothing unless data channels are enabled for that
// context. The input is only usable once the channel is open; sending routes through the handle
// stored by attachDataChannel.
const DataChannelPanel = ({ context }) => {
  const dispatch = useDispatch();

  const enabled = useSelector((state) =>
    context === 'publish'
      ? state.publishSettings.dataChannelsEnabled
      : state.playSettings.dataChannelsEnabled
  );
  const { handle, channel, messages } = useSelector((state) => state.dataChannel[context]);

  const [text, setText] = useState('');
  const logRef = useRef(null);

  // Keep the log scrolled to the newest message.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  if (!enabled) return null;

  // channel is null until one exists (publisher creates it before the offer; a player receives it
  // via ondatachannel). Before that there is nothing connecting yet, so show "not connected".
  const state = channel?.state ?? 'not connected';
  const isOpen = state === 'open' && handle != null;

  const stateBadgeClass = {
    open: 'badge-success',
    connecting: 'badge-secondary',
    closing: 'badge-warning',
    closed: 'badge-danger',
  }[state] || 'badge-secondary';

  const send = () => {
    const value = text.trim();
    if (!value || !isOpen) return;
    try {
      const { data, entry } = buildTextMessage(value);
      handle.send(data);
      dispatch(DataChannelActions.addDataChannelMessage(context, {
        ...entry,
        label: channel?.label ?? CHAT_CHANNEL_LABEL,
      }));
      setText('');
    } catch (e) {
      dispatch({ type: ErrorsActions.SET_ERROR_MESSAGE, message: 'Data channel send failed: ' + e.message });
    }
  };

  const renderContent = (message) =>
    message.binary
      ? `[binary ${message.byteLength} bytes] ${message.hex}`
      : message.text;

  return (
    <div className="card data-channel-panel mt-3" id={`data-channel-panel-${context}`}>
      <div className="card-header d-flex align-items-center justify-content-between">
        <span>Chat {channel?.label ? `(${channel.label})` : ''}</span>
        <span className={`badge ${stateBadgeClass}`}>{state}</span>
      </div>

      <div
        className="card-body p-2"
        ref={logRef}
        style={{ maxHeight: '240px', overflowY: 'auto' }}
      >
        {messages.length === 0 && (
          <div className="text-muted text-center small py-3">No messages yet</div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`d-flex mb-1 ${message.direction === 'sent' ? 'justify-content-end' : 'justify-content-start'}`}
          >
            <div className={`px-2 py-1 rounded ${message.direction === 'sent' ? 'bg-light border' : 'bg-light'}`}>
              <div className="text-break">{renderContent(message)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card-footer">
        <div className="input-group">
          <input
            type="text"
            className="form-control"
            placeholder={isOpen ? 'Type a message' : 'Waiting for channel to open...'}
            value={text}
            disabled={!isOpen}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          />
          <div className="input-group-append">
            <button type="button" className="btn" disabled={!isOpen} onClick={send}>
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DataChannelPanel;
