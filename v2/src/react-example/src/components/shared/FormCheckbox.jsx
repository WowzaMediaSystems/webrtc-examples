import React from 'react';

const FormCheckbox = ({ label, id, checked, onChange, disabled }) => (
  <div className="mb-3 form-switch form-check-inline">
    <label className="form-check-label me-3" htmlFor={id}>
      {label}
    </label>
    <input
      id={id}
      name={id}
      className="form-check-input orange-checkbox"
      type="checkbox"
      checked={checked || false}
      disabled={disabled}
      onChange={onChange}
    />
  </div>
);

export default FormCheckbox;
