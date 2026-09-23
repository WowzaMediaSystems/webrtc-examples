import React from 'react';
import { useSelector } from 'react-redux';

import PublishVideoElement from './PublishVideoElement';
import PublishLiveIndicator from './PublishLiveIndicator';
import PublishSettingsForm from './PublishSettingsForm';
import CompositorUserMedia from '../media/CompositorUserMedia';
import Devices from '../media/Devices';
import Publisher from './Publisher';
import DataChannelPanel from '../shared/DataChannelPanel';
import PublishCaptionBox from './PublishCaptionBox';
import Stage from '../shell/Stage';
import Inspector from '../shell/Inspector';
import ExternalLinks from '../../constants/ExternalLinks';

const Publish = () => {
  const { applicationName, streamName, chatEnabled, captionsEnabled } =
    useSelector((state) => state.publishSettings);

  const target = applicationName || streamName
    ? (applicationName || '?') + ' / ' + (streamName || '?')
    : null;

  const tabs = [
    { id: 'connection', label: 'Connection', render: () => <PublishSettingsForm tab="connection" /> },
  ];

  return (
    <>
      <CompositorUserMedia />
      <Devices />

      <Stage title="Publish" target={target}>
        <div className="wz-stage__body" id="publish-content">
          <div className="wz-stage__video" id="publish-video-container">
            <PublishVideoElement />
            <PublishLiveIndicator />
          </div>
          {chatEnabled || captionsEnabled ? (
            <div className="wz-stage__aside">
              <DataChannelPanel context="publish" />
              <PublishCaptionBox />
            </div>
          ) : null}
        </div>
      </Stage>

      <Inspector tabs={tabs} legacyHref={ExternalLinks.legacyPublish} />
      <Publisher />
    </>
  );
}

export default Publish;
