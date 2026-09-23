import React from 'react';
import { useSelector } from 'react-redux';

import Player from './Player';
import PlaySettingsForm from './PlaySettingsForm';
import DataChannelPanel from '../shared/DataChannelPanel';
import CaptionOverlay from '../shared/CaptionOverlay';
import DebugPanel from '../diagnostics/DebugPanel';
import Stage from '../shell/Stage';
import Inspector from '../shell/Inspector';
import ExternalLinks from '../../constants/ExternalLinks';

const Play = () => {
  const { applicationName, streamName, chatEnabled } = useSelector((state) => state.playSettings);

  const target = applicationName || streamName
    ? (applicationName || '?') + ' / ' + (streamName || '?')
    : null;

  const tabs = [
    { id: 'connection', label: 'Connection', render: () => <PlaySettingsForm tab="connection" /> },
    { id: 'advanced', label: 'Advanced', render: () => <PlaySettingsForm tab="advanced" /> },
  ];

  return (
    <>
      <Stage title="Play" target={target}>
        <div className="wz-stage__body" id="play-content">
          <div className="wz-stage__video">
            <div id="play-video-container">
              <Player />
              <CaptionOverlay context="play" />
            </div>
          </div>
          {chatEnabled ? (
            <div className="wz-stage__aside">
              <DataChannelPanel context="play" />
            </div>
          ) : null}
        </div>

        <DebugPanel />
      </Stage>

      <Inspector tabs={tabs} legacyHref={ExternalLinks.legacyPlay} />
    </>
  );
}

export default Play;
