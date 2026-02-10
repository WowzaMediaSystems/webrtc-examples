import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import QueryString from 'query-string';
import Cookies from 'js-cookie';

import * as PlaySettingsActions from '../../actions/playSettingsActions';
import { getCookieValues } from '../../utils/CookieUtils';
import CookieName from '../../constants/CookieName';

const playUrlParametersMap = {
  "signalingURL":"playSignalingURL",
  "applicationName":"playApplicationName",
  "streamName": "playStreamName",
  "secret": "playSecret",
  "timeout": "playTimeout",
  "prefix": "playPrefix",
  "isIp": "playIsIp",
  "ip": "playIp"
}

const PlaySettingsForm = () => {

  const dispatch = useDispatch();
  const [ initialized, setInitialized ] = useState(false);
  const playSettings = useSelector((state) => state.playSettings);
  const webrtcPlay = useSelector((state) => state.webrtcPlay);

  // load play settings from cookie and URL on mount
  useEffect(() => {
    let cookieValues = getCookieValues(CookieName);
    let qs = QueryString.parse(window.location.search);
    let savedValues = { ...cookieValues, ...qs };

    for (let paramKey in playUrlParametersMap) {
      if (savedValues[playUrlParametersMap[paramKey]] != null) {
        const value = savedValues[playUrlParametersMap[paramKey]];

        switch (playUrlParametersMap[paramKey]) {
          case "playSignalingURL":
            dispatch({ type: PlaySettingsActions.SET_PLAY_SIGNALING_URL, signalingURL: value });
            break;
          case "playApplicationName":
            dispatch({ type: PlaySettingsActions.SET_PLAY_APPLICATION_NAME, applicationName: value });
            break;
          case "playStreamName":
            dispatch({ type: PlaySettingsActions.SET_PLAY_STREAM_NAME, streamName: value });
            break;
          case "playSecret":
            dispatch({ type: PlaySettingsActions.SET_PLAY_SECRET, secret: value });
            break;
          case "playTimeout":
            dispatch({ type: PlaySettingsActions.SET_PLAY_TIMEOUT, timeout: value });
            break;
          case "playPrefix":
            dispatch({ type: PlaySettingsActions.SET_PLAY_PREFIX, prefix: value });
            break;
          case "playIsIp":
            dispatch({ type: PlaySettingsActions.SET_PLAY_IS_IP, isIp: value === 'true' || value === true });
            break;
          case "playIp":
            dispatch({ type: PlaySettingsActions.SET_PLAY_IP, ip: value });
            break;
          default:
        }
      }
    }
    setInitialized(true);
  },[dispatch]);
      
  // save values to Cookie
  useEffect(() => {
    let cookieValues = getCookieValues(CookieName);
    for (let paramKey in playUrlParametersMap) {
      if (playSettings[paramKey] != null) {
        cookieValues[playUrlParametersMap[paramKey]] = playSettings[paramKey];
      }
    }
    Cookies.set(CookieName, escape(JSON.stringify(cookieValues)));
  }, [playSettings]);

  // Share link functionality
  const handleShareLink = () => {
    const params = new URLSearchParams();

    for (let paramKey in playUrlParametersMap) {
      const value = playSettings[paramKey];
      if (value != null && value !== '') {
        params.set(playUrlParametersMap[paramKey], value);
      }
    }

    const shareUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;

    navigator.clipboard.writeText(shareUrl).then(() => {
      alert('Share link copied to clipboard!');
    }).catch(err => {
      console.error('Failed to copy link:', err);
    });
  };

  if (!initialized)
    return null;

  return (
    <div className="col-md-4 col-sm-12" id="play-settings">
      <form id="play-settings-form">
        <div className="row">
          <div className="col-12">
            <div className="form-group">
              <label htmlFor="playSignalingURL">Signaling URL</label>
              <input
                type="text" 
                className="form-control" 
                id="playSignalingURL" 
                name="playSignalingURL" 
                maxLength="1024" 
                placeholder="wss://[ssl-certificate-domain-name]/webrtc-session.json" 
                value={playSettings.signalingURL}
                disabled={webrtcPlay.connected}
                onChange={(e) => dispatch({ type: PlaySettingsActions.SET_PLAY_SIGNALING_URL, signalingURL: e.target.value })}
              />
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-6">
            <div className="form-group">
              <label htmlFor="playApplicationName">Application Name</label>
              <input
                type="text" 
                className="form-control" 
                id="playApplicationName" 
                name="playApplicationName" 
                maxLength="256" 
                value={playSettings.applicationName}
                disabled={webrtcPlay.connected}
                onChange={(e) => dispatch({ type: PlaySettingsActions.SET_PLAY_APPLICATION_NAME, applicationName: e.target.value })}
              />
            </div>
          </div>
          <div className="col-6">
            <div className="form-group">
              <label htmlFor="playStreamName">Stream Name</label>
              <input
                type="text" 
                className="form-control" 
                id="playStreamName" 
                name="playStreamName" 
                maxLength="256" 
                value={playSettings.streamName}
                disabled={webrtcPlay.connected}
                onChange={(e) => dispatch({ type: PlaySettingsActions.SET_PLAY_STREAM_NAME, streamName: e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* Secure Token Data Section */}
        <div className="row">
          <div className="col-12">
            <b>Secure Token Data:</b>
          </div>
        </div>
        <div className="row">
          <div className="col-12">
            <div className="form-group">
              <label htmlFor="playSecret">Shared Secret</label>
              <input
                type="text"
                className="form-control"
                id="playSecret"
                name="playSecret"
                maxLength="256"
                value={playSettings.secret || ''}
                disabled={webrtcPlay.connected}
                onChange={(e) => dispatch({ type: PlaySettingsActions.SET_PLAY_SECRET, secret: e.target.value })}
              />
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-6">
            <div className="form-group">
              <label htmlFor="playTimeout">Token Timeout <i>(in seconds)</i></label>
              <input
                type="text"
                className="form-control"
                id="playTimeout"
                name="playTimeout"
                maxLength="256"
                value={playSettings.timeout || ''}
                disabled={webrtcPlay.connected}
                onChange={(e) => dispatch({ type: PlaySettingsActions.SET_PLAY_TIMEOUT, timeout: e.target.value })}
              />
            </div>
          </div>
          <div className="col-6">
            <div className="form-group">
              <label htmlFor="playPrefix">Hash Query Parameter Prefix</label>
              <input
                type="text"
                className="form-control"
                id="playPrefix"
                name="playPrefix"
                maxLength="256"
                placeholder="wowzatoken"
                value={playSettings.prefix || ''}
                disabled={webrtcPlay.connected}
                onChange={(e) => dispatch({ type: PlaySettingsActions.SET_PLAY_PREFIX, prefix: e.target.value })}
              />
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-6">
            <div className="form-group">
              <label htmlFor="playIsIp">Include Client IP Address</label>
              <input
                type="checkbox"
                className="form-control"
                id="playIsIp"
                name="playIsIp"
                checked={playSettings.isIp || false}
                disabled={webrtcPlay.connected}
                onChange={(e) => dispatch({ type: PlaySettingsActions.SET_PLAY_IS_IP, isIp: e.target.checked })}
              />
            </div>
          </div>
          <div className="col-6">
            <div className="form-group">
              <label htmlFor="playIp">Client IP Address</label>
              <input
                type="text"
                className="form-control"
                id="playIp"
                name="playIp"
                maxLength="256"
                value={playSettings.ip || ''}
                disabled={webrtcPlay.connected}
                onChange={(e) => dispatch({ type: PlaySettingsActions.SET_PLAY_IP, ip: e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* Play/Stop and Share buttons */}
        <div className="row">
          <div className="col-10">
            { !webrtcPlay.connected && 
              <button
                id="play-toggle"
                type="button"
                className="btn"
                disabled={playSettings.playStarting}
                onClick={(e)=>dispatch(PlaySettingsActions.startPlay())}
              >Play</button>
            }
            { webrtcPlay.connected &&
              <button
                id="play-toggle"
                type="button"
                className="btn"
                onClick={(e)=>dispatch(PlaySettingsActions.stopPlay())}
              >Stop</button>
            }
          </div>
          <div className="col-2">
            <button
              id="play-share-link"
              type="button"
              className="control-button mt-0"
              onClick={handleShareLink}
            >
              <img alt="Copy Link" className="noll" src="./images/file_copy-24px.svg" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default PlaySettingsForm;