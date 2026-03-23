/*
 * This code and all components (c) Copyright 2019-2020, Wowza Media Systems, LLC. All rights reserved.
 * This code is licensed pursuant to the BSD 3-Clause License.
 */

import AvMenu from './lib/AvMenu.js';
import Settings from './lib/Settings.js';
import WowzaWebRTCPublish from './lib/WowzaWebRTCPublish.js';
window.WowzaWebRTCPublish = WowzaWebRTCPublish;
let browserDetails = window.adapter.browserDetails;

$(document).ready(() => {
  let state = {
    publishing: false,
    pendingPublish: false,
    pendingPublishTimeout: undefined,
    muted: false,
    video: true,
    selectedCam: '',
    selectedMic: '',
    settings: {
      sdpURL: "",
      applicationName: "",
      streamName: "",
      audioBitrate: "64",
      audioCodec: "opus",
      videoBitrate: "3500",
      videoCodec: "42e01f",
      videoFrameRate: "30",
      frameSize: "default"
    }
  };

  const init = (connected,failed,stopped,errorHandler,soundMeter) => {
    initListeners();
    WowzaWebRTCPublish.on({
      onStateChanged: (newState) => {
        console.log("WowzaWebRTCPublish.onStateChanged");
        console.log(JSON.stringify(newState));

        // LIVE / ERROR Indicator
        if (newState.connectionState === 'connected')
        {
          connected();
        }
        else if (newState.connectionState === 'failed')
        {
          failed();
        }
        else
        {
          stopped();
        }
      },
      onCameraChanged: (cameraId) => {
        if (cameraId !== state.selectedCam)
        {
          state.selectedCam = cameraId;
          let camSelectValue = 'CameraMobile_'+cameraId;
          if (cameraId === 'screen') camSelectValue = 'screen_screen';
          $('#camera-list-select').val(camSelectValue);
        }
      },
      onMicrophoneChanged: (microphoneId) => {
        if (microphoneId !== state.selectedMic)
        {
          state.selectedMic = microphoneId;
          $('#mic-list-select').val('MicrophoneMobile_'+microphoneId);
        }
      },
      onError: errorHandler,
      onSoundMeter: soundMeter
    })
    WowzaWebRTCPublish.set({
      videoElementPublish:document.getElementById('publisher-video'),
      useSoundMeter:true
    })
    .then((result) => {
      AvMenu.init(result.cameras,result.microphones, onAvMenuCameraChanged, onAvMenuMicrophoneChanged);
    });
  };

  const getState = () => {
    return state;
  }

  // throw errors with these messages
  const okToStart = () => {
    if (state.settings.sdpURL === "")
    {
      throw "No stream configured.";
    }
    else if (state.settings.applicationName === "")
    {
      throw "Missing application name.";
    }
    else if (state.settings.streamName === "")
    {
      throw "Missing stream name."
    }
    return true;
  }

  const updateFrameSize = (frameSize) => {
    let constraints = JSON.parse(JSON.stringify(WowzaWebRTCPublish.getState().constraints));
    if (frameSize === 'default')
    {
      constraints.video["width"] = { min: "640", ideal: "1280", max: "1920" };
      constraints.video["height"] = { min: "360", ideal: "720", max: "1080" };
    }
    else
    {
      constraints.video["width"] = { exact: frameSize[0] };
      constraints.video["height"] = { exact: frameSize[1] };
    }
    WowzaWebRTCPublish.set({constraints: constraints});
  }

  const update = (settings) => {
    state.settings = settings;
    return WowzaWebRTCPublish.set(settings);
  }

  // start/stop publisher
  const start = () => {
    if(okToStart()){
      WowzaWebRTCPublish.start();
    }
  };

  const stop = () => {
    WowzaWebRTCPublish.stop();
  };

  const videoOn = () => {
    WowzaWebRTCPublish.setVideoEnabled(true);
  }
  const videoOff = () => {
    WowzaWebRTCPublish.setVideoEnabled(false);
  }

  const audioOn = () => {
    WowzaWebRTCPublish.setAudioEnabled(true);
  }

  const audioOff = () => {
    WowzaWebRTCPublish.setAudioEnabled(false);
  }

  // Helpers

  const errorHandler = (error) => {
    let message;
    if(error.name == "OverconstrainedError"){
      message = "Your browser or camera does not support this frame size: " + $("#frameSize option:selected").val();
      $("#frameSize").val("default");
      updateFrameSize("default");
    } else if ( error.message ) {
      message = error.message;
    }
    else {
      message = error
    }
    showErrorPanel(message);
    stop();
  };

  const setPendingPublish = (pending) =>
  {
    if (pending)
    {
      $("#publish-toggle").prop("disabled", true);
      state.pendingPublish = true;
      state.pendingPublishTimeout = setTimeout(()=>{
        $("#publish-toggle").prop("disabled", false);
        stop();
        errorHandler({message:"Publish failed. Unable to connect."});
        setPendingPublish(false);
      },10000);
    }
    else
    {
      $("#publish-toggle").prop("disabled", false);
      state.pendingPublish = false;
      if (state.pendingPublishTimeout != null)
      {
        clearTimeout(state.pendingPublishTimeout);
        state.pendingPublishTimeout = undefined;
      }
    }
  }

  const updatePublisher = () => {
    let publishSettings = Settings.mapFromForm(Settings.serializeArrayFormValues($( "#publish-settings-form" )));
    Settings.saveToCookie(publishSettings);
    return update(publishSettings);
  }

  /*
    UI updaters
  */

  const showErrorPanel = (message) => {
    message = "<div>"+message+"</div>";
    $("#error-messages").html(message);
    $("#error-panel").removeClass('invisible');
  }

  const hideErrorPanel = () => {
    $("#error-messages").html("&nbsp;");
    $("#error-panel").addClass('invisible');
  }

  const onAvMenuCameraChanged = (cameraId) => {
    if (state.selectedCam !== cameraId)
    {
      state.selectedCam = cameraId;
      WowzaWebRTCPublish.setCamera(cameraId);
    }
  }

  const onAvMenuMicrophoneChanged = (microphoneId) => {
    if (state.selectedMic !== microphoneId)
    {
      state.selectedMic = microphoneId;
      WowzaWebRTCPublish.setMicrophone(microphoneId);
    }
  }

  // sound meter
  const onSoundMeter = (level) => {
    // map level onto the rising quadrant shape of a circle to exaggerate the sound meter gradient
    let shiftLevel = level - 1;
    let levelCirc = Math.round(100 * Math.sqrt( 1 - (shiftLevel * shiftLevel) ));
    $("#mute-toggle").css("background-image","linear-gradient(white "+(100-levelCirc)+"%, lime)");
  };

  const onPublishPeerConnected = () => {
    state.publishing = true;
    setPendingPublish(false);
    hideErrorPanel();
    $("#transcoder-warning").hide();
    $("#error-messages").html("");
    $("#publish-toggle").html("Stop");
    $("#video-live-indicator-live").show();
    $("#video-live-indicator-error").hide();
    $("#publish-settings-form :input").prop("disabled", true);
    $("#publish-settings-form :button").prop("disabled", false);
  }

  const onPublishPeerConnectionFailed = () => {
    setPendingPublish(false);
    onPublishPeerConnected();
    errorHandler({message:"Peer connection failed."});
    $("#publish-settings-form :input").prop("disabled", false);
    $("#publish-settings-form :button").prop("disabled", false);
  }

  const onPublishPeerConnectionStopped = () => {
    if (!state.pendingPublish)
    {
      state.publishing = false;
      $("#publish-toggle").html("Publish");
      $("#video-live-indicator-live").hide();
      $("#video-live-indicator-error").hide();
      $("#publish-settings-form :input").prop("disabled", false);
      $("#publish-settings-form :button").prop("disabled", false);
    }
  }

  // Listeners
  const initListeners = () => {
    $("#mute-toggle").click((e) => {
      e.preventDefault()
      state.muted = !state.muted
      if(state.muted) {
        $("#mute-off").css("display", "none");
        $("#mute-on").css("display", "inline");
        audioOff()
      }else{
        $("#mute-on").css("display", "none");
        $("#mute-off").css("display", "inline");
        audioOn();
      }
    });

    $("#camera-toggle").click((e) => {
      e.preventDefault()
      state.video = !state.video
      if(state.video) {
        $("#video-on").css("display", "none");
        $("#video-off").css("display", "inline");
        videoOn();
      }else{
        $("#video-off").css("display", "none");
        $("#video-on").css("display", "inline");
        videoOff();
      }
    });

    $("#frameSize").change(() => {
      hideErrorPanel();
      let resolution = $("#frameSize option:selected").val();
      if (resolution !== 'default')
      {
        resolution = $("#frameSize option:selected").val().split("x");
      }
      updateFrameSize(resolution);
    });

    $('#publish-share-link').click(() => {
      Settings.shareLink(Settings.mapFromForm(Settings.serializeArrayFormValues($( "#publish-settings-form" ))),"Share link copied to clipboard!")
    });

    $('#publish-share-link').popover({content: "Copy config", trigger: "hover", placement: "bottom"});

    $("#error-panel-close").click((e) => {
      hideErrorPanel()
    });

    $("#publish-toggle").click((e) => {
      if (state.pendingPublish)
      {
        return;
      }
      else if (state.publishing)
      {
        stop();
      }
      else
      {
        try {
          hideErrorPanel()
          updatePublisher().then(()=>{
            setPendingPublish(true);
            start();
          });
        }catch(e){
          errorHandler(e);
        }
      }
    });
  }

  const initFormAndSettings = () => {
    let pageParams = Settings.mapFromCookie(state.settings);
    pageParams = Settings.mapFromQueryParams(pageParams);
    Settings.updateForm(pageParams);
    if (pageParams.frameSize != null && pageParams.frameSize !== '' && pageParams.frameSize !== 'default')
    {
      updateFrameSize(pageParams.frameSize.split('x'));
    }
    if (browserDetails.browser === 'safari')
    {
      $("#videoCodec option[value='VP9']").remove();
    }
  }
  initFormAndSettings();
  init(onPublishPeerConnected,onPublishPeerConnectionFailed,onPublishPeerConnectionStopped,errorHandler,onSoundMeter);
});
