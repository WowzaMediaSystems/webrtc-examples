// attachDataChannel wires a single RTCDataChannel onto an existing RTCPeerConnection.
//
// It MUST be called before the initial createOffer(): this example never renegotiates, so
// the SCTP m-line has to be present in the first offer. A consequence the UI relies on is
// that the data channel cannot be turned on or off mid-session - toggling the setting requires
// a full disconnect/reconnect.
//
// A data channel is full-duplex, so a single channel carries both directions of the chat:
//   - the publisher opens the channel (pass options.label) and both broadcasts on it and
//     receives what players send back over it (WSE muxes every viewer's backchannel onto this
//     one channel; per-viewer identity, if needed, comes from the message envelope, not from
//     separate channels - the publisher has a single peer connection to WSE regardless of
//     audience size).
//   - a player does not open anything (omit options.label); it waits for WSE to open the
//     mirrored channel (pc.ondatachannel), then receives the broadcast and writes back on it.
//
// callbacks (all optional, matching the existing startPublish/startPlay callback style):
//   - onSetDataChannel({ dataChannel })              handle to send/close from the UI
//   - onDataChannelStateChange({ label, id, state, local })   state: connecting|open|closing|closed
//   - onDataChannelMessage({ label, id, data, binary })       data: string, or ArrayBuffer when binary
//   - onDataChannelError({ label, id, message })

// The single chat channel's label. The publisher opens the channel under this label and WSE
// mirrors it to players under the same label. Hardcoded because the example uses exactly one
// channel; it is not a user-facing choice.
//
// A peer connection can carry many data channels at once, multiplexed by label: you would call
// createDataChannel("chat"), createDataChannel("metadata"), createDataChannel("control"), etc.,
// each surfacing on the other side as its own channel (pc.ondatachannel) keyed by that label,
// and route/display messages per channel. This example intentionally uses just one ("chat") to
// keep the demo focused; supporting several would mean tracking channels by label (e.g. a Map)
// and letting the UI pick which one to send on.
export const CHAT_CHANNEL_LABEL = "chat";

const readyStateToState = (readyState) => {
  switch (readyState) {
    case "connecting": return "connecting";
    case "open": return "open";
    case "closing": return "closing";
    case "closed": return "closed";
    default: return readyState;
  }
};

const wireChannel = (channel, local, callbacks) => {
  // Deliver binaries as ArrayBuffer rather than the browser-dependent default (Blob in some).
  channel.binaryType = "arraybuffer";

  const emitState = () => {
    if (callbacks.onDataChannelStateChange)
      callbacks.onDataChannelStateChange({
        label: channel.label,
        id: channel.id,
        state: readyStateToState(channel.readyState),
        local,
      });
  };

  // A locally-created channel is already "connecting" when we get here, so surface that
  // immediately; the "open" transition still comes through onopen below.
  emitState();

  channel.onopen = emitState;
  channel.onclosing = emitState;
  channel.onclose = emitState;

  channel.onmessage = (event) => {
    if (callbacks.onDataChannelMessage)
      callbacks.onDataChannelMessage({
        label: channel.label,
        id: channel.id,
        data: event.data,
        binary: event.data instanceof ArrayBuffer,
      });
  };

  channel.onerror = (event) => {
    const message = event?.error?.message || "Data channel error";
    if (callbacks.onDataChannelError)
      callbacks.onDataChannelError({ label: channel.label, id: channel.id, message });
  };
};

const attachDataChannel = (peerConnection, callbacks = {}, options = {}) => {
  const { label } = options;
  let channel = null;

  const setChannel = (dc, local) => {
    channel = dc;
    wireChannel(dc, local, callbacks);
  };

  if (label) {
    // Publisher: open the channel here (before the offer) so its m-line is negotiated up front.
    setChannel(peerConnection.createDataChannel(label), true);
  } else {
    // Player: WSE opens the mirrored channel toward the browser.
    peerConnection.addEventListener("datachannel", (event) => {
      setChannel(event.channel, false);
    });
  }

  const dataChannel = {
    // data: a string (sent as text) or an ArrayBuffer/ArrayBufferView (sent as binary).
    send: (data) => {
      if (!channel || channel.readyState !== "open")
        throw new Error("Data channel is not open");
      channel.send(data);
    },
    close: () => {
      if (channel) channel.close();
    },
  };

  if (callbacks.onSetDataChannel)
    callbacks.onSetDataChannel({ dataChannel });

  return dataChannel;
};

export default attachDataChannel;
