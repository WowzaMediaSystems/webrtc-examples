import React, { useState } from 'react';

import CompositorUserMedia from '../media/CompositorUserMedia';
import Devices from '../media/Devices';

import PublishVideoElement from '../publish/PublishVideoElement';
import PublishSettingsForm from '../publish/PublishSettingsForm';
import Publisher from '../publish/Publisher';

import Player from '../play/Player';
import PlaySettingsForm from '../play/PlaySettingsForm';
import CaptionOverlay from '../shared/CaptionOverlay';

import StatsBar from '../diagnostics/StatsBar';
import SimulcastLayers from '../diagnostics/SimulcastLayers';
import LatencyGroup from '../diagnostics/LatencyGroup';
import GlassToGlassReader from '../play/GlassToGlassReader';
import CopyFromPublisher from './CopyFromPublisher';
import DebugPanel from '../diagnostics/DebugPanel';
import Stage from '../shell/Stage';
import Inspector from '../shell/Inspector';
import ExternalLinks from '../../constants/ExternalLinks';
import useConnectionStats from '../../hooks/useConnectionStats';

/*
 * Publisher and player side by side against the same Engine. Both sides are the existing
 * components with their own Redux slices; the inspector switches between them.
 */
const Loopback = () => {
  const publish = useConnectionStats('publish');
  const play = useConnectionStats('play');
  const [side, setSide] = useState('publish');

  const publishTabs = [
    { id: 'connection', label: 'Connection', render: () => <PublishSettingsForm tab="connection" /> },
    { id: 'source', label: 'Source', render: () => <PublishSettingsForm tab="source" /> },
    { id: 'advanced', label: 'Advanced', render: () => <PublishSettingsForm tab="advanced" /> },
  ];

  /*
   * Same element types in the same positions, so React keeps one PlaySettingsForm across tab
   * changes. A remount would re-read the cookie and query string over whatever was typed.
   */
  const playPane = (tab) => (
    <>
      {tab === 'connection' ? <CopyFromPublisher /> : null}
      <PlaySettingsForm tab={tab} />
    </>
  );

  const playTabs = [
    { id: 'connection', label: 'Connection', render: () => playPane('connection') },
    { id: 'advanced', label: 'Advanced', render: () => playPane('advanced') },
  ];

  return (
    <>
      <CompositorUserMedia />
      <Devices />

      <Stage title="Publish + Play">
        <div className="wz-stage__body wz-loopback" id="loopback-content">

          <section className="wz-loopback__pane" aria-labelledby="loopback-publish-heading">
            <h2 className="wz-loopback__heading" id="loopback-publish-heading">
              Publisher
              <span className="wz-loopback__hint">this browser to the Engine</span>
            </h2>
            <div className="wz-loopback__video" id="publish-video-container">
              <PublishVideoElement />
            </div>

            {/* The stat strip stays last in each pane so the two line up along the bottom. */}
            {publish.stats?.outboundLayers?.length > 1 && (
              <SimulcastLayers
                layers={publish.stats.outboundLayers}
                totalKbps={publish.stats.outboundTotalKbps}
              />
            )}
            <StatsBar stats={publish.stats} history={publish.history} connectionState={publish.connectionState} role="publish" />
          </section>

          <section className="wz-loopback__pane" aria-labelledby="loopback-play-heading">
            <h2 className="wz-loopback__heading" id="loopback-play-heading">
              Player
              <span className="wz-loopback__hint">the Engine back to this browser</span>
            </h2>
            {/* Inner element shrinks to the picture so badge and captions sit on the video. */}
            <div className="wz-loopback__video">
              <div id="play-video-container">
                <Player />
                <CaptionOverlay context="play" />
                <GlassToGlassReader connected={play.connectionState === 'connected'} />
              </div>
            </div>
            {/* Above the strip: e2e/ui.spec.js asserts the strip is last in each pane. */}
            <LatencyGroup
              connected={play.connectionState === 'connected'}
              videoCodec={play.stats?.codec}
            />
            <StatsBar stats={play.stats} history={play.history} connectionState={play.connectionState} role="play" />
          </section>
        </div>

        <p className="wz-stage__note">
          Each side is its own peer connection, so the two sets of figures are independent.
          Adding them together does not give glass-to-glass latency: neither side can see
          capture, encode, Engine processing, decode or display time.
        </p>

        <DebugPanel />
      </Stage>

      <Inspector
        tabs={side === 'publish' ? publishTabs : playTabs}
        legacyHref={side === 'publish' ? ExternalLinks.legacyPublish : ExternalLinks.legacyPlay}
        sides={[{ id: 'publish', label: 'Publisher' }, { id: 'play', label: 'Player' }]}
        side={side}
        onSideChange={setSide}
      />

      <Publisher />
    </>
  );
};

export default Loopback;