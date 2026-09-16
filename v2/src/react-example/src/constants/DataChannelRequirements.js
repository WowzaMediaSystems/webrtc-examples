// Chat and Captions ride on a WebRTC data channel, which Wowza Streaming
// Engine only supports from 4.12.0 on.
const DataChannelRequirements = {
  minEngineVersion: "4.12.0",
  hint: "Chat and Captions require Wowza Streaming Engine 4.12.0 or later."
}

export default DataChannelRequirements;
