export const videoFrameSizes = [
  { value:"default", name:"Default" },
  { value:"1920x1080", name:"1920x1080" },
  { value:"1280x720", name:"1280x720" },
  { value:"800x600", name:"800x600" },
  { value:"640x360", name:"640x360" }
];

/*
 * Frame size constraints.
 *
 * "default" deliberately carries no width or height constraint at all. It previously used
 * min 640x360 / max 1920x1080, but `min` is a hard requirement in getUserMedia, not a hint,
 * so any camera that could not reach 640x360 failed with OverconstrainedError the moment the
 * page loaded - under an option labelled "Default". Leaving it unconstrained lets the browser
 * pick whatever the camera natively supports, which is what "default" should mean.
 *
 * The explicit sizes keep `exact`, because asking for 1280x720 and silently getting something
 * else would make the option meaningless. Those legitimately fail on a camera that cannot do
 * them, and the error message for that case is accurate.
 *
 * Values are numbers: ConstrainULong is numeric, and strings only worked by coercion.
 */
export const videoConstraintsByFrameSize = {
  "default": {
    frameRate: { ideal: 30 }
  },
  "1920x1080": {
    width: { exact: 1920 },
    height: { exact: 1080 },
    frameRate: { ideal: 30 }
  },
  "1280x720": {
    width: { exact: 1280 },
    height: { exact: 720 },
    frameRate: { ideal: 30 }
  },
  "800x600": {
    width: { exact: 800 },
    height: { exact: 600 },
    frameRate: { ideal: 30 }
  },
  "640x360": {
    width: { exact: 640 },
    height: { exact: 360 },
    frameRate: { ideal: 30 }
  }
}
export const publishUrlParametersPrefix = "";

export const publishUrlParameters = [
  "signalingURL",
  "applicationName",
  "streamName",
  "videoFrameRate",
  "videoFrameSize"
]