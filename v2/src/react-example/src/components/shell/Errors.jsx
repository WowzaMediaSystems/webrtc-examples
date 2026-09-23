import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { HIDE_ERROR_PANEL } from '../../actions/errorsActions';

/*
 * Error banner. Rendered in the page header rather than inline in the content, so a
 * failure is visible wherever the user has scrolled to and does not shift the layout
 * of the page underneath it.
 */
const Errors = () => {
  const dispatch = useDispatch();
  const errors = useSelector((state) => state.errors);

  if (errors.show === false) return null;

  return (
    <div className="wz-error" role="alert" id="error-panel">
      <span className="wz-error__icon" aria-hidden="true">!</span>
      <div className="wz-error__message" id="error-messages">{errors.message}</div>
      <button
        id="error-panel-close"
        type="button"
        className="wz-error__close"
        aria-label="Dismiss error"
        onClick={() => dispatch({ type: HIDE_ERROR_PANEL })}
      >
        &times;
      </button>
    </div>
  );
};

export default Errors;