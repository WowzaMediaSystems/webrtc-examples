import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import QueryString from 'query-string';
import Cookies from 'js-cookie';

import * as PlaySettingsActions from '../../actions/playSettingsActions';
import * as ErrorsActions from '../../actions/errorsActions';
import { getCookieValues } from '../../utils/CookieUtils';
import CookieName from '../../constants/CookieName';
import { isValidStunUrl, isValidTurnUrl, STUN_SERVER_PLACEHOLDER, TURN_SERVER_PLACEHOLDER } from '../../utils/IceServersUtils';
import ExternalLinks from '../../constants/ExternalLinks';
import fileCopyImage from '../../images/file_copy-24px.svg';

const playUrlParametersMap = {
  signalingURL: "playSignalingURL",
  stunServerURL: "playStunServerURL",
  turnServerURL: "playTurnServerURL",
  turnUsername: "playTurnUsername",
  turnPassword: "playTurnPassword",
  applicationName: "playApplicationName",
  streamName: "playStreamName",
  secret: "playSecret",
  timeout: "playTimeout",
  prefix: "playPrefix",
  isIp: "playIsIp",
  ip: "playIp",
  useWhep: "playUseWhep"
};

const SIGNALING_URL_PLACEHOLDER = "wss://[ssl-certificate-domain-name]/webrtc-session.json";
const WHEP_URL_PLACEHOLDER = "https://[ssl-certificate-domain-name]:[port]/";

const FormInput = ({ label, id, value, onChange, disabled, ...props }) => (
  <div className="form-group">
    <label htmlFor={id}>{label}</label>
    <input
      id={id}
      name={id}
      className="form-control"
      value={value || ''}
      onChange={onChange}
      disabled={disabled}
      {...props}
    />
  </div>
);

const FormCheckbox = ({ label, id, checked, onChange, disabled }) => (
  <div className="form-group form-switch mt-2 ml-4">
    <input
      id={id}
      name={id}
      className="form-check-input orange-checkbox"
      type="checkbox"
      checked={checked || false}
      disabled={disabled}
      onChange={onChange}
    />
    <label className="form-check-label" htmlFor={id}>
      {label}
    </label>
  </div>
);

const PlaySettingsForm = () => {
  const dispatch = useDispatch();
  const [initialized, setInitialized] = useState(false);
  const [iceServersExpanded, setIceServersExpanded] = useState(false);
  const playSettings = useSelector((state) => state.playSettings);
  const webrtcPlay = useSelector((state) => state.webrtcPlay);

  const [urlPlaceholder, setUrlPlaceholder] = useState(SIGNALING_URL_PLACEHOLDER);

  // Load settings from cookie and URL on mount
  useEffect(() => {
    const cookieValues = getCookieValues(CookieName);
    const queryParams = QueryString.parse(window.location.search);
    const savedValues = { ...cookieValues, ...queryParams };

    Object.entries(playUrlParametersMap).forEach(([stateKey, cookieKey]) => {
      const value = savedValues[cookieKey];
      if (value != null) {
        const actionMap = {
          signalingURL: PlaySettingsActions.SET_PLAY_SIGNALING_URL,
          stunServerURL: PlaySettingsActions.SET_PLAY_STUN_SERVER_URL,
          turnServerURL: PlaySettingsActions.SET_PLAY_TURN_SERVER_URL,
          turnUsername: PlaySettingsActions.SET_PLAY_TURN_USERNAME,
          turnPassword: PlaySettingsActions.SET_PLAY_TURN_PASSWORD,
          applicationName: PlaySettingsActions.SET_PLAY_APPLICATION_NAME,
          streamName: PlaySettingsActions.SET_PLAY_STREAM_NAME,
          secret: PlaySettingsActions.SET_PLAY_SECRET,
          timeout: PlaySettingsActions.SET_PLAY_TIMEOUT,
          prefix: PlaySettingsActions.SET_PLAY_PREFIX,
          isIp: PlaySettingsActions.SET_PLAY_IS_IP,
          ip: PlaySettingsActions.SET_PLAY_IP,
          useWhep: PlaySettingsActions.SET_PLAY_USE_WHEP
        };

        const booleanKeys = ['isIp', 'useWhep'];

        const actionType = actionMap[stateKey];
        if (actionType) {
          const payload = booleanKeys.includes(stateKey)
            ? { [stateKey]: value === 'true' || value === true }
            : { [stateKey]: value };
          dispatch({ type: actionType, ...payload });
        }

        if (stateKey === 'useWhep' && (value === 'true' || value === true)) {
          setUrlPlaceholder(WHEP_URL_PLACEHOLDER);
        }
      }
    });

    setInitialized(true);
  }, [dispatch]);

  // Save settings to cookie
  useEffect(() => {
    const cookieValues = getCookieValues(CookieName);

    Object.entries(playUrlParametersMap).forEach(([stateKey, cookieKey]) => {
      if (playSettings[stateKey] != null) {
        cookieValues[cookieKey] = playSettings[stateKey];
      }
    });

    Cookies.set(CookieName, escape(JSON.stringify(cookieValues)));
  }, [playSettings]);

  const handleShareLink = () => {
    const params = new URLSearchParams();

    Object.entries(playUrlParametersMap).forEach(([stateKey, cookieKey]) => {
      const value = playSettings[stateKey];
      if (value != null && value !== '') {
        params.set(cookieKey, value);
      }
    });

    const shareUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;

    navigator.clipboard.writeText(shareUrl)
      .then(() => alert('Share link copied to clipboard!'))
      .catch((err) => console.error('Failed to copy link:', err));
  };

  const handleInputChange = (actionType, key) => (e) => {
    dispatch({ type: actionType, [key]: e.target.value });
  };

  const handleCheckboxChange = (actionType, key) => (e) => {
    if (actionType === PlaySettingsActions.SET_PLAY_USE_WHEP) {
      if (e.target.checked) {
        setUrlPlaceholder(WHEP_URL_PLACEHOLDER);
      } else {
        setUrlPlaceholder(SIGNALING_URL_PLACEHOLDER);
      }
    }
    dispatch({ type: actionType, [key]: e.target.checked });
  };

  const handlePlay = () => {

    if (!playSettings.signalingURL || playSettings.signalingURL.trim() === '') {
      dispatch({
        type: ErrorsActions.SET_ERROR_MESSAGE,
        message: 'Signaling URL is required'
      });
      return;
    }

    if (playSettings.stunServerURL !== '') {
      const urls = playSettings.stunServerURL.split(',').map(url => url.trim()).filter(Boolean);
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

    if (playSettings.turnServerURL !== '') {
      if (!isValidTurnUrl(playSettings.turnServerURL)) {
        dispatch({
          type: ErrorsActions.SET_ERROR_MESSAGE,
          message: `Invalid TURN server url: ${playSettings.turnServerURL}`
        });
        return;
      }
      
    } else {
      console.log("No TURN server provided");
    }

    dispatch(PlaySettingsActions.startPlay());
  } 
  const handleStop = () => dispatch(PlaySettingsActions.stopPlay());

  if (!initialized) return null;

  const { connected } = webrtcPlay;

  return (
    <div className="col-md-4 col-sm-12" id="play-settings">
      <form id="play-settings-form">
        {/* Connection Settings */}
        <div className="row">
          <div className="col-12">
            <FormInput
              label="Signaling URL"
              id="playSignalingURL"
              type="text"
              maxLength={1024}
              placeholder={urlPlaceholder}
              value={playSettings.signalingURL}
              disabled={connected}
              onChange={handleInputChange(PlaySettingsActions.SET_PLAY_SIGNALING_URL, 'signalingURL')}
            />
          </div>
        </div>

        <div className="row">
          <div className="col-6">
            <FormCheckbox
              label="Use WHEP"
              id="playUseWhep"
              checked={playSettings.useWhep}
              disabled={connected}
              onChange={handleCheckboxChange(PlaySettingsActions.SET_PLAY_USE_WHEP, 'useWhep')}
            />
          </div>
        </div>

        <div className="row mb-2">
          <div className="col-12">
            <button
              type="button"
              className={`btn btn-sm w-100 d-flex align-items-center justify-content-between btn-ice-servers`}
              onClick={() => setIceServersExpanded(!iceServersExpanded)}
            >
              <span>ICE Servers</span>
              <i className={`bi bi-chevron-${iceServersExpanded ? 'up' : 'down'}`}></i>
            </button>
          </div>
        </div>

        {iceServersExpanded && (
          <>
          <div className="border border-top-0 rounded-bottom p-3 mb-3">
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
                    value={playSettings.stunServerURL}
                    disabled={connected}
                    onChange={(e)=>dispatch({type:PlaySettingsActions.SET_PLAY_STUN_SERVER_URL,stunServerURL:e.target.value})}
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
                    value={playSettings.turnServerURL}
                    disabled={connected}
                    onChange={(e)=>dispatch({type:PlaySettingsActions.SET_PLAY_TURN_SERVER_URL,turnServerURL:e.target.value})}
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
                    value={playSettings.turnUsername}
                    disabled={connected}
                    onChange={(e)=>dispatch({type:PlaySettingsActions.SET_PLAY_TURN_USERNAME,turnUsername:e.target.value})}
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
                    value={playSettings.turnPassword}
                    disabled={connected}
                    onChange={(e)=>dispatch({type:PlaySettingsActions.SET_PLAY_TURN_PASSWORD,turnPassword:e.target.value})}
                  />
                </div>
              </div>
            </div>
            </div>
          </>
        )}

        <div className="row">
          <div className="col-6">
            <FormInput
              label="Application Name"
              id="playApplicationName"
              type="text"
              maxLength={256}
              value={playSettings.applicationName}
              disabled={connected}
              onChange={handleInputChange(PlaySettingsActions.SET_PLAY_APPLICATION_NAME, 'applicationName')}
            />
          </div>
          <div className="col-6">
            <FormInput
              label="Stream Name"
              id="playStreamName"
              type="text"
              maxLength={256}
              value={playSettings.streamName}
              disabled={connected}
              onChange={handleInputChange(PlaySettingsActions.SET_PLAY_STREAM_NAME, 'streamName')}
            />
          </div>
        </div>

        {/* Secure Token Section */}
        <div className="row">
          <div className="col-12">
            <b>Secure Token Data:</b>
          </div>
        </div>

        <div className="row">
          <div className="col-12">
            <FormInput
              label="Shared Secret"
              id="playSecret"
              type="text"
              maxLength={256}
              value={playSettings.secret}
              disabled={connected}
              onChange={handleInputChange(PlaySettingsActions.SET_PLAY_SECRET, 'secret')}
            />
          </div>
        </div>

        <div className="row">
          <div className="col-6">
            <FormInput
              label={<>Token Timeout <i>(in seconds)</i></>}
              id="playTimeout"
              type="text"
              maxLength={256}
              value={playSettings.timeout}
              disabled={connected}
              onChange={handleInputChange(PlaySettingsActions.SET_PLAY_TIMEOUT, 'timeout')}
            />
          </div>
          <div className="col-6">
            <FormInput
              label="Hash Query Parameter Prefix"
              id="playPrefix"
              type="text"
              maxLength={256}
              placeholder="wowzatoken"
              value={playSettings.prefix}
              disabled={connected}
              onChange={handleInputChange(PlaySettingsActions.SET_PLAY_PREFIX, 'prefix')}
            />
          </div>
        </div>

        <div className="row">
          <div className="col-6">
            <FormCheckbox
              label="Include Client IP Address"
              id="playIsIp"
              checked={playSettings.isIp}
              disabled={connected}
              onChange={handleCheckboxChange(PlaySettingsActions.SET_PLAY_IS_IP, 'isIp')}
            />
          </div>
          <div className="col-6">
            <FormInput
              label="Client IP Address"
              id="playIp"
              type="text"
              maxLength={256}
              value={playSettings.ip}
              disabled={connected}
              onChange={handleInputChange(PlaySettingsActions.SET_PLAY_IP, 'ip')}
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="row">
          <div className="col-10">
            <button
              id="play-toggle"
              type="button"
              className="btn"
              disabled={playSettings.playStarting}
              onClick={connected ? handleStop : handlePlay}
            >
              {connected ? 'Stop' : 'Play'}
            </button>
          </div>
          <div className="col-2">
            <button
              id="play-share-link"
              type="button"
              className="control-button mt-0"
              onClick={handleShareLink}
              title="Copy share link"
            >
              <img alt="Copy Link" className="noll" src={fileCopyImage} />
            </button>
          </div>
        </div>
        <div className="row mt-2">
          <div className="col-12 text-center">
            <small>{ExternalLinks.legacyLinkText} <a href={ExternalLinks.legacyPlay} target="_blank" rel="noopener noreferrer">{ExternalLinks.legacyLinkLabel}</a></small>
          </div>
        </div>
      </form>
    </div>
  );
};

export default PlaySettingsForm;