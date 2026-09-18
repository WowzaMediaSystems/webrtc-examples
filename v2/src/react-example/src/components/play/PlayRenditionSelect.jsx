import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';

import * as PlaySettingsActions from '../../actions/playSettingsActions';
import { listAvailableStreams, renditionsFor, signalingLookupUrl } from '../../utils/RenditionUtils';

/*
 * Rendition picker.
 *
 * The Engine republishes a simulcast ingest as one stream per rendition, so picking a
 * rendition here is picking a stream name; see RenditionUtils for the shape and how it was
 * verified. The list is looked up on demand rather than polled, because it only changes
 * when someone starts or stops publishing.
 *
 * Lookup needs the signalling socket, but that does not rule out WHEP: the WHEP origin is
 * the same host, so the socket URL is derived from it. Rendition playback itself needs
 * nothing special from either protocol, because the rendition is in the stream name and the
 * WHEP URL carries the stream name too.
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
      {/* The same two sentences whatever the transport. They used to differ, so switching
          transport changed the wording although nothing about the lookup had changed. */}
      <small className="form-text text-muted" id="playRendition-hint">
        {!lookupUrl
          ? 'Enter the server URL first; renditions are looked up from that host.'
          : status || 'Ask the Engine which renditions of this stream are live.'}
      </small>
    </div>
  );
};

export default PlayRenditionSelect;
