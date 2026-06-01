import React from 'react';

import Meeter from './Meeter'
import MeetingSettingsForm from './MeetingSettingsForm';
import Devices from '../media/Devices';
import CompositorUserMedia from '../media/CompositorUserMedia';

const Meeting = () => {

  return (
    <div className="row justify-content-center">
      <CompositorUserMedia />
      <Devices/>
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
