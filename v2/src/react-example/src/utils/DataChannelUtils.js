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
