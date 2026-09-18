import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import * as PublishSettingsActions from '../../actions/publishSettingsActions';
import { MAX_SIMULCAST_RENDITIONS, MAX_RID_LENGTH, createSimulcastRendition, sortSimulcastRenditions } from '../../utils/SimulcastUtils';
import CollapsibleSection from '../shared/CollapsibleSection';

// Collapsible Simulcast drawer: the on/off toggle plus a table to configure
// each rendition. Rows are kept in SDP preference order, derived from scale
// down (highest last); they re-sort when a scale down edit is finished.
// RID, max bitrate and the number of renditions are negotiated in the offer,
// so they lock while connected; scale down can change mid-stream.

// Scale down edits are kept in a local draft and only dispatched on blur, so
// a row doesn't jump away while typing and mid-stream setParameters runs once
// per finished edit instead of on every keystroke.
const SimulcastRenditionRow = ({ rendition, setupLocked, simulcastDisabled, removable, onFieldChange, onScaleEdited, onRemove }) => {

  const [scaleDraft, setScaleDraft] = useState(null);

  const finishScaleEdit = () => {
    if (scaleDraft == null) return;
    setScaleDraft(null);
    onScaleEdited(scaleDraft);
  };

  return (
    <tr>
      <td>
        <input
          type="text"
          className="form-control form-control-sm"
          maxLength={MAX_RID_LENGTH}
          value={rendition.rid}
          disabled={setupLocked}
          onChange={(e) => onFieldChange('rid', e.target.value)}
        />
      </td>
      <td>
        <input
          type="number"
          className="form-control form-control-sm"
          min="1"
          step="any"
          value={scaleDraft ?? rendition.scaleResolutionDownBy}
          disabled={simulcastDisabled}
          onChange={(e) => setScaleDraft(e.target.value)}
          onBlur={finishScaleEdit}
        />
      </td>
      <td>
        <input
          type="number"
          className="form-control form-control-sm"
          min="1"
          value={rendition.maxBitrate}
          disabled={setupLocked}
          onChange={(e) => onFieldChange('maxBitrate', e.target.value)}
        />
      </td>
      <td>
        <button
          type="button"
          className="btn btn-sm p-0"
          title="Remove rendition"
          disabled={setupLocked || !removable}
          onClick={onRemove}
        >
          <i className="bi bi-x-lg"></i>
        </button>
      </td>
    </tr>
  );
}

const PublishSimulcastSettings = () => {

  const dispatch = useDispatch();
  const publishSettings = useSelector((state) => state.publishSettings);
  const webrtcPublish = useSelector((state) => state.webrtcPublish);

  const renditions = publishSettings.simulcastRenditions;
  const simulcastDisabled = !publishSettings.useSimulcast;
  const setupLocked = simulcastDisabled || webrtcPublish.connected;

  const setRenditions = (simulcastRenditions) => {
    dispatch({
      type: PublishSettingsActions.SET_PUBLISH_SIMULCAST_RENDITIONS,
      simulcastRenditions
    });
  };

  const updateRendition = (index, field, value) => {
    setRenditions(renditions.map((rendition, i) =>
      i === index ? { ...rendition, [field]: value } : rendition
    ));
  };

  const finishScaleEdit = (index, value) => {
    if (Number(value) === Number(renditions[index].scaleResolutionDownBy)) return;
    const updated = renditions.map((rendition, i) =>
      i === index ? { ...rendition, scaleResolutionDownBy: value } : rendition
    );
    setRenditions(sortSimulcastRenditions(updated));
  };

  const addRendition = () => {
    setRenditions(sortSimulcastRenditions([...renditions, createSimulcastRendition()]));
  };

  const removeRendition = (index) => {
    setRenditions(renditions.filter((_, i) => i !== index));
  };

  return (
    <CollapsibleSection title="Simulcast">
      <div className="form-check form-switch form-check-inline mb-3">
        <label className='form-check-label mr-3' htmlFor="publishUseSimulcast">
          Enable Simulcast
        </label>
        <input
          className='form-check-input form-switch orange-checkbox'
          type="checkbox"
          id="publishUseSimulcast"
          name="publishUseSimulcast"
          checked={publishSettings.useSimulcast || false}
          disabled={webrtcPublish.connected}
          onChange={(e) => dispatch({
            type: PublishSettingsActions.SET_PUBLISH_USE_SIMULCAST,
            useSimulcast: e.target.checked
          })}
        />
      </div>

      <table className="table table-sm align-middle mb-2" id="simulcast-renditions">
        <thead>
          <tr>
            <th>RID</th>
            <th>Scale Down</th>
            <th>Max Bitrate (bps)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {renditions.map((rendition, index) => (
            <SimulcastRenditionRow
              key={rendition.id}
              rendition={rendition}
              setupLocked={setupLocked}
              simulcastDisabled={simulcastDisabled}
              removable={renditions.length > 1}
              onFieldChange={(field, value) => updateRendition(index, field, value)}
              onScaleEdited={(value) => finishScaleEdit(index, value)}
              onRemove={() => removeRendition(index)}
            />
          ))}
        </tbody>
      </table>

      <button
        type="button"
        className="btn btn-sm btn-drawer-toggle"
        disabled={setupLocked || renditions.length >= MAX_SIMULCAST_RENDITIONS}
        onClick={addRendition}
      >
        <i className="bi bi-plus-lg me-1"></i>Add rendition
      </button>
    </CollapsibleSection>
  );
}

export default PublishSimulcastSettings;
