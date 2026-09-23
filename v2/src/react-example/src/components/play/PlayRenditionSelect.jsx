import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';

import * as PlaySettingsActions from '../../actions/playSettingsActions';
import { listAvailableStreams, renditionsFor, signalingLookupUrl } from '../../utils/RenditionUtils';

/*
 * Rendition picker. Picking a rendition is picking a stream name (see RenditionUtils). The
 * list is looked up on demand, not polled; under WHEP the socket URL is derived from the origin.
 */
const PlayRenditionSelect = () => {
  const dispatch = useDispatch();
  const playSettings = useSelector((state) => state.playSettings);
  const { connected } = useSelector((state) => state.webrtcPlay);

  const [streams, setStreams] = useState(null);
  const [status, setStatus] = useState(null);
  const [looking, setLooking] = useState(false);

  const lookupUrl = signalingLookupUrl(playSettings.signalingURL);
  const options = renditionsFor(playSettings.streamName, streams);

  const look = async () => {
    setLooking(true);
    setStatus(null);
    const found = await listAvailableStreams(lookupUrl, playSettings.applicationName);
    setLooking(false);
    setStreams(found);

    if (found === null) {
      setStatus(`Could not reach the Engine at ${lookupUrl} to look this up.`);
    } else if (renditionsFor(playSettings.streamName, found).length === 0) {
      setStatus(
        found.includes(playSettings.streamName)
          ? 'This stream has no simulcast renditions.'
          : 'That stream is not live on this application.'
      );
    }
  };

  return (
    <div className="mb-3">
      <label htmlFor="playRendition">Rendition</label>
      <div className="wz-inline-row">
        <div className="col">
          <select
            className="form-select"
            id="playRendition"
            name="playRendition"
            aria-describedby="playRendition-hint"
            value={playSettings.streamName || ''}
            disabled={connected || options.length === 0}
            onChange={(e) =>
              dispatch({
                type: PlaySettingsActions.SET_PLAY_STREAM_NAME,
                streamName: e.target.value,
              })
            }
          >
            {options.length === 0 ? (
              <option value={playSettings.streamName || ''}>
                {playSettings.streamName || 'No stream name set'}
              </option>
            ) : (
              options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))
            )}
          </select>
        </div>
        <div className="col-auto">
          <button
            id="play-find-renditions"
            type="button"
            className="btn btn-sm wz-secondary-button"
            disabled={connected || looking || !lookupUrl || !playSettings.streamName}
            onClick={look}
          >
            {looking ? 'Looking…' : 'Find'}
          </button>
        </div>
      </div>
      {/* Same wording under either transport. */}
      <small className="form-text text-muted" id="playRendition-hint">
        {!lookupUrl
          ? 'Enter the server URL first; renditions are looked up from that host.'
          : status || 'Ask the Engine which renditions of this stream are live.'}
      </small>
    </div>
  );
};

export default PlayRenditionSelect;
