import React, { useState, useEffect, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import * as ErrorsActions from '../../actions/errorsActions';
import * as PublishSettingsActions from '../../actions/publishSettingsActions';
import * as PublishOptions from '../../constants/PublishOptions';
import PublishAudioDropdown from './PublishAudioDropdown';
import PublishVideoDropdown from './PublishVideoDropdown';
import Cookies from 'js-cookie';
import { readQueryParams } from '../../utils/QueryParams';
import { VIDEO_CODEC_OPTIONS, isVideoCodecOfferable } from '../../utils/CodecUtils';
import { cameraTrackOf } from '../../utils/VideoTrackUtils';
import { getCookieValues } from '../../utils/CookieUtils';
import RecentInput from '../shared/RecentInput';
import useRecent from '../../hooks/useRecent';
import CookieName from '../../constants/CookieName';
import { isValidStunUrl, isValidTurnUrl, STUN_SERVER_PLACEHOLDER, TURN_SERVER_PLACEHOLDER } from '../../utils/IceServersUtils';
import { parseSimulcastRenditions, getSimulcastRenditionsError } from '../../utils/SimulcastUtils';
import PublishSimulcastSettings from './PublishSimulcastSettings';
import FormCheckbox from '../shared/FormCheckbox';
import PublishDiagnosticsSettings from './PublishDiagnosticsSettings';
import FormToggleSelect from '../shared/FormToggleSelect';
import { WSS, HTTP, isHostless, mismatched, convertTo } from '../../utils/SignalingUrlUtils';
import { triggerIceRestart } from '../../utils/IceRestartUtils';
import DataChannelRequirements from '../../constants/DataChannelRequirements';
import videoOnImage from '../../images/videocam-32px.svg';
import videoOffImage from '../../images/videocam-off-32px.svg';
import micOnImage from '../../images/mic-32px.svg';
import micOffImage from '../../images/mic-off-32px.svg';
import fileCopyImage from '../../images/file_copy-24px.svg';

const SIGNALING_URL_PLACEHOLDER = "wss://[ssl-certificate-domain-name]/webrtc-session.json";
const HTTP_URL_PLACEHOLDER = "https://[ssl-certificate-domain-name]:[port]";

const publishUrlParametersMap = {
  signalingURL: "publishSignalingURL",
  stunServerURL: "publishStunServerURL",
  turnServerURL: "publishTurnServerURL",
  turnUsername: "publishTurnUsername",
  turnPassword: "publishTurnPassword",
  applicationName: "publishApplicationName",
  streamName: "publishStreamName",
  useWhip: "publishUseWhip",
  authToken: "publishAuthToken",
  useSimulcast: "publishUseSimulcast",
  simulcastRenditions: "publishSimulcastRenditions",
  latencyProbe: "publishLatencyProbe",
  burnedClock: "publishBurnedClock",
  chatEnabled: "publishChatEnabled",
  captionsEnabled: "publishCaptionsEnabled",
};

// `tab` picks which field group shows; the inspector owns the tab strip. One instance
// stays mounted across tabs, so the effects here run once.
const PublishSettingsForm = ({ tab = 'connection' }) => {

  const dispatch = useDispatch();
  const publishSettings = useSelector((state) => state.publishSettings);
  const webrtcPublish = useSelector((state) => state.webrtcPublish);

  // From the store, so a remount keeps the state. A missing track reads as off.
  const isCameraOn = typeof publishSettings.videoTrack?.kind === 'string' && publishSettings.videoEnabled;
  const isMicOn = typeof publishSettings.audioTrack?.kind === 'string' && publishSettings.audioEnabled;

  // Derived, not stored: a stored copy fell out of step with the transport on cookie load.
  const transport = publishSettings.useWhip ? HTTP : WSS;
  const urlPlaceholder = transport === HTTP
    ? HTTP_URL_PLACEHOLDER
    : SIGNALING_URL_PLACEHOLDER;
  const urlMismatched = mismatched(publishSettings.signalingURL, transport);

  // Remembered per transport: a wss:// URL cannot work where an https:// origin is wanted.
  const recentUrl = useRecent('signalingURL', transport);
  const recentApplication = useRecent('applicationName');
  const recentStream = useRecent('streamName');

  const [initialized, setInitialized] = useState(true);


  useEffect(() => {
    const cookieValues = getCookieValues(CookieName);
    const queryParams = readQueryParams();
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
      authToken: PublishSettingsActions.SET_PUBLISH_AUTH_TOKEN,
      useSimulcast: PublishSettingsActions.SET_PUBLISH_USE_SIMULCAST,
      simulcastRenditions: PublishSettingsActions.SET_PUBLISH_SIMULCAST_RENDITIONS,
      latencyProbe: PublishSettingsActions.SET_PUBLISH_LATENCY_PROBE,
      burnedClock: PublishSettingsActions.SET_PUBLISH_BURNED_CLOCK,
      chatEnabled: PublishSettingsActions.SET_PUBLISH_CHAT_ENABLED,
      captionsEnabled: PublishSettingsActions.SET_PUBLISH_CAPTIONS_ENABLED,
    };

    // Carried in the share link on purpose: testing across two machines means handing the
    // other machine a URL, and a probe that is on here and off there measures nothing.
    const booleanKeys = new Set(['useWhip', 'useSimulcast', 'latencyProbe', 'burnedClock', 'chatEnabled', 'captionsEnabled']);

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


  const toggleCamera = () => dispatch({ type: PublishSettingsActions.TOGGLE_VIDEO_ENABLED });

  const toggleMicrophone = () => dispatch({ type: PublishSettingsActions.TOGGLE_AUDIO_ENABLED });


  useEffect(() => {
    // The camera, not whatever is being published: see cameraTrackOf.
    const track = cameraTrackOf(publishSettings.videoTrack);

    // A stopped or detached track still exists, but applyConstraints on it throws
    // OverconstrainedError. Routine when navigating away.
    if (!track || !track.applyConstraints) return;
    if (track.readyState !== 'live') return;

    const constraints =
      PublishOptions.videoConstraintsByFrameSize[
      publishSettings.videoFrameSize
      ];

    if (!constraints) return;

    // Only send the keys this size actually constrains. "default" carries no width or
    // height, and passing undefined for them would be a constraint of its own shape.
    const newConstraints = {};
    if (constraints.width) newConstraints.width = constraints.width;
    if (constraints.height) newConstraints.height = constraints.height;

    const requestedRate = Number(publishSettings.videoFrameRate);
    if (Number.isFinite(requestedRate) && requestedRate > 0) {
      // ideal, not exact: a camera that cannot hit the rate gives its closest instead of failing.
      newConstraints.frameRate = { ideal: requestedRate };
    }

    console.log("Applying preview constraints:", newConstraints);

    track.applyConstraints(newConstraints)
      .then(() => {
        console.log("Preview updated");
      })
      .catch((error) => {

        console.error("Constraint error:", error);

        let message = error.message;

        // A detached track also throws OverconstrainedError; error.constraint names the one
        // that failed, so only blame the frame size when it is a size constraint.
        const sizeConstraints = ['width', 'height', 'aspectRatio'];
        if (error.name === "OverconstrainedError" && sizeConstraints.includes(error.constraint)) {
          message = `Your browser or camera does not support this frame size: ${publishSettings.videoFrameSize}`;
        } else if (error.name === "OverconstrainedError") {
          message = `The camera could not apply the requested setting${error.constraint ? ` (${error.constraint})` : ''}.`;
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

  const setSignalingURL = (value) =>
    dispatch({ type: PublishSettingsActions.SET_PUBLISH_SIGNALING_URL, signalingURL: value });

  const handleTransportChange = (e) => {
    const useWhip = e.target.checked;
    dispatch({ type: PublishSettingsActions.SET_PUBLISH_USE_WHIP, useWhip });

    // Host and port carry across; only scheme and path follow the transport.
    setSignalingURL(convertTo(publishSettings.signalingURL, useWhip ? HTTP : WSS));
  };

  const handlePublish = () => {
    
    // A bare scheme is not a URL, so it counts as the field being empty.
    if (isHostless(publishSettings.signalingURL)) {
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

    // Remembered on publish, not per keystroke, so the list holds real targets.
    recentUrl.remember(publishSettings.signalingURL);
    recentApplication.remember(publishSettings.applicationName);
    recentStream.remember(publishSettings.streamName);

    dispatch(PublishSettingsActions.startPublish());
  };

  // Test aid: trigger an ICE restart on the active publish peer connection. See IceRestartUtils.
  const handleRestartIce = () => triggerIceRestart(webrtcPublish.peerConnection);

  // null means the question could not be answered here, which is not a reason to warn.
  // Memoized: getCapabilities is not free and this form re-renders on every keystroke.
  const codecUnavailable = useMemo(
    () => isVideoCodecOfferable(publishSettings.videoCodec) === false,
    [publishSettings.videoCodec]
  );

  if (!initialized) return null;

  return (
    <div id="publish-settings">
      <form id="publish-settings-form">

        {/* Hidden, not unmounted: these groups own device and track effects that must always run. */}
        <div hidden={tab !== 'connection'}>
        <div className="row">
          <div className="col-12">
            <RecentInput
              label="Signaling URL"
              id="signalingURL"
              maxLength={1024}
              placeholder={urlPlaceholder}
              value={publishSettings.signalingURL}
              suggestions={recentUrl.values}
              onForget={recentUrl.forget}
              disabled={webrtcPublish.connected}
              aria-describedby={urlMismatched ? 'signalingURL-mismatch' : undefined}
              onChange={setSignalingURL}
              hint={urlMismatched ? (
                <small className="wz-field-error" id="signalingURL-mismatch" role="alert">
                  This URL is written for {transport === HTTP ? 'WSS' : 'WHIP'}. Edit it, or put
                  the transport back.
                </small>
              ) : null}
            />
          </div>
        </div>

        {/* One boolean, shown as the choice it actually is. WHIP is the checked state. */}
        <FormToggleSelect
          label="Transport"
          id="publishUseWhip"
          offLabel="WSS"
          onLabel="WHIP"
          checked={publishSettings.useWhip}
          disabled={webrtcPublish.connected}
          onChange={handleTransportChange}
        />

        {/* Always rendered, disabled when it does not apply: a field that comes and goes
            reflows everything below it and hides that WHIP takes a token. */}
        <div className="row">
          <div className="col-12">
            <div className="mb-3">
              <label htmlFor="publishAuthToken">WHIP Auth Token</label>
              <input type="text"
                className="form-control"
                id="publishAuthToken"
                name="publishAuthToken"
                maxLength="1024"
                value={publishSettings.authToken || ''}
                disabled={webrtcPublish.connected || !publishSettings.useWhip}
                aria-describedby="publishAuthToken-hint"
                onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_AUTH_TOKEN,authToken:e.target.value})}
              />
              <small className="form-text text-muted" id="publishAuthToken-hint">
                {publishSettings.useWhip
                  ? 'Optional. Sent as a Bearer token on the WHIP request.'
                  : 'Only used by WHIP. Select WHIP above to enable it.'}
              </small>
            </div>
          </div>
        </div>

        <div className="wz-rule" />

        <div className="row">
          <div className="col-lg-6 col-sm-12">
            <RecentInput
              label="Application Name"
              id="applicationName"
              maxLength={256}
              value={publishSettings.applicationName}
              suggestions={recentApplication.values}
              onForget={recentApplication.forget}
              disabled={webrtcPublish.connected}
              onChange={(applicationName)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_APPLICATION_NAME,applicationName})}
            />
          </div>
          <div className="col-lg-6 col-sm-12">
            <RecentInput
              label="Stream Name"
              id="streamName"
              maxLength={256}
              value={publishSettings.streamName}
              suggestions={recentStream.values}
              onForget={recentStream.forget}
              disabled={webrtcPublish.connected}
              onChange={(streamName)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_STREAM_NAME,streamName})}
            />
          </div>
        </div>

        <div className="wz-rule" />

        <div className="row align-items-center mt-3 mb-0">
          <div className="col-6">
            <FormCheckbox
              label="Enable Chat"
              id="publishChatEnabled"
              checked={publishSettings.chatEnabled}
              disabled={webrtcPublish.connected}
              onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_CHAT_ENABLED,chatEnabled:e.target.checked})}
            />
          </div>
          <div className="col-6">
            <FormCheckbox
              label="Enable Captions"
              id="publishCaptionsEnabled"
              checked={publishSettings.captionsEnabled}
              disabled={webrtcPublish.connected}
              onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_CAPTIONS_ENABLED,captionsEnabled:e.target.checked})}
            />
          </div>
        </div>

        <div className="row mb-2">
          <div className="col-12">
            <small className="form-text text-muted">{DataChannelRequirements.hint}</small>
          </div>
        </div>
        </div>

        <div hidden={tab !== 'source'}>
        {/* Inputs first: what the stream is made of, before how it gets encoded. */}
        <div className="wz-group">Inputs</div>
        <div className="row wz-inline-row">
          <div className="col-10">
            <PublishVideoDropdown />
          </div>
          <div className="col-2">
            <button
              id="camera-toggle"
              type="button"
              className="control-button"
              title={isCameraOn ? 'Turn the camera off' : 'Turn the camera on'}
              aria-pressed={!isCameraOn}
              aria-label={isCameraOn ? 'Turn the camera off' : 'Turn the camera on'}
              disabled={!publishSettings.videoTrack}
              onClick={toggleCamera}
            >
              <img
                alt=""
                className="noll"
                id={isCameraOn ? "video-off" : "video-on"}
                src={isCameraOn ? videoOnImage : videoOffImage}
              />
            </button>
          </div>
        </div>
        <div className="row wz-inline-row">
          <div className="col-10">
            <PublishAudioDropdown />
          </div>
          <div className="col-2">
            <button
              id="mute-toggle"
              type="button"
              className="control-button"
              title={isMicOn ? 'Mute the microphone' : 'Unmute the microphone'}
              aria-pressed={!isMicOn}
              aria-label={isMicOn ? 'Mute the microphone' : 'Unmute the microphone'}
              disabled={!publishSettings.audioTrack}
              onClick={toggleMicrophone}>
              <img
                alt=""
                className="noll"
                id={isMicOn ? "mute-on" : "mute-off"}
                src={isMicOn ? micOnImage : micOffImage} />
            </button>
          </div>
        </div>
        <div className="wz-rule" />

        <div className="wz-group">Encoding</div>
        <div className="row">
          <div className="col-12">
            <div className="mb-3">
              <label htmlFor="videoCodec">Video Codec</label>
              <select
                className="form-select"
                id="videoCodec"
                name="videoCodec"
                value={publishSettings.videoCodec}
                disabled={webrtcPublish.connected}
                onChange={(e) => dispatch({ type: PublishSettingsActions.SET_PUBLISH_VIDEO_CODEC, videoCodec: e.target.value })}
              >
                {VIDEO_CODEC_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {codecUnavailable ? (
                /* Said here rather than after a failed publish: an unsupported choice is
                   silently replaced with the full offer, so without this note the selector
                   looks like it worked. */
                <small className="wz-field-error" id="videoCodec-unsupported" role="alert">
                  This browser cannot encode {publishSettings.videoCodec} for WebRTC, so the
                  choice is ignored and the browser's full codec list is offered instead, as
                  with Auto. H.265 needs Chrome on Windows, macOS or Android with a hardware
                  HEVC encoder; Edge does not send it at all.
                </small>
              ) : (
                <small className="form-text text-muted">
                  The Engine application has the final say: it only accepts the codecs in
                  its PreferredCodecsVideo setting. Setting a codec here offers only that
                  codec, so if the application does not allow it, no video is sent. Leave
                  it on Auto unless a workflow needs a specific codec.
                </small>
              )}
            </div>
          </div>
        </div>
        <div className="row wz-split-row">
          <div className="col-lg-6 col-sm-12">
            <div className="mb-3">
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
                <span className="input-group-text">fps</span>
              </div>
            </div>
          </div>
          <div className="col-lg-6 col-sm-12">
            <div className="mb-3">
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
        <div className="wz-rule" />

        <PublishSimulcastSettings />
        </div>

        <div hidden={tab !== 'advanced'}>
        <PublishDiagnosticsSettings />

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
                    value={publishSettings.stunServerURL}
                    disabled={webrtcPublish.connected}
                    onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_STUN_SERVER_URL,stunServerURL:e.target.value})}
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
                    value={publishSettings.turnServerURL}
                    disabled={webrtcPublish.connected}
                    onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_TURN_SERVER_URL,turnServerURL:e.target.value})}
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
                    value={publishSettings.turnUsername}
                    disabled={webrtcPublish.connected}
                    onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_TURN_USERNAME,turnUsername:e.target.value})}
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
                    value={publishSettings.turnPassword}
                    disabled={webrtcPublish.connected}
                    onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_TURN_PASSWORD,turnPassword:e.target.value})}
                  />
                </div>
              </div>
            </div>
        { webrtcPublish.connected &&
          <div className="row mt-2">
            <div className="col-12">
              <button
                id="ice-restart-toggle"
                type="button"
                className="btn w-100"
                onClick={handleRestartIce}
                title="Trigger an ICE restart: renegotiates ICE (new ufrag/pwd) without recreating the publish session"
              >Restart ICE</button>
            </div>
          </div>
        }
        </div>

        {/* The primary action stays reachable from every tab rather than living in one. */}
        <div className="wz-actions-dock">
        <div className="row wz-inline-row">
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
              <img alt="" className="noll" id="mute-off" src={fileCopyImage} />
            </button>
          </div>
        </div>
        </div>
      </form>
    </div>
  );
}

export default PublishSettingsForm;
