import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import * as PlaySettingsActions from '../../actions/playSettingsActions';
import FormCheckbox from '../shared/FormCheckbox';
import { latencyProbeSupport } from '../../diagnostics/latencyProbe';

/*
 * The player's Diagnostics group: the frame stamp reader. The settings form still owns the
 * cookie and query-string entry for the flag.
 */
const PlayDiagnosticsSettings = () => {
  const dispatch = useDispatch();
  const playSettings = useSelector((state) => state.playSettings);
  const { connected } = useSelector((state) => state.webrtcPlay);

  const probeSupport = latencyProbeSupport();

  const handleCheckboxChange = (actionType, key) => (e) => {
    dispatch({ type: actionType, [key]: e.target.checked });
  };

  return (
    <>
        <div className="wz-group">Diagnostics</div>
        {/* Sets encodedInsertableStreams on the peer connection, so not switchable mid-session. */}
        <div className="row wz-setting">
          <div className="col-12">
            <FormCheckbox
              label="Latency Probe (frame stamp)"
              id="playLatencyProbe"
              checked={playSettings.latencyProbe}
              disabled={connected || !probeSupport.supported}
              onChange={handleCheckboxChange(PlaySettingsActions.SET_PLAY_LATENCY_PROBE, 'latencyProbe')}
            />
            {probeSupport.supported ? (
              <small className="form-text text-muted">
                Reads the publisher's frame stamp and reports how long the trip through the
                Engine took, separately from this browser's own decode and display time. The
                publisher has to have it on too, and the stream has to be H.264.
              </small>
            ) : (
              <small className="wz-field-error" id="playLatencyProbe-unavailable" role="alert">
                {probeSupport.reason}
              </small>
            )}
          </div>
        </div>
    </>
  );
};

export default PlayDiagnosticsSettings;
