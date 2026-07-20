import React from 'react';

import Player from './Player';
import PlaySettingsForm from './PlaySettingsForm';
import DataChannelPanel from '../shared/DataChannelPanel';

const Play = () => {

  return (
    <div className="container-fluid mt-3" id="play-content">
      <div className="row pr-3">
        <div className="col-md-8 col-sm-12">
          <div id="play-video-container">
            <Player />
          </div>
          <DataChannelPanel context="play" />
        </div>
        <PlaySettingsForm />
      </div>
    </div>
  );
}

export default Play;