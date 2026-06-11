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
import { isValidStunUrl, isValidTurnUrl, STUN_SERVER_PLACEHOLDER, TURN_SERVER_PLACEHOLDER } from '../../utils/IceServersUtils';
import { parseSimulcastRenditions, getSimulcastRenditionsError } from '../../utils/SimulcastUtils';
import PublishSimulcastSettings from './PublishSimulcastSettings';
import CollapsibleSection from '../shared/CollapsibleSection';
import ExternalLinks from '../../constants/ExternalLinks';

const publishUrlParametersMap = {
  signalingURL: "publishSignalingURL",
  stunServerURL: "publishStunServerURL",
  turnServerURL: "publishTurnServerURL",
  turnUsername: "publishTurnUsername",
  turnPassword: "publishTurnPassword",
  applicationName: "publishApplicationName",
  streamName: "publishStreamName",
  useWhip: "publishUseWhip",
  useSimulcast: "publishUseSimulcast",
  simulcastRenditions: "publishSimulcastRenditions",
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


  useEffect(() => {
    const cookieValues = getCookieValues(CookieName);
    const queryParams = QueryString.parse(window.location.search);
    const savedValues = { ...cookieValues, ...queryParams };

    const actionMap = {
      signalingURL: PublishSettingsActions.SET_PUBLISH_SIGNALING_URL,
      stunServerURL: PublishSettingsActions.SET_PUBLISH_STUN_SERVER_URL,
      turnServerURL: PublishSettingsActions.SET_PUBLISH_TURN_SERVER_URL,
      turnUsername: PublishSettingsActions.SET_PUBLISH_TURN_USERNAME,
      turnPassword: PublishSettingsActions.SET_PUBLISH_TURN_PASSWORD,
      applicationName: PublishSettingsActions.SET_PUBLISH_APPLICATION_NAME,
      streamName: PublishSettingsActions.SET_PUBLISH_STREAM_NAME,
      useWhip: PublishSettingsActions.SET_PUBLISH_USE_WHIP,
      useSimulcast: PublishSettingsActions.SET_PUBLISH_USE_SIMULCAST,
      simulcastRenditions: PublishSettingsActions.SET_PUBLISH_SIMULCAST_RENDITIONS,
    };

    const booleanKeys = new Set(['useWhip', 'useSimulcast']);

    Object.entries(publishUrlParametersMap).forEach(([stateKey, cookieKey]) => {
      let value = savedValues[cookieKey];
      if (value == null) return;
      const actionType = actionMap[stateKey];
      if (!actionType) return;
      if (booleanKeys.has(stateKey)) {
        value = value === 'true' || value === true;
      } else if (stateKey === 'simulcastRenditions') {
        value = parseSimulcastRenditions(value);
        if (value == null) return;
      }
      dispatch({ type: actionType, [stateKey]: value });
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
    } else {
      console.log("No STUN servers provided");
    }

    if (publishSettings.turnServerURL !== '') {
      if (!isValidTurnUrl(publishSettings.turnServerURL)) {
        dispatch({
          type: ErrorsActions.SET_ERROR_MESSAGE,
          message: `Invalid TURN server url: ${publishSettings.turnServerURL}`
        });
        return;
      }
      
    } else {
      console.log("No TURN server provided");
    }

    if (publishSettings.useSimulcast) {
      const simulcastError = getSimulcastRenditionsError(publishSettings.simulcastRenditions);
      if (simulcastError) {
        dispatch({
          type: ErrorsActions.SET_ERROR_MESSAGE,
          message: simulcastError
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

        <CollapsibleSection title="ICE Servers">
            <div className="row">
              <div className="col-12">
                <div className="form-group">
                  <label htmlFor="stunServer">STUN server</label>
                  <input type="text"
                    className="form-control"
                    id="stunServer"
                    name="stunServer"
                    placeholder={STUN_SERVER_PLACEHOLDER}
                    maxLength="1024"
                    value={publishSettings.stunServerURL}
                    disabled={webrtcPublish.connected}
                    onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_STUN_SERVER_URL,stunServerURL:e.target.value})}
                  />
                </div>
              </div>
            </div>
            <div className="row">
              <div className="col-12">
                <div className="form-group">
                  <label htmlFor="turnServer">TURN server</label>
                  <input type="text"
                    className="form-control"
                    id="turnServer"
                    name="turnServer"
                    maxLength="1024"
                    placeholder={TURN_SERVER_PLACEHOLDER}
                    value={publishSettings.turnServerURL}
                    disabled={webrtcPublish.connected}
                    onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_TURN_SERVER_URL,turnServerURL:e.target.value})}
                  />
                </div>
              </div>
            </div>
            <div className="row">
              <div className="col-lg-6 col-sm-12">
                <div className="form-group">
                  <label htmlFor="turnUsername">TURN username</label>
                  <input type="text"
                    className="form-control"
                    id="turnUsername"
                    name="turnUsername"
                    maxLength="256"
                    value={publishSettings.turnUsername}
                    disabled={webrtcPublish.connected}
                    onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_TURN_USERNAME,turnUsername:e.target.value})}
                  />
                </div>
              </div>
              <div className="col-lg-6 col-sm-12">
                <div className="form-group">
                  <label htmlFor="turnPassword">TURN password</label>
                  <input type="password"
                    className="form-control"
                    id="turnPassword"
                    name="turnPassword"
                    maxLength="256"
                    value={publishSettings.turnPassword}
                    disabled={webrtcPublish.connected}
                    onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_TURN_PASSWORD,turnPassword:e.target.value})}
                  />
                </div>
              </div>
            </div>
        </CollapsibleSection>

        <PublishSimulcastSettings />

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
        <div className="row mt-2">
          <div className="col-12 text-center">
            <small>{ExternalLinks.legacyLinkText} <a href={ExternalLinks.legacyPublish} target="_blank" rel="noopener noreferrer">{ExternalLinks.legacyLinkLabel}</a></small>
          </div>
        </div>
      </form>
    </div>
  );
}

export default PublishSettingsForm;