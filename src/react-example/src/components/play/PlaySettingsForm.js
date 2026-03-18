import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import QueryString from 'query-string';
import Cookies from 'js-cookie';

import * as PlaySettingsActions from '../../actions/playSettingsActions';
import { getCookieValues } from '../../utils/CookieUtils';
import CookieName from '../../constants/CookieName';

const playUrlParametersMap = {
  signalingURL: "playSignalingURL",
  applicationName: "playApplicationName",
  streamName: "playStreamName",
  secret: "playSecret",
  timeout: "playTimeout",
  prefix: "playPrefix",
  isIp: "playIsIp",
  ip: "playIp"
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
      value={checked || false}
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
          applicationName: PlaySettingsActions.SET_PLAY_APPLICATION_NAME,
          streamName: PlaySettingsActions.SET_PLAY_STREAM_NAME,
          secret: PlaySettingsActions.SET_PLAY_SECRET,
          timeout: PlaySettingsActions.SET_PLAY_TIMEOUT,
          prefix: PlaySettingsActions.SET_PLAY_PREFIX,
          isIp: PlaySettingsActions.SET_PLAY_IS_IP,
          ip: PlaySettingsActions.SET_PLAY_IP
        };

        const actionType = actionMap[stateKey];
        if (actionType) {
          const payload = stateKey === 'isIp'
            ? { [stateKey]: value === 'true' || value === true }
            : { [stateKey]: value };
          dispatch({ type: actionType, ...payload });
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
              <img alt="Copy Link" className="noll" src="./images/file_copy-24px.svg" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default PlaySettingsForm;