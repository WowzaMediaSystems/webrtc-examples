import React from 'react';

import CompositeLiveIndicator from './CompositeLiveIndicator';
import CompositePublishSettingsForm from './CompositePublishSettingsForm';
import Compositor from './Compositor';
import InputLayoutSettingsForm from './InputLayoutSettingsForm';
import CompositePublisher from './CompositePublisher';

import './Composite.css';

import adapter from 'webrtc-adapter';

const Composite = () => {

  if (adapter.browserDetails.browser === 'safari')
  {
    return (
      <div className="container-fluid mt-3" id="composite-content">
        <div id="composite-content-inner">
          <div className="row justify-content-center">
            Composite example not supported in Safari
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container-fluid mt-3" id="composite-content">
      <div id="composite-content-inner">
        <div className="row justify-content-center">
          <div className="col-md-8 col-sm-12">
            <div id="composite-video-container" className="mb-4">
              <Compositor />
              <CompositeLiveIndicator />
            </div>
          </div>
          <div className="col-md-4 col-sm-12">
            <CompositePublishSettingsForm />
          </div>
        </div>
        <div className="row justify-content-center">
          <div className="col-sm-12">
            <InputLayoutSettingsForm />
          </div>
        </div>
      </div>
      <CompositePublisher />
    </div>
  );
}

export default Composite;