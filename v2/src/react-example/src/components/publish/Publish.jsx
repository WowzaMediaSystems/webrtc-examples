import React from 'react';
import { useSelector } from 'react-redux';

import PublishVideoElement from './PublishVideoElement';
import PublishSettingsForm from './PublishSettingsForm';
import CompositorUserMedia from '../media/CompositorUserMedia';
import Devices from '../media/Devices';
import Publisher from './Publisher';
import DataChannelPanel from '../shared/DataChannelPanel';
import PublishCaptionBox from './PublishCaptionBox';
import StatsBar from '../diagnostics/StatsBar';
import SimulcastLayers from '../diagnostics/SimulcastLayers';
import DebugPanel from '../diagnostics/DebugPanel';
import Stage from '../shell/Stage';
import Inspector from '../shell/Inspector';
import ExternalLinks from '../../constants/ExternalLinks';
import useConnectionStats from '../../hooks/useConnectionStats';

const Publish = () => {
  const { stats, history, connectionState } = useConnectionStats('publish');
  const { applicationName, streamName, chatEnabled, captionsEnabled } =
    useSelector((state) => state.publishSettings);

  const target = applicationName || streamName
    ? (applicationName || '?') + ' / ' + (streamName || '?')
    : null;

  const tabs = [
    { id: 'connection', label: 'Connection', render: () => <PublishSettingsForm tab="connection" /> },
    { id: 'source', label: 'Source', render: () => <PublishSettingsForm tab="source" /> },
    { id: 'advanced', label: 'Advanced', render: () => <PublishSettingsForm tab="advanced" /> },
  ];

  return (
    <>
      <CompositorUserMedia />
      <Devices />

      <Stage title="Publish" target={target}>
        <div className="wz-stage__body" id="publish-content">
          <div className="wz-stage__video" id="publish-video-container">
            <PublishVideoElement />
          </div>
          {chatEnabled || captionsEnabled ? (
            <div className="wz-stage__aside">
              <DataChannelPanel context="publish" />
              <PublishCaptionBox />
            </div>
          ) : null}
        </div>

        <div className="wz-stage__stats">
          <StatsBar stats={stats} history={history} connectionState={connectionState} role="publish" />
        </div>

        {/* Only present on a simulcast publish; one encoding is not a layer list. */}
        {stats?.outboundLayers?.length > 1 && (
          <div className="wz-stage__stats">
            <SimulcastLayers layers={stats.outboundLayers} totalKbps={stats.outboundTotalKbps} />
          </div>
        )}

        <DebugPanel />
      </Stage>

      <Inspector tabs={tabs} legacyHref={ExternalLinks.legacyPublish} />
      <Publisher />
    </>
  );
}

export default Publish;
