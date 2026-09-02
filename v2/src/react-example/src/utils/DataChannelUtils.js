// Helpers for turning raw data channel payloads into plain, serializable chat-log entries.

const toHex = (arrayBuffer) =>
  Array.from(new Uint8Array(arrayBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');

// Normalize an inbound onDataChannelMessage payload (from attachDataChannel) into a log entry.
// Binary arrives as an ArrayBuffer; we keep a hex rendering plus the byte length so the panel
// never has to hold the raw buffer in the store.
export const describeReceivedMessage = ({ label, data, binary }) => {
  if (binary) {
    return { direction: 'received', label, binary: true, byteLength: data.byteLength, hex: toHex(data) };
  }
  return { direction: 'received', label, binary: false, text: data };
};

// Build the payload to send plus its matching log entry. `data` goes to dataChannel.send();
// `entry` (minus its label, which the panel fills in from the live channel) is appended to the log.
//
// Data channels also carry binary payloads (send an ArrayBuffer/ArrayBufferView and it arrives as
// an ArrayBuffer on the other side; describeReceivedMessage already renders inbound binary). This
// example only sends text to keep the chat simple, so there is no binary send path here.
export const buildTextMessage = (text) => ({
  data: text,
  entry: { direction: 'sent', binary: false, text },
});
