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
 * Publisher and player side by side against the same Engine, so a round trip can be watched
 * end to end on one screen.
 *
 * Both sides are the existing components, unmodified, each keeping its own Redux slice. The
 * inspector points at one side at a time, which is why it carries a Publisher / Player switch
 * above the usual tabs.
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
   * Both entries render the same element types in the same positions, so React reconciles one
   * PlaySettingsForm instance rather than remounting it on every tab change. A remount is not
   * free here: the form initialises `initialized` to false and its mount effect re-reads the
   * cookie and the query string, so it blanks for a render and re-applies a share link's
   * parameters over whatever has been typed. CopyFromPublisher is above the fields because
   * its job is to save filling them in.
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

            {/* Above the strip, not below it, so the stat strips are the last thing in both
                panes and therefore line up along the bottom. */}
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
            {/* Same nesting as the Play page: the outer element fills the pane, the inner
                one shrinks to the picture so the rendition badge and the captions sit on
                the video rather than in the space above it. */}
            <div className="wz-loopback__video">
              <div id="play-video-container">
                <Player />
                <CaptionOverlay context="play" />
                <GlassToGlassReader connected={play.connectionState === 'connected'} />
              </div>
            </div>
            {/* In the player pane because only the player can read the stamp, and above the
                strip because the strip has to stay the last element in a pane or the two
                panes stop lining up along the bottom. e2e/ui.spec.js asserts that. */}
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