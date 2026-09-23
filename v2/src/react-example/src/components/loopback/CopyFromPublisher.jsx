import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import * as PlaySettingsActions from '../../actions/playSettingsActions';

/*
 * Fills the player's connection settings from the publisher's. STUN and TURN are not copied:
 * the two sides can legitimately need different ICE paths.
 */
const FIELDS = [
  ['signalingURL', PlaySettingsActions.SET_PLAY_SIGNALING_URL, 'signalingURL'],
  ['applicationName', PlaySettingsActions.SET_PLAY_APPLICATION_NAME, 'applicationName'],
  ['streamName', PlaySettingsActions.SET_PLAY_STREAM_NAME, 'streamName'],
  ['authToken', PlaySettingsActions.SET_PLAY_AUTH_TOKEN, 'authToken'],
];

const CopyFromPublisher = () => {
  const dispatch = useDispatch();
  const publishSettings = useSelector((state) => state.publishSettings);
  const { connected } = useSelector((state) => state.webrtcPlay);
  const [copied, setCopied] = useState(false);
  // Held so it can be canceled: switching sides unmounts this component.
  const confirmTimer = useRef(null);
  useEffect(() => () => window.clearTimeout(confirmTimer.current), []);


  const copy = () => {
    FIELDS.forEach(([from, type, key]) => {
      dispatch({ type, [key]: publishSettings[from] ?? '' });
    });
    // WHIP on the publisher means WHEP on the player: the same transport, the other end.
    dispatch({
      type: PlaySettingsActions.SET_PLAY_USE_WHEP,
      useWhep: Boolean(publishSettings.useWhip),
    });
    dispatch({
      type: PlaySettingsActions.SET_PLAY_CHAT_ENABLED,
      chatEnabled: Boolean(publishSettings.chatEnabled),
    });
    dispatch({
      type: PlaySettingsActions.SET_PLAY_CAPTIONS_ENABLED,
      captionsEnabled: Boolean(publishSettings.captionsEnabled),
    });
    // Without the probe flag the player cannot measure the publisher it just copied.
    dispatch({
      type: PlaySettingsActions.SET_PLAY_LATENCY_PROBE,
      latencyProbe: Boolean(publishSettings.latencyProbe),
    });

    setCopied(true);
    confirmTimer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mb-3">
      <button
        type="button"
        id="copy-from-publisher"
        className="btn btn-sm wz-secondary-button w-100"
        disabled={connected}
        onClick={copy}
      >
        {copied ? 'Copied from publisher' : 'Copy settings from publisher'}
      </button>
      <small className="form-text text-muted">
        Takes the URL, application, stream, token, transport and data channels from the
        publisher. ICE servers are left alone, because the two sides can need different ones.
      </small>
    </div>
  );
};

export default CopyFromPublisher;
