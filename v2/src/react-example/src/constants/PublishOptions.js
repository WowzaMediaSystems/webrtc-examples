export const videoCodecs = [
  { value:"VP8", name:"VP8" },
  { value:"VP9", name:"VP9" },
  { value:"42e01f", name:"H.264" }
];

export const videoFrameSizes = [
  { value:"default", name:"Default" },
  { value:"1920x1080", name:"1920x1080" },
  { value:"1280x720", name:"1280x720" },
  { value:"800x600", name:"800x600" },
  { value:"640x360", name:"640x360" }
];

export const videoConstraintsByFrameSize = {
  "default":   {
    width: { min: "640", ideal: "1280", max: "1920" },
    height: { min: "360", ideal: "720", max: "1080" },
    frameRate: "30"
  },
  "1920x1080":   {
    width: { exact: "1920" },
    height: { exact: "1080" },
    frameRate: "30"
  },
  "1280x720": {
    width: { exact: "1280" },
    height: { exact: "720" },
    frameRate: "30"
  },
  "800x600": {
    width: { exact: "800" },
    height: { exact: "600" },
    frameRate: "30"
  },
  "640x360": {
    width: { exact: "640" },
    height: { exact: "360" },
    frameRate: "30"
  }
}

export const publishUrlParametersPrefix = "";

export const publishUrlParameters = [
  "signalingURL",
  "applicationName",
  "streamName",
  "audioBitrate",
  "audioCodec",
  "videoBitrate",
  "videoCodec",
  "videoFrameRate",
  "videoFrameSize"
]