import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import * as PublishSettingsActions from '../../actions/publishSettingsActions';
import FormCheckbox from '../shared/FormCheckbox';
import { burnedClockUnavailableReason } from '../../diagnostics/burnedClock';

/*
 * The publisher's Diagnostics group: the burned-in clock. The settings
 * form still owns the cookie and query-string entries for these flags.
 */
const PublishDiagnosticsSettings = () => {
  const dispatch = useDispatch();
  const publishSettings = useSelector((state) => state.publishSettings);

  const burnedClockBlockedReason = burnedClockUnavailableReason();

  return (
    <>
        <div className="wz-group">Diagnostics</div>
        <div className="row wz-setting">
          <div className="col-12">
            <FormCheckbox
              label="Burn a clock into the video"
              id="publishBurnedClock"
              checked={publishSettings.burnedClock}
              disabled={burnedClockBlockedReason !== null}
              onChange={(e) => dispatch({
                type: PublishSettingsActions.SET_PUBLISH_BURNED_CLOCK,
                burnedClock: e.target.checked,
              })}
            />
            {burnedClockBlockedReason ? (
              <small className="wz-field-error" id="publishBurnedClock-unavailable" role="alert">
                {burnedClockBlockedReason}
              </small>
            ) : (
              <small className="form-text text-muted">
                Draws the time, to the millisecond, onto every frame before it is encoded. Put
                the publisher and the player side by side and the difference between the two
                clocks is the delay you can see. Every frame is redrawn to do it, so switch it
                off when you are done looking.
              </small>
            )}
          </div>
        </div>
    </>
  );
};

export default PublishDiagnosticsSettings;
