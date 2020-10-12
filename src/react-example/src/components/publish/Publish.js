import React from 'react';

import PublishVideoElement from './PublishVideoElement';
import PublishLiveIndicator from './PublishLiveIndicator';
import PublishSettingsForm from './PublishSettingsForm';
import Publisher from './Publisher';

const Publish = () => {

  return (
    <div className="container-fluid mt-3" id="publish-content">
      <div className="row justify-content-center">
        <div className="col-md-8 col-sm-12">
          <div id="publish-video-container">
            <PublishVideoElement />
            <PublishLiveIndicator />
          </div>
        </div>
        <PublishSettingsForm />
      </div>
      <Publisher />
    </div>
  );
}

export default Publish;