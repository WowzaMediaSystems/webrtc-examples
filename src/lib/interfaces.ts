/*
 *  Typescript migration by @farandal - Francisco Aranda - farandal@gmail.com - http://linkedin.com/in/farandal
 * 
 */

export interface IStreamInfo {
  applicationName?: string,
  streamName?: string,
  sessionId?: string // "[empty]"
}

export interface IMediaInfo {
  videoBitrate:string,
  audioBitrate:string,
  videoFrameRate: string,
  videoCodec: string,
  audioCodec:string
}
export interface ICallbacks {
  onStats?: Function,
  onError?: Function,
  onSoundMeter?: Function,
  onCameraChanged?: Function,
  onMicrophoneChanged?: Function,
  onStateChanged?: Function
} 