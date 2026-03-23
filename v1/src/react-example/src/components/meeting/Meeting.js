import React from 'react';

import Meeter from './Meeter'
import MeetingSettingsForm from './MeetingSettingsForm';

const Meeting = () => {

  return (
    <div className="row justify-content-center">
      <div className="col-md-8 col-sm-12">
        <div id="peer-video-container">
          <Meeter />
        </div>
      </div>
      <MeetingSettingsForm />
    </div>
  );
}

export default Meeting;
