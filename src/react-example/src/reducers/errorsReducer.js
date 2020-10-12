import * as ErrorsActions from '../actions/errorsActions';

const initialState = {
  message: '',
  show: false
}

const errorsReducer = (state = initialState, action) => {
  switch (action.type) {
    case ErrorsActions.SET_ERROR_MESSAGE:
      return { message:action.message, show: true };
    case ErrorsActions.HIDE_ERROR_PANEL:
      return { message: '', show: false };
    default:
      return state
  }
}

export default errorsReducer;
