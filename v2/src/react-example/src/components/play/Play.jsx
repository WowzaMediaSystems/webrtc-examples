import React from 'react';
import { useSelector } from 'react-redux';

import Player from './Player';
import GlassToGlassReader from './GlassToGlassReader';
import PlaySettingsForm from './PlaySettingsForm';
import DataChannelPanel from '../shared/DataChannelPanel';
import CaptionOverlay from '../shared/CaptionOverlay';
import StatsBar from '../diagnostics/StatsBar';
import LatencyGroup from '../diagnostics/LatencyGroup';
import DebugPanel from '../diagnostics/DebugPanel';
import Stage from '../shell/Stage';
import Inspector from '../shell/Inspector';
import ExternalLinks from '../../constants/ExternalLinks';
import useConnectionStats from '../../hooks/useConnectionStats';

const Play = () => {
  const { stats, history, connectionState } = useConnectionStats('play');
  const playing = connectionState === 'connected';
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
              <GlassToGlassReader connected={playing} />
            </div>
          </div>
          {chatEnabled ? (
            <div className="wz-stage__aside">
              <DataChannelPanel context="play" />
            </div>
          ) : null}
        </div>

        <div className="wz-stage__stats">
          {/* Above the strip, matching the combined page, so the two pages put the same
              reading in the same place. */}
          <LatencyGroup connected={playing} videoCodec={stats?.codec} />
          <StatsBar stats={stats} history={history} connectionState={connectionState} role="play" />
        </div>

        <DebugPanel />
      </Stage>

      <Inspector tabs={tabs} legacyHref={ExternalLinks.legacyPlay} />
    </>
  );
}

export default Play;
