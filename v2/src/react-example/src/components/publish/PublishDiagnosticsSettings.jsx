import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import * as PublishSettingsActions from '../../actions/publishSettingsActions';
import FormCheckbox from '../shared/FormCheckbox';
import { latencyProbeSupport } from '../../diagnostics/latencyProbe';
import { burnedClockUnavailableReason } from '../../diagnostics/burnedClock';

/*
 * The publisher's Diagnostics group: the frame stamp and the burned-in clock.
 *
 * Its own component because it is its own feature. Spread through the settings form it was
 * two imports, two derived reasons and a block of markup in three different places, so any
 * change to either diagnostic touched a file that is otherwise about connecting and encoding.
 *
 * The settings form keeps the cookie and query-string entries for these two flags, because
 * those belong to the form's own load and save, not to the controls.
 */
const PublishDiagnosticsSettings = () => {
  const dispatch = useDispatch();
  const publishSettings = useSelector((state) => state.publishSettings);
  const webrtcPublish = useSelector((state) => state.webrtcPublish);

  /*
   * Two independent reasons the frame stamp cannot be written, kept apart because they need
   * different words. The browser question is insertable streams; the codec question is that
   * the stamp is an H.264 SEI NAL and nothing else here carries one. 'auto' passes: the
   * server picks the codec, so the answer is not known until the session is up, and the
   * player panel reads "no frame stamp" if it comes back as something else.
   */
  const probeSupport = latencyProbeSupport();
  const probeCodec = String(publishSettings.videoCodec || 'auto').toUpperCase();
  const probeBlockedReason = !probeSupport.supported
    ? probeSupport.reason
    : (probeCodec !== 'AUTO' && probeCodec !== 'H264'
      ? 'The frame stamp is an H.264 SEI NAL, and the Video Codec on the Source tab is set to '
        + `${publishSettings.videoCodec}. Only H.264 carries the stamp in this build.`
      : null);

  /*
   * Auto is not a blocker, because the server may well answer H.264, but it is not a promise
   * either: a server that answers VP8 leaves the probe running and writing nothing, and the
   * only place that shows up is the player, several steps later. Said here, where the codec is
   * chosen, it costs one sentence.
   */
  const burnedClockBlockedReason = burnedClockUnavailableReason();

  const probeCodecAtRisk = probeSupport.supported
    && probeBlockedReason === null
    && probeCodec === 'AUTO'
    && publishSettings.latencyProbe;

  return (
    <>
        <div className="wz-group">Diagnostics</div>
        {/* A diagnostic, off by default. It changes the peer connection configuration
            (encodedInsertableStreams), so it cannot be switched mid-session. */}
        <div className="row wz-setting">
          <div className="col-12">
            <FormCheckbox
              label="Latency Probe (frame stamp)"
              id="publishLatencyProbe"
              checked={publishSettings.latencyProbe}
              disabled={webrtcPublish.connected || probeBlockedReason !== null}
              onChange={(e) => dispatch({
                type: PublishSettingsActions.SET_PUBLISH_LATENCY_PROBE,
                latencyProbe: e.target.checked,
              })}
            />
            {probeCodecAtRisk && (
              <small className="form-text text-muted" id="publishLatencyProbe-codec-risk">
                The stamp needs H.264, and Video Codec is on Auto, so the server chooses. If it
                answers VP8 or VP9 the player will report no frame stamp. Set H.264 on the Source
                tab to be certain.
              </small>
            )}
            {probeBlockedReason ? (
              <small className="wz-field-error" id="publishLatencyProbe-unavailable" role="alert">
                {probeBlockedReason}
              </small>
            ) : (
              <small className="form-text text-muted">
                Stamps every encoded frame with a timestamp so the player can report how long
                the trip through the Engine actually took. The player has to have it on as
                well. Diagnostic only, and it does not measure camera capture or the encoder
                queue ahead of the stamp.
              </small>
            )}
          </div>
        </div>

        {/*
          * The visible counterpart to the frame stamp. The stamp is machine readable and
          * invisible; this is the same idea in digits, so the figure the panel reports can be
          * held against two screens and checked by eye.
          *
          * Unlike the probe this one takes effect while publishing: it changes the track, and
          * replacing a track on a live sender is something the publisher already does when the
          * camera changes.
          */}
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
