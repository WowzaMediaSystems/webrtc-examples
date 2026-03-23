import React from 'react';
import { useSelector, useDispatch } from 'react-redux';

import * as compositeSettingsActions from '../../actions/compositeSettingsActions';
import ShareLink from '../shared/ShareLink';
import { compositePublishUrlParameters, compositePublishUrlParametersPrefix } from '../../constants/CompositeOptions';
import './InputLayoutSettingsForm.css';

const InputLayoutSettingsForm = () => {

  const dispatch = useDispatch();
  const compositeSettings = useSelector ((state) => state.compositeSettings);
  const { cameras, microphones } = useSelector ((state) => state.media);
  const webrtcPublish = useSelector ((state) => state.webrtcPublish);

  return (
    <form id="composite-settings-form-2">
      <div className="row">
        <div className="col-md-4 col-sm-12">
          <div className="row">
            <div className="col-10">
              <div className="form-group">
                <label htmlFor="camera1-list-select">
                  Video Input 1
                </label>
                <select id="camera1-list-select" className="form-control"
                  value={compositeSettings.videoTrack1DeviceId}
                  onChange={(e)=>dispatch({type:compositeSettingsActions.SET_COMPOSITE_VIDEO_TRACK1_DEVICEID,videoTrack1DeviceId:e.target.value})}
                >
                  <option value=''>None</option>
                  { cameras.map((cam,key) => {
                    return <option key={key} value={cam.deviceId}>{cam.label}</option>
                  })}
                  <option value='screen'>Screen Share</option>
                </select>
              </div>
            </div>
          </div>
          <div className="row">
            <div className="col-10">
              <div className="form-group">
                <label htmlFor="camera2-list-select">
                  Video Input 2
                </label>
                <select id="camera2-list-select" className="form-control"
                  value={compositeSettings.videoTrack2DeviceId}
                  onChange={(e)=>dispatch({type:compositeSettingsActions.SET_COMPOSITE_VIDEO_TRACK2_DEVICEID,videoTrack2DeviceId:e.target.value})}
                >
                  <option value=''>None</option>
                  { cameras.map((cam,key) => {
                    return <option key={key} value={cam.deviceId}>{cam.label}</option>
                  })}
                </select>
              </div>
            </div>
          </div>
          <div className="row">
            <div className="col-10">
              <div className="form-group">
                <label htmlFor="mic-list-select">
                  Microphone
                </label>
                <select id="mic-list-select" className="form-control"
                  value={compositeSettings.audioTrackDeviceId}
                  onChange={(e)=>dispatch({type:compositeSettingsActions.SET_COMPOSITE_AUDIO_TRACK_DEVICEID,audioTrackDeviceId:e.target.value})}
                >
                  <option value=''>None</option>
                  { microphones.map((mic,key) => {
                    return <option key={key} value={mic.deviceId}>{mic.label}</option>
                  })}
                </select>
              </div>
            </div>
          </div>
        </div>
        <div className="col-md-8 col-sm-12">
          <label>
            Layout
          </label>
          <div className="row composite-layout">
            <div className="col-lg-3 col-6 mb-4">
              <button id="composite-layout-0" type="button"
                className={"btn composite-layout-button" + (compositeSettings.layout === 0 ? " btn-outline-warning" : " btn-outline-secondary") }
                onClick={(e)=>dispatch({type:compositeSettingsActions.SET_COMPOSITE_LAYOUT,layout:0})}>
                  <span className="composite-layout-button-label">1</span>
              </button>
            </div>
            <div className="col-lg-3 col-6 mb-4">
              <button id="composite-layout-1" type="button"
                className={"btn composite-layout-button" + (compositeSettings.layout === 1 ? " btn-outline-warning" : " btn-outline-secondary") }
                onClick={(e)=>dispatch({type:compositeSettingsActions.SET_COMPOSITE_LAYOUT,layout:1})}>
                  <span className="composite-layout-button-label">2</span>
              </button>
            </div>
            <div className="col-lg-3 col-6 mb-4">
              <button id="composite-layout-2" type="button"
                className={"btn composite-layout-button" + (compositeSettings.layout === 2 ? " btn-outline-warning" : " btn-outline-secondary") }
                onClick={(e)=>dispatch({type:compositeSettingsActions.SET_COMPOSITE_LAYOUT,layout:2})}>
                  <div className="composite-layout-pip pip-top-right">
                    2
                  </div>
                  <span className="composite-layout-button-label">1</span>
              </button>
            </div>
            <div className="col-lg-3 col-6 mb-4">
              <button id="composite-layout-3" type="button"
                className={"btn composite-layout-button" + (compositeSettings.layout === 3 ? " btn-outline-warning" : " btn-outline-secondary") }
                onClick={(e)=>dispatch({type:compositeSettingsActions.SET_COMPOSITE_LAYOUT,layout:3})}>
                  <div className="composite-layout-pip pip-top-right">
                    1
                  </div>
                  <span className="composite-layout-button-label">2</span>
              </button>
            </div>
            <div className="col-lg-3 col-6 mb-4">
              <button id="composite-layout-4" type="button"
                className={"btn composite-layout-button" + (compositeSettings.layout === 4 ? " btn-outline-warning" : " btn-outline-secondary") }
                onClick={(e)=>dispatch({type:compositeSettingsActions.SET_COMPOSITE_LAYOUT,layout:4})}>
                  <div className="composite-layout-pip pip-top-left">
                    2
                  </div>
                  <span className="composite-layout-button-label">1</span>
              </button>
            </div>
            <div className="col-lg-3 col-6 mb-4">
              <button id="composite-layout-5" type="button"
                className={"btn composite-layout-button" + (compositeSettings.layout === 5 ? " btn-outline-warning" : " btn-outline-secondary") }
                onClick={(e)=>dispatch({type:compositeSettingsActions.SET_COMPOSITE_LAYOUT,layout:5})}>
                  <div className="composite-layout-pip pip-bottom-left">
                    2
                  </div>
                  <span className="composite-layout-button-label">1</span>
              </button>
            </div>
            <div className="col-lg-3 col-6 mb-4">
              <button id="composite-layout-6" type="button"
                className={"btn composite-layout-button" + (compositeSettings.layout === 6 ? " btn-outline-warning" : " btn-outline-secondary") }
                onClick={(e)=>dispatch({type:compositeSettingsActions.SET_COMPOSITE_LAYOUT,layout:6})}>
                  <div className="composite-layout-pip pip-bottom-right">
                    2
                  </div>
                  <span className="composite-layout-button-label">1</span>
              </button>
            </div>
            <div className="col-lg-3 col-6 mb-4">
              <button id="composite-layout-7" type="button"
                className={"btn composite-layout-button" + (compositeSettings.layout === 7 ? " btn-outline-warning" : " btn-outline-secondary") }
                onClick={(e)=>dispatch({type:compositeSettingsActions.SET_COMPOSITE_LAYOUT,layout:7})}>
                  <div className="composite-layout-quarter quarter-left">
                    1
                  </div>
                  <div className="composite-layout-quarter quarter-right">
                    2
                  </div>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="row">
        <div className="col-0 col-md-8"></div>
        <div className="col-12 col-md-4">
          <div className="row">
            <div className="col-10">
              { !webrtcPublish.connected &&
                <button id="publish-toggle" type="button" className="btn"
                  disabled={compositeSettings.publishStarting }
                  onClick={(e)=>dispatch(compositeSettingsActions.startPublish())}
                >Publish</button>
              }
              { webrtcPublish.connected &&
                <button id="publish-toggle" type="button" className="btn"
                  onClick={(e)=>dispatch(compositeSettingsActions.stopPublish())}
                >Stop</button>
              }
            </div>
            <div className="col-2">
              <ShareLink settings={compositeSettings} parameters={compositePublishUrlParameters} prefix={compositePublishUrlParametersPrefix} />
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}

  export default InputLayoutSettingsForm;
