import React, { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import QueryString from 'query-string';

import * as compositeSettingsActions from '../../actions/compositeSettingsActions';
import * as PublishOptions from '../../constants/PublishOptions';
import { compositePublishUrlParameters, compositePublishUrlParametersPrefix } from '../../constants/CompositeOptions';
import { getCookieValues, setCookieValues } from '../../utils/CookieUtils';
import CookieName from '../../constants/CookieName';

const CompositePublishSettingsForm = () => {

  const dispatch = useDispatch();
  const [ initialized, setInitialized ] = useState(false);
  const compositeSettings = useSelector ((state) => state.compositeSettings);

  // load composite publish settings from cookie and URL on mount
  useEffect(() => {

    let cookieValues = getCookieValues(CookieName);
    let qs = QueryString.parse(window.location.search);
    let savedValues = { ...cookieValues, ...qs };

    for (let param in savedValues)
    {
      switch(param)
      {
        case (compositePublishUrlParametersPrefix+'signalingURL'):
          dispatch({type:compositeSettingsActions.SET_COMPOSITE_SIGNALING_URL,signalingURL:savedValues[param]});
          break;
        case (compositePublishUrlParametersPrefix+'applicationName'):
          dispatch({type:compositeSettingsActions.SET_COMPOSITE_APPLICATION_NAME,applicationName:savedValues[param]});
          break;
        case (compositePublishUrlParametersPrefix+'streamName'):
          dispatch({type:compositeSettingsActions.SET_COMPOSITE_STREAM_NAME,streamName:savedValues[param]});
          break;
        case (compositePublishUrlParametersPrefix+'audioBitrate'):
          dispatch({type:compositeSettingsActions.SET_COMPOSITE_AUDIO_BITRATE,audioBitrate:savedValues[param]});
          break;
        case (compositePublishUrlParametersPrefix+'audioCodec'):
          dispatch({type:compositeSettingsActions.SET_COMPOSITE_AUDIO_CODEC,audioCodec:savedValues[param]});
          break;
        case (compositePublishUrlParametersPrefix+'videoBitrate'):
          dispatch({type:compositeSettingsActions.SET_COMPOSITE_VIDEO_BITRATE,videoBitrate:savedValues[param]});
          break;
        case (compositePublishUrlParametersPrefix+'videoCodec'):
          dispatch({type:compositeSettingsActions.SET_COMPOSITE_VIDEO_CODEC,videoCodec:savedValues[param]});
          break;
        default:
      }
    }
    setInitialized(true);
  },[dispatch]);

  // save values to Cookie
  useEffect(() => {

    let cookieValues = getCookieValues(CookieName);
    for (let i = 0; i < compositePublishUrlParameters.length; i++)
    {
      if (compositeSettings[compositePublishUrlParameters[i]] != null)
      {
        cookieValues[compositePublishUrlParametersPrefix+compositePublishUrlParameters[i]] = compositeSettings[compositePublishUrlParameters[i]];
      }
    }
    setCookieValues(CookieName,cookieValues);

  },[compositeSettings]);

  if (!initialized)
    return null;

  return (
    <form id="publish-settings-form">
      <div className="row">
        <div className="col-12">
          <div className="form-group">
            <label htmlFor="sdpURL">Signaling URL</label>
            <input type="text" 
              className="form-control" 
              id="signalingURL" 
              name="signalingURL" 
              maxLength="1024" 
              placeholder="wss://[ssl-certificate-domain-name]/webrtc-session.json" 
              value={compositeSettings.signalingURL}
              onChange={(e)=>dispatch({type:compositeSettingsActions.SET_COMPOSITE_SIGNALING_URL,signalingURL:e.target.value})}
            />
          </div>
        </div>
      </div>
      <div className="row">
        <div className="col-lg-6 col-sm-12">
          <div className="form-group">
            <label htmlFor="applicationName">Application Name</label>
            <input type="text" 
              className="form-control" 
              id="applicationName" 
              name="applicationName" 
              maxLength="256" 
              value={compositeSettings.applicationName}
              onChange={(e)=>dispatch({type:compositeSettingsActions.SET_COMPOSITE_APPLICATION_NAME,applicationName:e.target.value})}
            />
          </div>
        </div>
        <div className="col-lg-6 col-sm-12">
          <div className="form-group">
            <label htmlFor="streamName">Stream Name</label>
            <input type="text" 
              className="form-control" 
              id="streamName" 
              name="streamName" 
              maxLength="256" 
              value={compositeSettings.streamName}
              onChange={(e)=>dispatch({type:compositeSettingsActions.SET_COMPOSITE_STREAM_NAME,streamName:e.target.value})}
            />
          </div>
        </div>
      </div>
      <div className="row">
        <div className="col-lg-6 col-sm-12">
          <div className="form-group">
            <label htmlFor="audioBitrate">Audio Bitrate</label>
            <div className="input-group">
              <input type="number" 
                className="form-control" 
                id="audioBitrate" 
                name="audioBitrate" 
                value={compositeSettings.audioBitrate}
                onChange={(e)=>dispatch({type:compositeSettingsActions.SET_COMPOSITE_AUDIO_BITRATE,audioBitrate:e.target.value})}
                />
              <div className="input-group-append">
                <span className="input-group-text">Kbps</span>
              </div>
            </div>
          </div>
        </div>
        <div className="col-lg-6 col-sm-12">
          <div className="form-group">
            <label htmlFor="audioCodec">Audio Codec</label>
            <div className="input-group">
              <select className="form-control" id="audioCodec" name="audioCodec" value="opus" readOnly>
                <option value="opus">Opus</option>
              </select>
            </div>
          </div>
        </div>
      </div>
      <div className="row">
        <div className="col-lg-6 col-sm-12">
          <div className="form-group">
            <label htmlFor="videoBitrate">Video Bitrate</label>
            <div className="input-group">
              <input type="number" 
                className="form-control" 
                id="videoBitrate" 
                name="videoBitrate" 
                value={compositeSettings.videoBitrate}
                onChange={(e)=>dispatch({type:compositeSettingsActions.SET_COMPOSITE_VIDEO_BITRATE,videoBitrate:e.target.value})}
              />
              <div className="input-group-append">
                <span className="input-group-text">Kbps</span>
              </div>
            </div>
          </div>
        </div>
        <div className="col-lg-6 col-sm-12">
          <div className="form-group">
            <label htmlFor="videoCodec">Video Codec</label>
            <div className="input-group">
              <select className="form-control" 
                id="videoCodec" 
                name="videoCodec"
                value={compositeSettings.videoCodec}
                onChange={(e)=>dispatch({type:compositeSettingsActions.SET_COMPOSITE_VIDEO_CODEC,videoCodec:e.target.value})}
              >
                { PublishOptions.videoCodecs.map((codec,key) => { 
                  return <option key={key} value={codec.value}>{codec.name}</option>
                })}
              </select>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
  
  export default CompositePublishSettingsForm;