export const SET_PLAY_SIGNALING_URL='SET_PLAY_SIGNALING_URL';
export const SET_PLAY_STUN_SERVER_URL='SET_PLAY_STUN_SERVER_URL';
export const SET_PLAY_APPLICATION_NAME='SET_PLAY_APPLICATION_NAME';
export const SET_PLAY_STREAM_NAME='SET_PLAY_STREAM_NAME';
export const SET_PLAY_SECRET = 'SET_PLAY_SECRET';
export const SET_PLAY_TIMEOUT = 'SET_PLAY_TIMEOUT';
export const SET_PLAY_PREFIX = 'SET_PLAY_PREFIX';
export const SET_PLAY_IS_IP = 'SET_PLAY_IS_IP';
export const SET_PLAY_IP = 'SET_PLAY_IP';
export const SET_PLAY_FLAGS='SET_PLAY_FLAGS';
export const SET_PLAY_USE_WHEP = 'SET_PLAY_USE_WHEP';

export const startPlay = () => {
  return {
    type: SET_PLAY_FLAGS,
    playStart: true
  }
}

export const stopPlay = () => {
  return {
    type: SET_PLAY_FLAGS,
    playStop: true
  }
}