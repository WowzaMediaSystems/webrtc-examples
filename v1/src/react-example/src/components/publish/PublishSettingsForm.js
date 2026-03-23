import React from 'react';
import { useSelector, useDispatch } from 'react-redux';

import * as PublishSettingsActions from '../../actions/publishSettingsActions';
import * as PublishOptions from '../../constants/PublishOptions';
import PublishAudioDropdown from './PublishAudioDropdown';
import PublishVideoDropdown from './PublishVideoDropdown';

const PublishSettingsForm = () => {

  const dispatch = useDispatch();
  const publishSettings = useSelector ((state) => state.publishSettings);
  const webrtcPublish = useSelector ((state) => state.webrtcPublish);

  return (
    <div className="col-md-4 col-sm-12" id="publish-settings">
      <form id="publish-settings-form">
        <div className="row">
          <div className="col-12">
            <div className="form-group">
              <label htmlFor="sdpURL">Signaling URL</label>
              <input type="text"
                className="form-control"
                id="signalingURL"
                name="signalingURL"
                maxLength="1024"
                placeholder="wss://[ssl-certificate-domain-name]/webrtc-session.json"
                value={publishSettings.signalingURL}
                onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_SIGNALING_URL,signalingURL:e.target.value})}
              />
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-lg-6 col-sm-12">
            <div className="form-group">
              <label htmlFor="applicationName">Application Name</label>
              <input type="text"
                className="form-control"
                id="applicationName"
                name="applicationName"
                maxLength="256"
                value={publishSettings.applicationName}
                onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_APPLICATION_NAME,applicationName:e.target.value})}
              />
            </div>
          </div>
          <div className="col-lg-6 col-sm-12">
            <div className="form-group">
              <label htmlFor="streamName">Stream Name</label>
              <input type="text"
                className="form-control"
                id="streamName"
                name="streamName"
                maxLength="256"
                value={publishSettings.streamName}
                onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_STREAM_NAME,streamName:e.target.value})}
              />
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-lg-6 col-sm-12">
            <div className="form-group">
              <label htmlFor="audioBitrate">Audio Bitrate</label>
              <div className="input-group">
                <input type="number"
                  className="form-control"
                  id="audioBitrate"
                  name="audioBitrate"
                  value={publishSettings.audioBitrate}
                  onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_AUDIO_BITRATE,audioBitrate:e.target.value})}
                  />
                <div className="input-group-append">
                  <span className="input-group-text">Kbps</span>
                </div>
              </div>
            </div>
          </div>
          <div className="col-lg-6 col-sm-12">
            <div className="form-group">
              <label htmlFor="audioCodec">Audio Codec</label>
              <div className="input-group">
                <select className="form-control" id="audioCodec" name="audioCodec" value="opus" readOnly>
                  <option value="opus">Opus</option>
                </select>
              </div>
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-lg-6 col-sm-12">
            <div className="form-group">
              <label htmlFor="videoBitrate">Video Bitrate</label>
              <div className="input-group">
                <input type="number"
                  className="form-control"
                  id="videoBitrate"
                  name="videoBitrate"
                  value={publishSettings.videoBitrate}
                  onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_VIDEO_BITRATE,videoBitrate:e.target.value})}
                />
                <div className="input-group-append">
                  <span className="input-group-text">Kbps</span>
                </div>
              </div>
            </div>
          </div>
          <div className="col-lg-6 col-sm-12">
            <div className="form-group">
              <label htmlFor="videoCodec">Video Codec</label>
              <div className="input-group">
                <select className="form-control"
                  id="videoCodec"
                  name="videoCodec"
                  value={publishSettings.videoCodec}
                  onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_VIDEO_CODEC,videoCodec:e.target.value})}
                >
                  { PublishOptions.videoCodecs.map((codec,key) => {
                    return <option key={key} value={codec.value}>{codec.name}</option>
                  })}
                </select>
              </div>
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-10">
            <PublishVideoDropdown />
          </div>
          <div className="col-2">
            <button id="camera-toggle" className="control-button">
              <img alt="" className="noll" id="video-off" src="/images/videocam-32px.svg" />
              <img alt="" className="noll" id="video-on" src="/images/videocam-off-32px.svg" />
            </button>
          </div>
        </div>
        <div className="row">
          <div className="col-10">
            <PublishAudioDropdown />
          </div>
          <div className="col-2">
            <button id="mute-toggle" className="control-button">
              <img alt="" className="noll" id="mute-off" src="/images/mic-32px.svg" />
              <img alt="" className="noll" id="mute-on" src="/images/mic-off-32px.svg" />
            </button>
          </div>
        </div>
        <div className="row">
          <div className="col-10">
            { !webrtcPublish.connected &&
              <button id="publish-toggle" type="button" className="btn"
                disabled={publishSettings.publishStarting }
                onClick={(e)=>dispatch(PublishSettingsActions.startPublish())}
              >Publish</button>
            }
            { webrtcPublish.connected &&
              <button id="publish-toggle" type="button" className="btn"
                onClick={(e)=>dispatch(PublishSettingsActions.stopPublish())}
              >Stop</button>
            }
          </div>
          <div className="col-2">
            <button id="publish-share-link" type="button" className="control-button mt-0">
              <img alt="" className="noll" id="mute-off" src="/images/file_copy-24px.svg" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

  export default PublishSettingsForm;
