import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { SET_MEDIA_STREAM } from '../../actions/mediaActions';
import { SET_PUBLISH_VIDEO_TRACK, SET_PUBLISH_AUDIO_TRACK } from '../../actions/publishSettingsActions';
import ShareLink from '../shared/ShareLink'
import * as PublishSettingsActions from '../../actions/publishSettingsActions';
import { getCookieValues } from '../../utils/CookieUtils';
import CookieName from '../../constants/CookieName';
import QueryString from 'query-string';
import muteImage from '../../images/mic-32px.svg'
import unmuteImage from '../../images/mic-off-32px.svg'
import videoImage from '../../images/videocam-32px.svg'
import videoOffImage from '../../images/videocam-off-32px.svg'

const MeetingSettingsForm = () => {

  const dispatch = useDispatch();
  const publishSettings = useSelector ((state) => state.publishSettings);
  const webrtcMeeting = useSelector ((state) => state.webrtcMeeting);
  const { cameras, microphones } = useSelector ((state) => state.media);

  const { stream } = useSelector ((state) => state.media);
  const { videoTracksMap, displayScreenTrack, audioTracksMap } = useSelector ((state) => state.media);
  const { videoTrack1DeviceId, audioTrackDeviceId } = useSelector ((state) => state.publishSettings);
  const [ initialized, setInitialized ] = useState(false);
  // load composite publish settings from cookie and URL on mount
  useEffect(() => {

    let cookieValues = getCookieValues(CookieName);
    let qs = QueryString.parse(window.location.search);
    let savedValues = { ...cookieValues, ...qs };

    for (let param in savedValues)
    {
      switch(param)
      {
        case ('meeting.signalingURL'):
          dispatch({type:PublishSettingsActions.SET_PUBLISH_SIGNALING_URL,signalingURL:savedValues[param]});
          break;
        case ('meeting.applicationName'):
          dispatch({type:PublishSettingsActions.SET_PUBLISH_APPLICATION_NAME,applicationName:savedValues[param]});
          break;
        default:
      }
    }
    setInitialized(true);
  },[dispatch]);

  // Handle videoTrack1 changes
  useEffect(() => {
    let newStream = new MediaStream();
    let videoTrack = undefined;
    if (videoTrack1DeviceId === 'screen' && displayScreenTrack != null)
    {
      newStream.addTrack(displayScreenTrack);
      videoTrack = displayScreenTrack;
    }
    else if (videoTrack1DeviceId !== '' && videoTrack1DeviceId !== 'screen' && videoTracksMap[videoTrack1DeviceId] != null)
    {
      newStream.addTrack(videoTracksMap[videoTrack1DeviceId]);
      videoTrack = videoTracksMap[videoTrack1DeviceId];
    }
    if (stream != null)
    {
      let audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0)
        newStream.addTrack(audioTracks[0]);
    }
    dispatch({type:SET_MEDIA_STREAM,stream:newStream});
    dispatch({type:SET_PUBLISH_VIDEO_TRACK,videoTrack:videoTrack});

  }, [dispatch, videoTracksMap, displayScreenTrack, videoTrack1DeviceId])

  // Handle audioTrack changes
  useEffect(() => {
    let newStream = new MediaStream();
    let audioTrack = undefined;
    if (audioTrackDeviceId !== '' && audioTracksMap[audioTrackDeviceId] != null)
    {
      newStream.addTrack(audioTracksMap[audioTrackDeviceId]);
      audioTrack = audioTracksMap[audioTrackDeviceId];
    }
    if (stream != null)
    {
      let videoTracks = stream.getVideoTracks();
      if (videoTracks.length > 0)
        newStream.addTrack(videoTracks[0]);
    }
    dispatch({type:SET_MEDIA_STREAM,stream:newStream});
    dispatch({type:SET_PUBLISH_AUDIO_TRACK,audioTrack:audioTrack});

  },[dispatch, audioTracksMap, audioTrackDeviceId]);

  if (!initialized)
    return null;

  return (
    <div className="col-md-4 col-sm-12" id="meeting-settings">
      <form id="meeting-settings-form">
        <div className="row">
          <div className="col-12">
            <div className="form-group">
              <label htmlFor="signalingURL">Signaling URL</label>
              <input type="text"
                className="form-control"
                id="signalingURL"
                name="signalingURL"
                maxLength="1024"
                placeholder="wss://[ssl-certificate-domain-name]/webrtc-session.json"
                value={publishSettings.signalingURL}
                onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_SIGNALING_URL,signalingURL:e.target.value})}
            />
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-6">
            <div className="form-group">
              <label htmlFor="applicationName">Application Name</label>
              <input type="text"
                className="form-control"
                id="applicationName"
                name="applicationName"
                maxLength="256"
                value={publishSettings.applicationName}
                onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_APPLICATION_NAME,applicationName:e.target.value})}
              />
            </div>
          </div>
          <div className="col-6">
            <div className="form-group">
              <label htmlFor="meetingStreamName">Stream Name</label>
              <input type="text"
                className="form-control"
                id="meetingStreamName"
                name="meetingStreamName"
                maxLength="256"
                value={publishSettings.streamName}
                onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_STREAM_NAME,streamName:e.target.value})}
              />
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-10">
            <div className="form-group">
              <label htmlFor="camera-list-select">
                Input Camera
              </label>
              <select id="camera-list-select" className="form-control"
                value={publishSettings.videoTrack1DeviceId}
                onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_VIDEO_TRACK1_DEVICEID,videoTrack1DeviceId:e.target.value})}
              >
                <option value=''>None</option>
                { cameras.map((cam,key) => {
                  return <option key={key} value={cam.deviceId}>{cam.label}</option>
                })}
              </select>
            </div>
          </div>
          <div className="col-2">
            <button id="camera-toggle" type="button" className="control-button" onClick={() => dispatch({type:PublishSettingsActions.TOGGLE_VIDEO_ENABLED})}>
              <img alt="" className="noll" id="video-off" src={videoImage} style={{display:((publishSettings.videoTrack && publishSettings.videoTrack.enabled)?"inline":"none")}}/>
              <img alt="" className="noll" id="video-on" src={videoOffImage} style={{display:((publishSettings.videoTrack && publishSettings.videoTrack.enabled)?"none":"inline")}}/>
            </button>
          </div>
        </div>
        <div className="row">
          <div className="col-10">
            <div className="form-group">
              <label htmlFor="mic-list-select">
                Input Microphone
              </label>
              <select id="mic-list-select" className="form-control"
                value={publishSettings.audioTrackDeviceId}
                onChange={(e)=>dispatch({type:PublishSettingsActions.SET_PUBLISH_AUDIO_TRACK_DEVICEID,audioTrackDeviceId:e.target.value})}
              >
                <option value=''>None</option>
                { microphones.map((mic,key) => {
                  return <option key={key} value={mic.deviceId}>{mic.label}</option>
                })}
              </select>
            </div>
          </div>
          <div className="col-2">
            <button id="mute-toggle" type="button" className="control-button" onClick={(e) => dispatch({type:PublishSettingsActions.TOGGLE_AUDIO_ENABLED})}>
              <img alt="" className="noll" id="mute-off" src={muteImage} style={{display:((publishSettings.audioTrack && publishSettings.audioTrack.enabled)?"inline":"none")}} />
              <img alt="" className="noll" id="mute-on" src={unmuteImage} style={{display:((publishSettings.audioTrack && publishSettings.audioTrack.enabled)?"none":"inline")}}/>
            </button>
          </div>
        </div>
        <div className="row">
          <div className="col-10">
            { !webrtcMeeting.connected &&
              <button id="meeting-toggle" type="button" className="btn"
                disabled={publishSettings.publishStarting }
                // join the meeting
                onClick={(e)=>dispatch(PublishSettingsActions.startPublish())}
              >Join</button>
            }
            { webrtcMeeting.connected &&
              <button id="meeting-toggle" type="button" className="btn"
                // leave the meeting
                onClick={(e)=>dispatch(PublishSettingsActions.stopPublish())}
              >Leave</button>
            }
          </div>
          <div className="col-2">
            <ShareLink settings={publishSettings} parameters={["signalingURL","applicationName"]} prefix={"meeting."} />
          </div>
        </div>
      </form>
    </div>
  );
}

export default MeetingSettingsForm;
