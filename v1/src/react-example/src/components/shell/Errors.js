import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { HIDE_ERROR_PANEL } from '../../actions/errorsActions';

const Errors = () => {

  const dispatch = useDispatch();
  const errors = useSelector( (state) => state.errors );

  if (errors.show === false) {
    return null;
  }

  return (
    <div className="row justify-content-center mt-3" id="error-panel">
      <div className="col-10 alert alert-danger alert-dismissible p-2">
        <button id="error-panel-close" type="button" className="close" aria-label="Close" onClick={()=>dispatch({type:HIDE_ERROR_PANEL})}>
          <span aria-hidden="true">&times;</span>
        </button>
        <div id="error-messages">{ errors.message }</div>
      </div>
    </div>
  );
}

export default Errors;