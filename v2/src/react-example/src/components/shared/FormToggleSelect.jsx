import React from 'react';

/*
 * A single checkbox (one boolean in the store and on the wire) shown as a choice between two
 * words: left is false, right is true. The words are not controls; the switch is.
 */
const FormToggleSelect = ({
  label,
  id,
  offLabel,
  onLabel,
  checked = false,
  disabled = false,
  onChange,
}) => (
  <div className="mb-3">
    {/* A span, not a label: the switch has its own accessible name. */}
    <span className="wz-toggle-select__caption">{label}</span>
    <div className="wz-toggle-select">
      {/* data-label reserves the bold width, so selecting a side does not shift the words. */}
      <span className="wz-toggle-select__side" data-label={offLabel} data-active={!checked}>
        {offLabel}
      </span>
      <input
        id={id}
        name={id}
        className="form-check-input orange-checkbox"
        type="checkbox"
        role="switch"
        aria-label={`Use ${onLabel}`}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span className="wz-toggle-select__side" data-label={onLabel} data-active={checked}>
        {onLabel}
      </span>
    </div>
  </div>
);

export default FormToggleSelect;
