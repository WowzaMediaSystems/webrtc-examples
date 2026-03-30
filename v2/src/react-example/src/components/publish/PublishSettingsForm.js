import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import * as ErrorsActions from '../../actions/errorsActions';
import * as PublishSettingsActions from '../../actions/publishSettingsActions';
import * as PublishOptions from '../../constants/PublishOptions';
import PublishAudioDropdown from './PublishAudioDropdown';
import PublishVideoDropdown from './PublishVideoDropdown';
import Cookies from 'js-cookie';
import QueryString from 'query-string';
import { getCookieValues } from '../../utils/CookieUtils';
import CookieName from '../../constants/CookieName';

const publishUrlParametersMap = {
  signalingURL: "publishSignalingURL",
  stunServerURL: "publishStunServerURL",
  applicationName: "publishApplicationName",
  streamName: "publishStreamName",
  useWhip: "publishUseWhip"
};

const PublishSettingsForm = () => {

  const dispatch = useDispatch();
  const publishSettings = useSelector((state) => state.publishSettings);
  const webrtcPublish = useSelector((state) => state.webrtcPublish);

  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const SIGNALING_URL_PLACEHOLDER = "wss://[ssl-certificate-domain-name]/webrtc-session.json";
  const WHIP_URL_PLACEHOLDER = "https://[ssl-certificate-domain-name]:[port]/";
  const [urlPlaceholder, setUrlPlaceholder] = useState(SIGNALING_URL_PLACEHOLDER);

  const [initialized, setInitialized] = useState(true);

  const isValidStunUrl = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'stun:';
    } catch {
      return false;
    }
  }

  useEffect(() => {
    const cookieValues = getCookieValues(CookieName);
    const queryParams = QueryString.parse(window.location.search);
    const savedValues = { ...cookieValues, ...queryParams };

    const actionMap = {
      signalingURL: PublishSettingsActions.SET_PUBLISH_SIGNALING_URL,
      stunServerURL: PublishSettingsActions.SET_PUBLISH_STUN_SERVER_URL,
      applicationName: PublishSettingsActions.SET_PUBLISH_APPLICATION_NAME,
      streamName: PublishSettingsActions.SET_PUBLISH_STREAM_NAME,
      useWhip: PublishSettingsActions.SET_PUBLISH_USE_WHIP,
    };

    Object.entries(publishUrlParametersMap).forEach(([stateKey, cookieKey]) => {
      const value = savedValues[cookieKey];
      if (value != null) {
        const actionType = actionMap[stateKey];
        if (actionType) {
          const payload = stateKey === 'useWhip'
            ? { [stateKey]: value === 'true' || value === true }
            : { [stateKey]: value };
          dispatch({ type: actionType, ...payload });
        }
      }
    });

    setInitialized(true);
  }, [dispatch]);

  useEffect(() => {
    const cookieValues = getCookieValues(CookieName);

    Object.entries(publishUrlParametersMap).forEach(([stateKey, cookieKey]) => {
      if (publishSettings[stateKey] != null) {
        cookieValues[cookieKey] = publishSettings[stateKey];
      }
    });

    Cookies.set(CookieName, escape(JSON.stringify(cookieValues)));
  }, [publishSettings]);


  const toggleCamera = () => {
    setIsCameraOn(!isCameraOn);
    dispatch({ type: PublishSettingsActions.TOGGLE_VIDEO_ENABLED })
  };

  const toggleMicrophone = () => {
    setIsMicOn(!isMicOn);
    dispatch({ type: PublishSettingsActions.TOGGLE_AUDIO_ENABLED })
  }


  useEffect(() => {
    const track = publishSettings.videoTrack;

    if (!track || !track.applyConstraints) return;

    const constraints =
      PublishOptions.videoConstraintsByFrameSize[
      publishSettings.videoFrameSize
      ];

    if (!constraints) return;

    const newConstraints = {
      width: constraints.width,
      height: constraints.height,
      frameRate: publishSettings.videoFrameRate
    };

    console.log("Applying preview constraints:", newConstraints);

    track.applyConstraints(newConstraints)
      .then(() => {
        console.log("Preview updated");
      })
      .catch((error) => {

        console.error("Constraint error:", error);

        let message = error.message;

        if (error.name === "OverconstrainedError") {
          message = `Your browser or camera does not support this frame size: ${publishSettings.videoFrameSize}`;
        }

        dispatch({
          type: ErrorsActions.SET_ERROR_MESSAGE,
          message
        });

        if (publishSettings.videoFrameSize !== "default") {
          dispatch({
            type: PublishSettingsActions.SET_PUBLISH_VIDEO_FRAME_SIZE_AND_RATE,
            videoFrameSize: "default"
          });
        }

      });

  }, [
    dispatch,
    publishSettings.videoFrameSize,
    publishSettings.videoFrameRate,
    publishSettings.videoTrack
  ]);

  const handleUseWhip = (actionType, key) => (e) => {
    if (e.target.checked) {
      setUrlPlaceholder(WHIP_URL_PLACEHOLDER);
    } else {
      setUrlPlaceholder(SIGNALING_URL_PLACEHOLDER);
    }
    dispatch({ type: actionType, [key]: e.target.checked });
  };

  const handlePublish = () => {
    
    if (!publishSettings.signalingURL || publishSettings.signalingURL.trim() === '') {
      dispatch({
        type: ErrorsActions.SET_ERROR_MESSAGE,
        message: 'Signaling URL is required'
      });
      return;
    }
    console.log(`STUN server: ${publishSettings.stunServerURL}`);
    if (publishSettings.stunServerURL !== '') {
      const urls = publishSettings.stunServerURL.split(',').map(url => url.trim()).filter(Boolean);
      const invalidUrl = urls.find(url => !isValidStunUrl(url));
      if (invalidUrl) {
        dispatch({
          type: ErrorsActions.SET_ERROR_MESSAGE,
          message: `Invalid STUN server url: ${invalidUrl}`
        });
        return;
      }
    }

    dispatch(PublishSettingsActions.startPublish());
  };
  if (!initialized) return null;

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
                placeholder={urlPlaceholder}
                value={publishSettings.signalingURL}
                disabled={webrtcPublish.connected}
                onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_SIGNALING_URL,signalingURL:e.target.value})}
              />
            </div>
          </div>
        </div>

        <div className="form-check form-switch form-check-inline mb-3">
          <label className='form-check-label mr-3' htmlFor="publishUseWhip">
            Use WHIP
          </label>
          <input
            className='form-check-input form-switch orange-checkbox'
            type="checkbox"
            id="publishUseWhip"
            name="publishUseWhip"
            checked={publishSettings.useWhip || false}
            disabled={webrtcPublish.connected}
            onChange={handleUseWhip(PublishSettingsActions.SET_PUBLISH_USE_WHIP, 'useWhip')}
          />
        </div>

        <div className="row">
          <div className="col-12">
            <div className="form-group">
              <label htmlFor="stunServer">STUN server</label>
              <input type="text"
                className="form-control"
                id="stunServer"
                name="stunServer"
                placeholder="stun:<host>:<port>, stun:<host>:<port>"
                maxLength="1024"
                value={publishSettings.stunServerURL}
                disabled={webrtcPublish.connected}
                onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_STUN_SERVER_URL,stunServerURL:e.target.value})}
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
                disabled={webrtcPublish.connected}
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
                disabled={webrtcPublish.connected}
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
                  disabled={webrtcPublish.connected}
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
                <select
                  className="form-select"
                  id="audioCodec"
                  name="audioCodec"
                  value="opus"
                  disabled={webrtcPublish.connected}
                  readOnly
                >
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
                  disabled={webrtcPublish.connected}
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
                <select className="form-select"
                  id="videoCodec"
                  name="videoCodec"
                  value={publishSettings.videoCodec}
                  disabled={webrtcPublish.connected}
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
          <div className="col-lg-6 col-sm-12">
            <div className="form-group">
              <label htmlFor="videoFrameRate">Frame Rate</label>
              <div className="input-group">
                <input
                  type="number"
                  className="form-control"
                  id="videoFrameRate"
                  name="videoFrameRate"
                  value={publishSettings.videoFrameRate}
                  onChange={(e) => dispatch({ type: PublishSettingsActions.SET_PUBLISH_VIDEO_FRAME_SIZE_AND_RATE, videoFrameRate: e.target.value })}
                />
                <div className="input-group-append">
                  <span className="input-group-text">fps</span>
                </div>
              </div>
            </div>
          </div>
          <div className="col-lg-6 col-sm-12">
            <div className="form-group">
              <label htmlFor="frameSize">Frame Size</label>
              <div className="input-group">
                <select
                  className="form-select"
                  id="frameSize"
                  name="frameSize"
                  value={publishSettings.videoFrameSize}
                  onChange={(e) => dispatch({ type: PublishSettingsActions.SET_PUBLISH_VIDEO_FRAME_SIZE_AND_RATE, videoFrameSize: e.target.value })}
                >
                  {PublishOptions.videoFrameSizes.map((frameSize, key) => {
                    return <option key={key} value={frameSize.value}>{frameSize.name}</option>
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
            <button
              id="camera-toggle"
              type="button"
              className="control-button"
              onClick={toggleCamera}
            >
              <img
                alt=""
                className="noll"
                id={isCameraOn ? "video-off" : "video-on"}
                src={isCameraOn ? "/images/videocam-32px.svg" : "/images/videocam-off-32px.svg"}
              />
            </button>
          </div>
        </div>
        <div className="row">
          <div className="col-10">
            <PublishAudioDropdown />
          </div>
          <div className="col-2">
            <button
              id="mute-toggle"
              type="button"
              className="control-button"
              onClick={toggleMicrophone}>
              <img
                alt=""
                className="noll"
                id={isMicOn ? "mute-on" : "mute-off"}
                src={isMicOn ? "/images/mic-32px.svg" : "/images/mic-off-32px.svg"} />
            </button>
          </div>
        </div>
        <div className="row">
          <div className="col-10">
            { !webrtcPublish.connected &&
              <button id="publish-toggle" type="button" className="btn"
                disabled={publishSettings.publishStarting}
                onClick={handlePublish}
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