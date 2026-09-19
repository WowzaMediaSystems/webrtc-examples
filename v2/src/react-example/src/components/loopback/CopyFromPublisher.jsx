import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import * as PlaySettingsActions from '../../actions/playSettingsActions';

/*
 * Fills the player's connection settings from the publisher's.
 *
 * On this page both sides point at the same Engine and the same stream almost every time,
 * so typing it twice is pure friction. WHIP and WHEP share the same field but not the same
 * flag, so the transport choice is carried across as its opposite number rather than copied
 * literally.
 *
 * The STUN and TURN settings are deliberately not copied: the two sides can legitimately
 * take different paths through a network, and quietly overwriting an ICE configuration the
 * user set on purpose is worse than making them set it twice.
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
  /*
   * The confirmation timer, held so it can be cancelled. This component is unmounted whenever
   * the combined page switches sides, and a setState landing after that is a React warning and
   * a timer nobody owns.
   */
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
    /*
     * The probe travels with the rest. Copying every setting except this one produced a player
     * pointed at the right stream that could not measure the publisher it had just copied,
     * which reads as the probe being broken rather than as a setting being missed.
     */
    dispatch({
      type: PlaySettingsActions.SET_PLAY_LATENCY_PROBE,
      latencyProbe: Boolean(publishSettings.latencyProbe),
    });

    setCopied(true);
    // Held so it can be cancelled: this component unmounts when the side is switched, and a
    // setState landing after that is a warning and a leak.
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
