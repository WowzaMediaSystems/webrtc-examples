/*
  State
*/

let callbacks = {};
let state = {
  ready:false,
  connectionState:'closed',
  wsUrl: null,
  wsConnection: null,
  streamInfo: null,
}

/*
  Public methods
  -- external interface --
*/
const set = async (props) => {
  console.log('WowzaWebRTCAPI.set');
  console.log(props);

  let currentState = getState();
  let newState = {};

  if (props.wsUrl != null)
    newState['wsUrl'] = props.wsUrl.trim();
  if (props.streamInfo != null)
    newState['streamInfo'] = props.streamInfo;

  try
  {
    await setState(newState);
    return getState();
  }
  catch (e)
  {
    errorHandler(e);
    return null;
  }
}

const getState = () =>
{
  return state;
}

const on = (_callbacks) => {
  callbacks = _callbacks;
}

const openConnection = () => {
  console.log('WowzaWebRTCAPI.openConnection()');
  wsConnect(getState().wsUrl);
}

const closeConnection = () => {
  console.log('WowzaWebRTCAPI.closeConnection()');
  if(getState().wsConnection)
    getState().wsConnection.close();
}

const pollAvailableStreams = () => {
  // console.log("WowzaPeerConnectionAPI.pollAvailableStreams");
  let wsConnection = getState().wsConnection;
  let streamInfo = getState().streamInfo;
  if (wsConnection != null)
  {
    console.log("wsConnection.send");
    wsConnection.send('{"direction":"publish", "command":"getAvailableStreams", "streamInfo":' + JSON.stringify(streamInfo) + '}');
  }
}

/*
  Private methods
*/

const setState = (newState) =>
{
  return new Promise((resolve,reject) => {
    state = {...state,...newState};
    if (callbacks.onStateChanged != null)
    {
      callbacks.onStateChanged(state);
    }
    resolve(state);
  });
}

const errorHandler = (error) =>
{
  console.log('WowzaWebRTCAPI ERROR:');
  console.log(error);
  if (error.message == null)
  {
    if (error.target != null)
    {
      console.log('typeof error.target: ' + typeof error.target);
    }
  }
  let newError = {...error}
  if (callbacks.onError != null)
  {
    callbacks.onError(error);
  }
}

/*
  Web Socket interface
*/

function wsConnect(url) {
  let wsConnection = getState().wsConnection;
  try
  {
    wsConnection = new WebSocket(url);
    setState({wsConnection: wsConnection, connectionState: "open"});
  }
  catch(e)
  {
    errorHandler(e);
    return;
  }

  wsConnection.binaryType = 'arraybuffer';

  wsConnection.onopen = function () {
    console.log("WowzaWebRTCAPI.wsConnection.onopen");
  }

  wsConnection.onmessage = function (evt) {
    // console.log("WowzaWebRTCAPI.wsConnection.onmessage: " + evt.data);

    var msgJSON = JSON.parse(evt.data);
    var msgStatus = Number(msgJSON['status']);
    var msgCommand = msgJSON['command'];

    if(msgStatus == 504) {
      // we need to swallow these because they happen as new streams join and we don't want to break the connection over it
      console.log("WowzaWebRTCAPI.wsConnection.onmessage: new stream joining, skipping polling");
    }
    else if (msgStatus != 200) {
      closeConnection();
      errorHandler({message:msgJSON['statusDescription']});
    }
    else if ('getAvailableStreams'.localeCompare(msgCommand) == 0) {
      callbacks.onAvailableStreams(msgJSON);
    }
  }

  wsConnection.onclose = function () {
    console.log("WowzaPeerConnectionAPI.wsConnection.onclose");
    setState({connectionState: "closed"});
  }

  wsConnection.onerror = function (error) {
    console.log('wsConnection.onerror');
    console.log(error);
    let message = "Websocket connection failed: " + url;
    console.log(message);
    let newError = {message:message,...error};
    closeConnection();
    errorHandler(newError);
  }
}

/*
  Export
*/

let WowzaWebRTCAPI = {
  on: on,
  set: set,
  getState: getState,
  openConnection: openConnection,
  closeConnection: closeConnection,
  pollAvailableStreams: pollAvailableStreams
}
export default WowzaWebRTCAPI;
