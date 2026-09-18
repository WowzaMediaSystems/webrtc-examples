import React from 'react';

/*
 * The same switch as everywhere else in this panel, read as a choice between two named
 * things rather than as on and off.
 *
 * It stays a single checkbox, because that is what it is: one boolean in the store, one
 * boolean on the wire. Only the presentation changes. The word on the left is the false
 * state, the word on the right is the true state, and the selected side is the one in full
 * strength text.
 *
 * The two words are not controls. Making them clickable would mean either two buttons
 * beside a switch that does the same job, or a <label htmlFor> that toggles rather than
 * selects, so that clicking the side already chosen would switch away from it. The switch
 * is the control, and the words say what it means.
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
    {/* A span, not a label: the caption names the pair, and the switch's own accessible
        name below says what checking it does. Two labels for one control is one too many. */}
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
