// attachDataChannel wires ONE RTCDataChannel (identified by label) onto an existing
// RTCPeerConnection. Call it once per channel; this example uses two - "chat" and "captions".
//
// It MUST be called before the initial createOffer(): this example never renegotiates, so every
// channel's m-line has to be present in the first offer. A consequence the UI relies on is that
// data channels cannot be turned on or off mid-session - toggling the setting requires a full
// disconnect/reconnect.
//
// options:
//   - label:  the channel label ("chat", "captions", ...). Both sides agree on it.
//   - create: true  -> publisher: open the channel here (before the offer) so its m-line is
//                      negotiated up front, and both send and receive on it.
//             false -> player: don't open anything; wait for WSE to open the mirrored channel
//                      (pc.ondatachannel) and wire ONLY the one whose label matches. Requires the
//                      SCTP transport to already be negotiated - see createSctpBootstrap.
//
// A peer connection multiplexes channels by label: each surfaces on the other side as its own
// channel keyed by that label, so the receive side filters by label and a sibling attach handles
// the rest. Full-duplex chat needs create on the publisher and receive on the player; one-way
// captions are published from one side only (see captions.js).
//
// callbacks (all optional, matching the existing startPublish/startPlay callback style):
//   - onSetDataChannel({ label, dataChannel })              handle to send/close from the UI
//   - onDataChannelStateChange({ label, id, state, local }) state: connecting|open|closing|closed
//   - onDataChannelMessage({ label, id, data, binary })     data: string, or ArrayBuffer when binary
//   - onDataChannelError({ label, id, message })

// Channel labels used by this example, colocated so both live in one place. "chat" is the
// full-duplex text channel backing DataChannelPanel; "captions" is the one-way text channel
// driven by captions.js.
export const CHAT_CHANNEL_LABEL = "chat";
export const CAPTIONS_CHANNEL_LABEL = "captions";

// Player-only: create a negotiated (out-of-band) channel purely to force the SCTP m=application
// section into the offer. The player is the offerer and opens no channel of its own, so without
// this its offer would carry no SCTP section - and the answer can't add an m-line the offer didn't
// propose, so WSE could never open the in-band channels it mirrors to us and "datachannel" would
// never fire. Negotiated channels don't raise "datachannel" on either side, so this stays invisible
// and doesn't interfere with the real channels. Call once, before createOffer(); one bootstrap
// covers any number of received channels.
export const createSctpBootstrap = (peerConnection) => {
  peerConnection.createDataChannel("__sctp_bootstrap__", { negotiated: true, id: 0 });
};

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
  const { label, create = false } = options;
  let channel = null;

  const setChannel = (dc, local) => {
    channel = dc;
    wireChannel(dc, local, callbacks);
  };

  if (create) {
    // Publisher: open the channel here (before the offer) so its m-line is negotiated up front.
    setChannel(peerConnection.createDataChannel(label), true);
  } else {
    // Player: WSE opens the mirrored channel toward the browser. Wire only the channel whose label
    // matches; another attachDataChannel call handles the rest. (Requires createSctpBootstrap.)
    peerConnection.addEventListener("datachannel", (event) => {
      if (event.channel.label !== label) return;
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
    callbacks.onSetDataChannel({ label, dataChannel });

  return dataChannel;
};

export default attachDataChannel;
