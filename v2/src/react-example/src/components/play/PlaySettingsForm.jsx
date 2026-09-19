import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { readQueryParams } from '../../utils/QueryParams';
import Cookies from 'js-cookie';

import * as PlaySettingsActions from '../../actions/playSettingsActions';
import * as ErrorsActions from '../../actions/errorsActions';
import { getCookieValues } from '../../utils/CookieUtils';
import CookieName from '../../constants/CookieName';
import { isValidStunUrl, isValidTurnUrl, STUN_SERVER_PLACEHOLDER, TURN_SERVER_PLACEHOLDER } from '../../utils/IceServersUtils';
import { isValidIpAddress, IP_ADDRESS_PLACEHOLDER } from '../../utils/IpAddressUtils';
import RecentInput from '../shared/RecentInput';
import useRecent from '../../hooks/useRecent';
import FormCheckbox from '../shared/FormCheckbox';
import FormToggleSelect from '../shared/FormToggleSelect';
import { WSS, HTTP, isHostless, mismatched, convertTo } from '../../utils/SignalingUrlUtils';
import DataChannelRequirements from '../../constants/DataChannelRequirements';
import { triggerIceRestart } from '../../utils/IceRestartUtils';
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
  useWhep: "playUseWhep",
  authToken: "playAuthToken",
  chatEnabled: "playChatEnabled",
  captionsEnabled: "playCaptionsEnabled"
};

const SIGNALING_URL_PLACEHOLDER = "wss://[ssl-certificate-domain-name]/webrtc-session.json";
const HTTP_URL_PLACEHOLDER = "https://[ssl-certificate-domain-name]:[port]";

const FormInput = ({ label, id, value, onChange, disabled, ...props }) => (
  <div className="mb-3">
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

// `tab` selects which group of fields to show; the inspector owns the tab strip.
const PlaySettingsForm = ({ tab = 'connection' }) => {
  const dispatch = useDispatch();
  const [initialized, setInitialized] = useState(false);
  const playSettings = useSelector((state) => state.playSettings);
  const webrtcPlay = useSelector((state) => state.webrtcPlay);

  /*
   * Derived, not stored. Held in state it had to be kept in step with the transport from
   * three places (mount, the cookie load, the switch), which is why the cookie load carried
   * a line of its own just to put the example right.
   */
  const transport = playSettings.useWhep ? HTTP : WSS;
  const urlPlaceholder = transport === HTTP
    ? HTTP_URL_PLACEHOLDER
    : SIGNALING_URL_PLACEHOLDER;
  const urlMismatched = mismatched(playSettings.signalingURL, transport);

  /*
   * The signalling URL is remembered per transport. A wss:// URL and an https:// origin are
   * not alternatives to each other, so offering both at once offers values that cannot work
   * under the transport now selected. The lists are shared with the publisher: same Engine,
   * same applications, same streams.
   */
  const recentUrl = useRecent('signalingURL', transport);
  const recentApplication = useRecent('applicationName');
  const recentStream = useRecent('streamName');

  // Load settings from cookie and URL on mount
  useEffect(() => {
    const cookieValues = getCookieValues(CookieName);
    const queryParams = readQueryParams();
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
          useWhep: PlaySettingsActions.SET_PLAY_USE_WHEP,
          authToken: PlaySettingsActions.SET_PLAY_AUTH_TOKEN,
          chatEnabled: PlaySettingsActions.SET_PLAY_CHAT_ENABLED,
          captionsEnabled: PlaySettingsActions.SET_PLAY_CAPTIONS_ENABLED
        };

        const booleanKeys = ['isIp', 'useWhep', 'chatEnabled', 'captionsEnabled'];

        const actionType = actionMap[stateKey];
        if (actionType) {
          const payload = booleanKeys.includes(stateKey)
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
    dispatch({ type: actionType, [key]: e.target.checked });
  };

  const setSignalingURL = (value) =>
    dispatch({ type: PlaySettingsActions.SET_PLAY_SIGNALING_URL, signalingURL: value });

  const handleTransportChange = (e) => {
    const useWhep = e.target.checked;
    dispatch({ type: PlaySettingsActions.SET_PLAY_USE_WHEP, useWhep });

    /*
     * The host and port carry across; only the scheme and the path follow the transport.
     * The server being reached did not change, and retyping it because the way of reaching
     * it changed is exactly the work the pre-filling was meant to remove.
     */
    setSignalingURL(convertTo(playSettings.signalingURL, useWhep ? HTTP : WSS));
  };

  const handlePlay = () => {

    // A bare scheme is not a URL, so it counts as the field being empty.
    if (isHostless(playSettings.signalingURL)) {
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

    // The address is only sent when the box is ticked, so it is only judged then.
    if (playSettings.isIp && !isValidIpAddress(playSettings.ip)) {
      dispatch({
        type: ErrorsActions.SET_ERROR_MESSAGE,
        message: playSettings.ip
          ? `Not an IP address: ${playSettings.ip}`
          : 'Client IP address is required when "Include Client IP Address" is ticked'
      });
      return;
    }

    recentUrl.remember(playSettings.signalingURL);
    recentApplication.remember(playSettings.applicationName);
    recentStream.remember(playSettings.streamName);

    dispatch(PlaySettingsActions.startPlay());
  } 
  const handleStop = () => dispatch(PlaySettingsActions.stopPlay());

  // Test aid: trigger an ICE restart on the active play peer connection. See IceRestartUtils.
  const handleRestartIce = () => triggerIceRestart(webrtcPlay.peerConnection);

  if (!initialized) return null;

  const { connected } = webrtcPlay;

  // Only complain about something the user has actually typed.
  const ipInvalid = playSettings.isIp && !!playSettings.ip && !isValidIpAddress(playSettings.ip);

  /*
   * No codec gate on this side: the player does not choose the codec, so the only question
   * here is whether this browser can read an encoded frame at all. A stream that arrives as
   * VP8, or one that was re-encoded on the way, shows as "no frame stamp" in the panel.
   */

  return (
    <div id="play-settings">
      <form id="play-settings-form">

        {/* Kept mounted and hidden rather than unmounted: these groups own effects that
            set up devices and tracks, and those must run whether or not the tab is open. */}
        <div hidden={tab !== 'connection'}>
        {/* Connection Settings */}
        <div className="row">
          <div className="col-12">
            <RecentInput
              label="Signaling URL"
              id="playSignalingURL"
              maxLength={1024}
              placeholder={urlPlaceholder}
              value={playSettings.signalingURL}
              suggestions={recentUrl.values}
              onForget={recentUrl.forget}
              disabled={connected}
              aria-describedby={urlMismatched ? 'playSignalingURL-mismatch' : undefined}
              onChange={setSignalingURL}
              hint={urlMismatched ? (
                <small className="wz-field-error" id="playSignalingURL-mismatch" role="alert">
                  This URL is written for {transport === HTTP ? 'WSS' : 'WHEP'}. Edit it, or put
                  the transport back.
                </small>
              ) : null}
            />
          </div>
        </div>

        {/* One boolean, shown as the choice it actually is. WHEP is the checked state. */}
        <FormToggleSelect
          label="Transport"
          id="playUseWhep"
          offLabel="WSS"
          onLabel="WHEP"
          checked={playSettings.useWhep}
          disabled={connected}
          onChange={handleTransportChange}
        />

        {/* Always rendered, disabled when it does not apply. A field that appears and
            disappears as a switch is thrown reflows everything under it, and it hides the
            fact that WHEP takes an auth token at all until WHEP has already been chosen. */}
        <div className="row">
          <div className="col-12">
            <div className="mb-3">
              <label htmlFor="playAuthToken">WHEP Auth Token</label>
              <input type="text"
                className="form-control"
                id="playAuthToken"
                name="playAuthToken"
                maxLength={1024}
                value={playSettings.authToken || ''}
                disabled={connected || !playSettings.useWhep}
                aria-describedby="playAuthToken-hint"
                onChange={handleInputChange(PlaySettingsActions.SET_PLAY_AUTH_TOKEN, 'authToken')}
              />
              <small className="form-text text-muted" id="playAuthToken-hint">
                {playSettings.useWhep
                  ? 'Optional. Sent as a Bearer token on the WHEP request.'
                  : 'Only used by WHEP. Select WHEP above to enable it.'}
              </small>
            </div>
          </div>
        </div>

        <div className="wz-rule" />

        <div className="row">
          <div className="col-6">
            <RecentInput
              label="Application Name"
              id="playApplicationName"
              maxLength={256}
              value={playSettings.applicationName}
              suggestions={recentApplication.values}
              onForget={recentApplication.forget}
              disabled={connected}
              onChange={(applicationName) => dispatch({ type: PlaySettingsActions.SET_PLAY_APPLICATION_NAME, applicationName })}
            />
          </div>
          <div className="col-6">
            <RecentInput
              label="Stream Name"
              id="playStreamName"
              maxLength={256}
              value={playSettings.streamName}
              suggestions={recentStream.values}
              onForget={recentStream.forget}
              disabled={connected}
              onChange={(streamName) => dispatch({ type: PlaySettingsActions.SET_PLAY_STREAM_NAME, streamName })}
            />
          </div>
        </div>

        <div className="wz-rule" />

        <div className="row align-items-center mt-2 mb-0">
          <div className="col-6">
            <FormCheckbox
              label="Enable Chat"
              id="playChatEnabled"
              checked={playSettings.chatEnabled}
              disabled={connected}
              onChange={handleCheckboxChange(PlaySettingsActions.SET_PLAY_CHAT_ENABLED, 'chatEnabled')}
            />
          </div>
          <div className="col-6">
            <FormCheckbox
              label="Enable Captions"
              id="playCaptionsEnabled"
              checked={playSettings.captionsEnabled}
              disabled={connected}
              onChange={handleCheckboxChange(PlaySettingsActions.SET_PLAY_CAPTIONS_ENABLED, 'captionsEnabled')}
            />
          </div>
        </div>

        <div className="row mb-2">
          <div className="col-12">
            <small className="form-text text-muted">{DataChannelRequirements.hint}</small>
          </div>
        </div>
        </div>

        {/* Kept mounted and hidden rather than unmounted: these groups own effects that
            set up devices and tracks, and those must run whether or not the tab is open. */}
        {/* Kept mounted and hidden rather than unmounted: these groups own effects that
            set up devices and tracks, and those must run whether or not the tab is open. */}
        <div hidden={tab !== 'advanced'}>
        {/* The Secure Token block moved here when the Playback tab went away. It stays a
            move of JSX between sibling hidden wrappers, never a conditional render: these
            groups own effects that must run whether or not their tab is open. */}

        <div className="wz-group">Secure Token</div>
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
          <div className="col-12">
            <FormCheckbox
              label="Include Client IP Address"
              id="playIsIp"
              checked={playSettings.isIp}
              disabled={connected}
              onChange={handleCheckboxChange(PlaySettingsActions.SET_PLAY_IS_IP, 'isIp')}
            />
          </div>
          <div className="col-12">
            {/* The box only accepts input once the option is on, because an address that is
                never sent is worse than no address: it reads as though it were in force. */}
            <FormInput
              label="Client IP Address"
              id="playIp"
              type="text"
              inputMode="numeric"
              maxLength={45}
              placeholder={IP_ADDRESS_PLACEHOLDER}
              value={playSettings.ip}
              disabled={connected || !playSettings.isIp}
              aria-invalid={ipInvalid ? 'true' : undefined}
              aria-describedby={ipInvalid ? 'playIp-error' : undefined}
              className={'form-control' + (ipInvalid ? ' is-invalid' : '')}
              onChange={handleInputChange(PlaySettingsActions.SET_PLAY_IP, 'ip')}
            />
            {ipInvalid && (
              <small className="wz-field-error" id="playIp-error" role="alert">
                Not an IP address. Use IPv4 (203.0.113.42) or IPv6 (2001:db8::1).
              </small>
            )}
          </div>
        </div>
        <div className="wz-rule" />

        <div className="wz-group">ICE Servers</div>
            <div className="row">
              <div className="col-12">
                <div className="mb-3">
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
                <div className="mb-3">
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
                <div className="mb-3">
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
                <div className="mb-3">
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
        { connected &&
          <div className="row mt-2">
            <div className="col-12">
              <button
                id="play-ice-restart-toggle"
                type="button"
                className="btn w-100"
                onClick={handleRestartIce}
                title="Trigger an ICE restart: renegotiates ICE (new ufrag/pwd) without recreating the play session"
              >Restart ICE</button>
            </div>
          </div>
        }
        </div>

        {/* The primary action stays reachable from every tab rather than living in one. */}
        <div className="wz-actions-dock">
        {/* Action Buttons */}
        <div className="row wz-inline-row">
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
        </div>
      </form>
    </div>
  );
};

export default PlaySettingsForm;
