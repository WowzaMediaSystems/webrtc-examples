/*
 * This code and all components (c) Copyright 2019-2020, Wowza Media Systems, LLC. All rights reserved.
 * This code is licensed pursuant to the BSD 3-Clause License.
 */

import Settings from './lib/Settings.js';
import WowzaWebRTCPlay from './lib/WowzaWebRTCPlay.js';

let state = {
  settings: {
    playSdpURL: "",
    playApplicationName: "",
    playStreamName: ""
  }
};
let statePrefix = 'play';

const init = (errorHandler,connected,stopped) => {
  initListeners();
  window.wowzaWebRTCPlay = new WowzaWebRTCPlay();
  wowzaWebRTCPlay.on({
    onError:errorHandler,
    onStateChanged: (state) => {
      if (state.connectionState === 'connected')
      {
        connected();
      }else {
        stopped();
      }
    }
  });
  wowzaWebRTCPlay.set({
    videoElementPlay:document.getElementById('player-video'),
  });
}

const getState = () => {
  return state;
}

const start = (settings) => {
  update(settings).then(() => {
    wowzaWebRTCPlay.play();
  });
}

const stop = () => {
  wowzaWebRTCPlay.stop();
}

const update = (settings) => {
  state.settings = settings;
  let sendSettings = {};
  for (let key in settings)
  {
    let sendKey = key.substring(statePrefix.length);
    sendKey = sendKey[0].toLowerCase() + sendKey.slice(1);
    sendSettings[sendKey] = settings[key];
  }
  return wowzaWebRTCPlay.set(sendSettings);
}

/*
  Helpers
*/



/*
  UI updaters
*/
const onPlayPeerConnected = () => {
  state.playing = true;
  hideErrorPanel();
  $("#play-toggle").html("Stop");
  $("#play-settings-form :input").prop("disabled", true);
  $("#play-settings-form :button").prop("disabled", false);
  $('#player-video').show();
  $("#play-video-container").css("background-color","rgba(102, 102, 102, 0)")
}

const onPlayPeerConnectionStopped = () => {
  state.playing = false;
  $("#play-toggle").html("Play");
  $("#play-settings-form :input").prop("disabled", false);
  $('#player-video').hide();
  $("#play-video-container").css("background-color","rgba(102, 102, 102, 1)")
}

// error Handler
const errorHandler = (error) => {
  let message;
  if ( error.message ) {
    message = error.message;
  }
  else {
    message = error
  }
  showErrorPanel(message);
};

const showErrorPanel = (message) => {
  message = "<div>"+message+"</div>";
  $("#error-messages").html(message);
  $("#error-panel").removeClass('invisible');
}

const hideErrorPanel = () => {
  $("#error-messages").html("&nbsp;");
  $("#error-panel").addClass('invisible');
}

/*
  Listeners
*/
// Listeners
const initListeners = () => {
  $('#play-share-link').click(() => {
    Settings.shareLink(Settings.mapFromForm(Settings.serializeArrayFormValues($( "#play-settings-form" ))),"Share link copied to clipboard!")
  })

  $("#play-toggle").click((e) => {
    if (state.playing)
    {
      wowzaWebRTCPlay.stop();
    }
    else
    {
      let playSettings = Settings.mapFromForm(Settings.serializeArrayFormValues($( "#play-settings-form" )));
      Settings.saveToCookie(playSettings);
      start(playSettings);
    }
  });
}

const initFormAndSettings = () => {
  $("#player-video").hide();
  $("#play-video-container").css("background-color","rgba(102, 102, 102, 1)")
  let pageParams = Settings.mapFromCookie(state.settings);
  pageParams = Settings.mapFromQueryParams(pageParams);
  Settings.updateForm(pageParams);
}
initFormAndSettings();
init(errorHandler,onPlayPeerConnected,onPlayPeerConnectionStopped);
