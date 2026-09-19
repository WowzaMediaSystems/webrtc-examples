import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';
import {
  APPLICATION,
  SIGNALING_URL,
  httpOrigin,
  requireEngine,
  uniqueStream,
} from './helpers.js';
import {
  expectLive,
  expectPlaying,
  openTab,
  startPlaying,
  startPublishing,
  waitForCamera,
} from './ui-helpers.js';

/*
 * The frame stamp, against a live Engine.
 *
 * WHAT THIS MEASURES AND WHY IT IS BUILT THIS WAY
 *
 * The instrument under test is the H.264 SEI NAL codec in src/utils/frameStamp.js, carried
 * through a real publish and a real play by insertable streams. This suite does not drive the
 * Latency Probe toggle to do that. It injects the sender and receiver transforms itself, from
 * an init script, over the application's own peer connections.
 *
 * That is deliberate, for three reasons:
 *
 *   1. The question the design doc calls out as the most important one - does the marker
 *      survive the simulcast rungs - is a question about the Engine and the codec, not about
 *      the toggle. Injecting directly answers it with nothing else in the way.
 *   2. Every frame has to be counted from the first one. encodedInsertableStreams can only be
 *      set when the RTCPeerConnection is constructed, so the flag is forced in a wrapped
 *      constructor and the transforms are attached at addTrack and addTransceiver time,
 *      before the connection is negotiated. A transform attached later misses frames and a
 *      "100% of frames" claim taken over a late window would be worthless.
 *   3. It runs whether or not the probe feature is wired into the pages. The tests further
 *      down that DO drive the toggle skip themselves with a named reason when it is absent,
 *      rather than failing for a reason that has nothing to do with the instrument.
 *
 * The codec is loaded from the repo's own source file rather than copied here, so this suite
 * cannot silently drift away from the thing it is testing.
 *
 * CLOCKS. Every figure below is design mode A or mode B: publisher and player are either in
 * one JS context or in two browser contexts on one machine, so they read the same OS clock and
 * Date.now() agrees to its own resolution. No offset estimate is involved and none is tested
 * here. Mode C, two machines with independent clocks, is not automatable in this harness and
 * the design doc says so.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/*
 * The real codec, made available to page scripts.
 *
 * frameStamp.js has no imports, so stripping the `export ` keyword turns it into a classic
 * script that declares buildSeiPayload and findSeiPayload at top level. Reading the file at
 * test time rather than pasting the bytes is the point: if someone changes the wire format,
 * these tests change with it.
 */
const frameStampSource = () => {
  const file = path.join(here, '..', 'src', 'utils', 'frameStamp.js');
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes('export const buildSeiPayload')) {
    throw new Error(`frameStamp.js at ${file} no longer exports buildSeiPayload`);
  }
  return source.replace(/^export /gm, '');
};

/**
 * The init script: forces insertable streams on, and attaches the stamp and the reader.
 *
 * `stamp` false gives a baseline run: the transforms are still attached and still count
 * frames, but nothing is written into them. That is what makes the do-no-harm comparison a
 * comparison of one variable instead of two.
 *
 * `dropEvery` makes the sender discard every Nth frame after advancing its sequence number.
 * Loopback against this Engine loses nothing, so a missed-frame count has to be manufactured
 * to be tested at all.
 */
const instrument = ({ stamp = true, dropEvery = 0 } = {}) => `
${frameStampSource()}

window.__wz = {
  stamp: ${stamp ? 'true' : 'false'},
  dropEvery: ${Number(dropEvery)},
  pcs: [],
  sent: [],
  frames: [],
  presented: [],
  byRtp: new Map(),
  senders: 0,
  receivers: 0,
  ridSeen: false,
  log: [],
};

(() => {
  const W = window.__wz;
  const Native = window.RTCPeerConnection;

  const note = (message) => { W.log.push(message); };

  const attachSender = (sender) => {
    if (!sender || !sender.track || sender.track.kind !== 'video' || sender.__wz) return;
    if (typeof sender.createEncodedStreams !== 'function') { note('sender: no createEncodedStreams'); return; }
    sender.__wz = true;
    let streams;
    try { streams = sender.createEncodedStreams(); }
    catch (error) { note('sender createEncodedStreams: ' + error.message); return; }
    W.senders += 1;

    /*
     * One sequence per simulcast rung. A single counter across a three-rung sender arrives at
     * the player full of gaps and reports a stalling publisher that was fine.
     *
     * The rung is identified by synchronizationSource, NOT by rid and NOT by spatialIndex.
     * Measured on 2026-09-17, Chromium 1.63 bundled with Playwright, against a three-rung
     * h/m/l publish: rid was undefined on all 204 sampled frames and spatialIndex was 0 on
     * all of them, while synchronizationSource took a distinct value per rung and tracked the
     * frame sizes (320x240 and 640x480 arriving under different SSRCs). getParameters() still
     * reports rid h, m and l on the encodings, so the rid exists; it just does not reach
     * RTCEncodedVideoFrame.getMetadata().
     */
    const counters = new Map();
    let seen = 0;

    const transformer = new TransformStream({
      transform(frame, controller) {
        try {
          seen += 1;
          const meta = typeof frame.getMetadata === 'function' ? frame.getMetadata() : {};
          if (meta.rid != null) W.ridSeen = true;
          const rung = meta.synchronizationSource != null ? 'ssrc:' + meta.synchronizationSource
            : (meta.rid != null ? meta.rid
              : (meta.spatialIndex != null ? 's' + meta.spatialIndex : 'one'));
          const advance = () => {
            const next = (counters.get(rung) || 0) + 1;
            counters.set(rung, next);
            return next;
          };

          if (W.dropEvery > 0 && seen % W.dropEvery === 0) {
            // The sequence advances and the frame does not leave, which is what real loss
            // looks like from the player's side.
            W.sent.push({ rung, seq: advance(), dropped: true });
            return;
          }

          if (W.stamp) {
            const seq = advance();
            const sentAt = Date.now();
            const sei = buildSeiPayload({ sequence: seq, sentAt });
            const body = new Uint8Array(frame.data);
            const out = new Uint8Array(sei.length + body.length);
            out.set(sei, 0);
            out.set(body, sei.length);
            frame.data = out.buffer;
            W.sent.push({
              rung, seq, sentAt,
              rtp: meta.rtpTimestamp != null ? meta.rtpTimestamp : null,
              keyFrame: frame.type === 'key',
              bytes: out.length,
            });
          } else {
            W.sent.push({ rung, seq: advance(), bare: true });
          }
        } catch (error) { note('sender transform: ' + error.message); }
        controller.enqueue(frame);
      },
    });

    streams.readable.pipeThrough(transformer).pipeTo(streams.writable)
      .catch((error) => note('sender pipe: ' + error.message));
  };

  const attachReceiver = (receiver) => {
    if (!receiver || receiver.__wz) return;
    if (!receiver.track || receiver.track.kind !== 'video') return;
    if (typeof receiver.createEncodedStreams !== 'function') { note('receiver: no createEncodedStreams'); return; }
    receiver.__wz = true;
    let streams;
    try { streams = receiver.createEncodedStreams(); }
    catch (error) { note('receiver createEncodedStreams: ' + error.message); return; }
    W.receivers += 1;

    const transformer = new TransformStream({
      transform(frame, controller) {
        try {
          const arrivedAt = Date.now();
          const arrivedHi = performance.now();
          const meta = typeof frame.getMetadata === 'function' ? frame.getMetadata() : {};
          /*
           * rtpTimestamp is the join key because it is the only field that appears on both
           * RTCEncodedVideoFrame.getMetadata() and requestVideoFrameCallback's metadata.
           * frame.timestamp is the older spelling of the same number and is read as a
           * fallback so a browser carrying one but not the other still joins.
           */
          const rtp = meta.rtpTimestamp != null ? meta.rtpTimestamp
            : (frame.timestamp != null ? frame.timestamp : null);
          const found = findSeiPayload(frame.data);
          const record = {
            arrivedAt,
            arrivedHi,
            rtp,
            bytes: frame.data.byteLength,
            keyFrame: frame.type === 'key',
            seq: found ? found.sequence : null,
            sentAt: found ? found.sentAt : null,
            displayHi: null,
          };
          W.frames.push(record);
          if (rtp !== null) W.byRtp.set(rtp, record);
        } catch (error) { note('receiver transform: ' + error.message); }
        controller.enqueue(frame);
      },
    });

    streams.readable.pipeThrough(transformer).pipeTo(streams.writable)
      .catch((error) => note('receiver pipe: ' + error.message));
  };

  function Wrapped(config, ...rest) {
    const merged = Object.assign({}, config || {}, { encodedInsertableStreams: true });
    const pc = new Native(merged, ...rest);
    W.pcs.push(pc);
    // Registered here so it runs before the application assigns its own ontrack, which
    // matters on the paths where the receiver first appears in the track event.
    pc.addEventListener('track', (event) => {
      if (event.receiver) attachReceiver(event.receiver);
    });
    return pc;
  }
  Wrapped.prototype = Native.prototype;
  window.RTCPeerConnection = Wrapped;

  const origAddTrack = Native.prototype.addTrack;
  Native.prototype.addTrack = function addTrackHooked(...args) {
    const sender = origAddTrack.apply(this, args);
    try { attachSender(sender); } catch (error) { note('addTrack hook: ' + error.message); }
    return sender;
  };

  const origAddTransceiver = Native.prototype.addTransceiver;
  Native.prototype.addTransceiver = function addTransceiverHooked(...args) {
    const transceiver = origAddTransceiver.apply(this, args);
    try {
      attachSender(transceiver.sender);
      attachReceiver(transceiver.receiver);
    } catch (error) { note('addTransceiver hook: ' + error.message); }
    return transceiver;
  };
})();
`;

/** Starts the presented-frame join on a video element. Returns false when rVFC is absent. */
const joinPresentedFrames = (page, selector) =>
  page.evaluate((sel) => {
    const W = window.__wz;
    const video = document.querySelector(sel);
    if (!video || typeof video.requestVideoFrameCallback !== 'function') {
      W.log.push('no requestVideoFrameCallback on ' + sel);
      return false;
    }
    W.presented = [];
    const onFrame = (_now, meta) => {
      const rtp = meta && meta.rtpTimestamp != null ? meta.rtpTimestamp : null;
      const record = rtp === null ? undefined : W.byRtp.get(rtp);
      if (record && record.displayHi === null && typeof meta.expectedDisplayTime === 'number') {
        record.displayHi = meta.expectedDisplayTime;
      }
      W.presented.push({
        rtp,
        joined: !!record,
        stampedMatch: !!(record && record.seq !== null),
        hasExpected: !!(meta && typeof meta.expectedDisplayTime === 'number'),
      });
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
    return true;
  }, selector);

/** Everything the instrument accumulated, pulled back into Node for the arithmetic. */
const readInstrument = (page) =>
  page.evaluate(() => {
    const W = window.__wz;
    const byRung = {};
    for (const s of W.sent) byRung[s.rung] = (byRung[s.rung] || 0) + 1;
    return {
      log: W.log,
      ridSeen: W.ridSeen,
      senders: W.senders,
      receivers: W.receivers,
      peerConnections: W.pcs.length,
      sentTotal: W.sent.length,
      sentByRung: byRung,
      sentDropped: W.sent.filter((s) => s.dropped).length,
      frames: W.frames.map((f) => ({
        arrivedAt: f.arrivedAt, arrivedHi: f.arrivedHi, rtp: f.rtp, bytes: f.bytes,
        keyFrame: f.keyFrame, seq: f.seq, sentAt: f.sentAt, displayHi: f.displayHi,
      })),
      presented: W.presented.length,
      presentedJoined: W.presented.filter((p) => p.joined).length,
      presentedWithRtp: W.presented.filter((p) => p.rtp !== null).length,
      presentedWithExpected: W.presented.filter((p) => p.hasExpected).length,
    };
  });

/** Inbound video stats off whichever peer connection has them, for the do-no-harm comparison. */
const inboundVideoStats = (page) =>
  page.evaluate(async () => {
    for (const pc of window.__wz.pcs) {
      const report = await pc.getStats();
      let inbound = null;
      report.forEach((entry) => {
        if (entry.type === 'inbound-rtp' && entry.kind === 'video') inbound = entry;
      });
      if (!inbound) continue;
      let mimeType = null;
      report.forEach((entry) => { if (entry.id === inbound.codecId) mimeType = entry.mimeType; });
      return {
        mimeType,
        framesDecoded: inbound.framesDecoded ?? null,
        framesDropped: inbound.framesDropped ?? null,
        freezeCount: inbound.freezeCount ?? null,
        pliCount: inbound.pliCount ?? null,
        nackCount: inbound.nackCount ?? null,
        packetsLost: inbound.packetsLost ?? null,
        frameWidth: inbound.frameWidth ?? null,
        frameHeight: inbound.frameHeight ?? null,
        framesPerSecond: inbound.framesPerSecond ?? null,
      };
    }
    return null;
  });

const median = (values) => {
  const sorted = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  // Lower middle, so the figure printed is one some frame actually had.
  return sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) / 2)];
};

const percentile = (values, p) => {
  const sorted = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  return sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

/** The numbers every test prints, so a run's output is the measurement rather than a verdict. */
const summarize = (label, data) => {
  const stamped = data.frames.filter((f) => f.seq !== null);
  const transport = stamped.map((f) => f.arrivedAt - f.sentAt);
  const player = stamped.filter((f) => f.displayHi !== null).map((f) => f.displayHi - f.arrivedHi);
  const total = stamped
    .filter((f) => f.displayHi !== null)
    .map((f) => (f.arrivedAt - f.sentAt) + (f.displayHi - f.arrivedHi));

  // Gaps, per the module's own rule: a jump of more than one is loss, a repeat or a step
  // backwards is reorder or duplication and counts as nothing.
  let missed = 0;
  let previous = null;
  for (const frame of stamped) {
    if (previous !== null && frame.seq > previous) missed += frame.seq - previous - 1;
    previous = frame.seq;
  }

  const summary = {
    label,
    framesReceived: data.frames.length,
    framesStamped: stamped.length,
    markerRate: data.frames.length === 0 ? null : stamped.length / data.frames.length,
    sentTotal: data.sentTotal,
    sentByRung: data.sentByRung,
    sentDropped: data.sentDropped,
    missedFrames: missed,
    presented: data.presented,
    presentedJoined: data.presentedJoined,
    joinRate: data.presented === 0 ? null : data.presentedJoined / data.presented,
    transportP50: median(transport),
    transportP90: percentile(transport, 0.9),
    transportMin: transport.length ? Math.min(...transport) : null,
    transportMax: transport.length ? Math.max(...transport) : null,
    playerP50: median(player),
    totalP50: median(total),
    senders: data.senders,
    receivers: data.receivers,
    ridSeen: data.ridSeen,
    log: data.log,
  };
  console.log(`\n--- ${label} ---\n${JSON.stringify(summary, null, 2)}`);
  return summary;
};

/*
 * Publisher and player are separate browser contexts in most of these tests. Each context
 * gets its own copy of the init script, so each has its own instrument: the publisher's
 * context counts what it stamped and the player's counts what it read.
 */
const newInstrumentedContext = async (browser, options) => {
  const context = await browser.newContext();
  await context.addInitScript(instrument(options));
  return context;
};

/** Publishes a stream with the stamp on, H.264 forced, and waits for LIVE. */
const publishStamped = async (page, { streamName, useWhip = false, simulcast = false }) => {
  await page.goto('/#/publish');
  await requireEngine(page, test);
  if (simulcast) {
    await waitForCamera(page);
    await openTab(page, 'Source');
    await page.locator('#publishUseSimulcast').check();
    await openTab(page, 'Connection');
  }
  // H.264 explicitly. The stamp is an SEI NAL and no other codec here carries one, so a run
  // that negotiated VP8 would report a 0% marker rate that says nothing about the Engine.
  await startPublishing(page, { streamName, useWhip, codec: 'H264' });
  await expectLive(page);
};

/*
 * Retries the Play button until playback actually starts.
 *
 * Two separate races made this necessary, both measured here on 2026-09-17:
 *
 *   - The Engine answers GET_AVAILABLE_STREAMS with <name>_m and <name>_l several seconds
 *     before it will serve them, so the first click on a freshly listed rung negotiates and
 *     never arrives.
 *   - Even a plain wss play of the source stream intermittently fails to start on the first
 *     click, roughly one attempt in ten across this session's runs. The publish is LIVE, the
 *     form is filled, and the PLAYING badge never appears. The existing suites are exposed to
 *     the same race and pass because they do not run the path as many times.
 *
 * A fixed sleep would hide both on a slower machine, so this retries and resets the toggle
 * between attempts, because a half-started session leaves it reading "Stop".
 */
const playWithRetry = async (page) => {
  await expect(async () => {
    const toggle = page.locator('#play-toggle');
    if ((await toggle.innerText()).trim().toLowerCase() === 'stop') {
      await toggle.click();
      await page.waitForTimeout(500);
    }
    await toggle.click();
    await expect(page.locator('#video-play-indicator')).toBeVisible({ timeout: 8_000 });
  }).toPass({ timeout: 90_000 });
};

/** Fills the play form without pressing Play, so the caller can drive the retry. */
const fillPlayForm = async (page, { streamName, useWhep = false }) => {
  if (useWhep) await page.locator('#playUseWhep').check();
  await page.fill('#playSignalingURL', useWhep ? httpOrigin() : SIGNALING_URL);
  await page.fill('#playApplicationName', APPLICATION);
  await page.fill('#playStreamName', streamName);
};

/** Plays a stream on the play page and waits for the PLAYING badge. */
const playStamped = async (page, { streamName, useWhep = false }) => {
  await page.goto('/#/play');
  await fillPlayForm(page, { streamName, useWhep });
  await playWithRetry(page);
};

/** Picks one simulcast rung from the Engine's own rendition list and plays it. */
const waitForRendition = async (page, streamName, rung) => {
  await page.goto('/#/play');
  await page.fill('#playSignalingURL', SIGNALING_URL);
  await page.fill('#playApplicationName', APPLICATION);
  await page.fill('#playStreamName', streamName);
  const select = page.locator('#playRendition');
  await expect(async () => {
    await page.click('#play-find-renditions');
    await expect(select).toBeEnabled({ timeout: 3_000 });
  }).toPass({ timeout: 40_000 });
  const labels = (await select.locator('option').allTextContents()).join(' ');
  expect(labels, `rendition "${rung}" never appeared for ${streamName}`).toMatch(new RegExp(`"${rung}"`));
  await select.selectOption(`${streamName}_${rung}`);
  await expect(page.locator('#playStreamName')).toHaveValue(`${streamName}_${rung}`);
  await playWithRetry(page);
};

/* ============================================================ the marker survives ========= */

test.describe('the frame stamp survives the Engine', () => {
  test('wss publish to wss play: every received frame carries the marker', async ({ browser }) => {
    test.setTimeout(150_000);
    const pubContext = await newInstrumentedContext(browser);
    const playContext = await newInstrumentedContext(browser);
    const publisher = await pubContext.newPage();
    const viewer = await playContext.newPage();

    try {
      const streamName = uniqueStream('seiws');
      await publishStamped(publisher, { streamName });
      await playStamped(viewer, { streamName });
      await joinPresentedFrames(viewer, '#player-video');
      await viewer.waitForTimeout(10_000);

      const stats = await inboundVideoStats(viewer);
      const sent = summarize('wss -> wss, publisher', await readInstrument(publisher));
      const read = summarize('wss -> wss, player', await readInstrument(viewer));
      console.log(`inbound stats: ${JSON.stringify(stats)}`);

      // Without H.264 the marker question is meaningless, so this is checked before it.
      expect(stats?.mimeType, 'the session has to be H.264 for an SEI to exist').toMatch(/H264/i);
      expect(sent.sentTotal, 'the publisher stamped nothing').toBeGreaterThan(30);
      expect(read.framesReceived, 'no encoded frames reached the player').toBeGreaterThan(30);
      expect(read.markerRate).toBe(1);
    } finally {
      await pubContext.close();
      await playContext.close();
    }
  });

  test('wss publish to WHEP play: every received frame carries the marker', async ({ browser }) => {
    test.setTimeout(150_000);
    const pubContext = await newInstrumentedContext(browser);
    const playContext = await newInstrumentedContext(browser);
    const publisher = await pubContext.newPage();
    const viewer = await playContext.newPage();

    try {
      const streamName = uniqueStream('seiwhep');
      await publishStamped(publisher, { streamName });
      await playStamped(viewer, { streamName, useWhep: true });
      await joinPresentedFrames(viewer, '#player-video');
      await viewer.waitForTimeout(10_000);

      const stats = await inboundVideoStats(viewer);
      summarize('wss -> WHEP, publisher', await readInstrument(publisher));
      const read = summarize('wss -> WHEP, player', await readInstrument(viewer));
      console.log(`inbound stats: ${JSON.stringify(stats)}`);

      expect(stats?.mimeType, 'the session has to be H.264 for an SEI to exist').toMatch(/H264/i);
      expect(read.framesReceived, 'no encoded frames reached the WHEP player').toBeGreaterThan(30);
      expect(read.markerRate).toBe(1);
    } finally {
      await pubContext.close();
      await playContext.close();
    }
  });

  test('the probe off produces no marker at all', async ({ browser }) => {
    test.setTimeout(150_000);
    // stamp:false leaves the transforms attached and counting, so a 0% marker rate here is
    // evidence the reader is running and finding nothing, not evidence that it never ran.
    const pubContext = await newInstrumentedContext(browser, { stamp: false });
    const playContext = await newInstrumentedContext(browser, { stamp: false });
    const publisher = await pubContext.newPage();
    const viewer = await playContext.newPage();

    try {
      const streamName = uniqueStream('seioff');
      await publishStamped(publisher, { streamName });
      await playStamped(viewer, { streamName });
      await viewer.waitForTimeout(8_000);

      const read = summarize('probe off, player', await readInstrument(viewer));
      expect(read.framesReceived, 'the reader never saw a frame, so this proves nothing')
        .toBeGreaterThan(30);
      expect(read.framesStamped).toBe(0);
      expect(read.markerRate).toBe(0);
    } finally {
      await pubContext.close();
      await playContext.close();
    }
  });
});

/* ========================================================== the open question ============= */

/*
 * THE ONE THAT MATTERS. A stamp in the pixels collapsed to 8.7% readable on a rescaled
 * simulcast rung, and fabricated confident wrong numbers rather than failing. If the SEI
 * holds across the rungs, that comparison is settled and the bitstream argument in the design
 * doc stands on measurement instead of reasoning.
 */
test.describe('the open question: does the marker survive the simulcast rungs', () => {
  /*
   * A three-rung publish, and only the rungs the browser actually fills are measured.
   *
   * Measured on 2026-09-17 against the fake 640x480 camera: with encodings h, m and l at
   * scaleResolutionDownBy 1, 2 and 4, Chromium encodes h and m and never encodes l. After 45
   * seconds the l entry in outbound-rtp reads active true, qualityLimitationReason "none" and
   * framesSent 0. The Engine still advertises <name>_l in its rendition list, because three
   * rids were negotiated, but no bytes ever flow for it.
   *
   * So a test that demands a marker count on _l is not testing the marker, it is testing an
   * encoder that declined to produce a rung. This reads the publisher's own outbound-rtp and
   * measures the rungs with framesSent above zero, naming the ones it skipped and why. The
   * whole point of this instrument is to refuse rather than to produce a plausible number,
   * and its own test suite has to hold to the same rule.
   */
  const outboundRungs = (page) =>
    page.evaluate(async () => {
      for (const pc of window.__wz.pcs) {
        const report = await pc.getStats();
        const rows = [];
        report.forEach((entry) => {
          if (entry.type === 'outbound-rtp' && entry.kind === 'video') {
            rows.push({
              rid: entry.rid ?? null,
              ssrc: String(entry.ssrc),
              active: entry.active ?? null,
              framesSent: entry.framesSent ?? 0,
              frameWidth: entry.frameWidth ?? null,
              frameHeight: entry.frameHeight ?? null,
              qualityLimitationReason: entry.qualityLimitationReason ?? null,
            });
          }
        });
        if (rows.length) return rows;
      }
      return [];
    });

  /*
   * The rungs are measured ONE AT A TIME, each with a fresh viewer context closed before the
   * next starts. Two viewers on two different rungs of one simulcast ingest at once is not
   * reliable here: with nothing injected, _m played and a simultaneous _l then failed through
   * 90 seconds of retries. That is not the frame stamp, and measuring in parallel would have
   * blamed the stamp for it.
   */
  const runRungs = async (browser, { stamp }) => {
    const pubContext = await newInstrumentedContext(browser, { stamp });
    const publisher = await pubContext.newPage();
    const result = { stamp, publisher: null, outbound: [], rungs: {}, skipped: {} };

    try {
      const streamName = uniqueStream(stamp ? 'simOn' : 'simOff');
      await publishStamped(publisher, { streamName, simulcast: true });
      // Long enough for the encoder to have settled on which rungs it is going to fill.
      await publisher.waitForTimeout(15_000);
      result.outbound = await outboundRungs(publisher);
      console.log(`\npublisher outbound rungs, stamp=${stamp}:\n${JSON.stringify(result.outbound, null, 2)}`);

      // "h" is the source stream itself, so only the rescaled rungs have a <name>_<rid>.
      for (const row of result.outbound) {
        if (row.rid === null || row.rid === 'h') continue;
        if (row.framesSent === 0) {
          result.skipped[row.rid] = `the browser encoded 0 frames for rung ${row.rid} `
            + `(active=${row.active}, qualityLimitationReason=${row.qualityLimitationReason})`;
          continue;
        }
        const context = await newInstrumentedContext(browser, { stamp });
        const viewer = await context.newPage();
        try {
          await waitForRendition(viewer, streamName, row.rid);
          await joinPresentedFrames(viewer, '#player-video');
          await viewer.waitForTimeout(10_000);
          const read = summarize(`simulcast rung _${row.rid}, stamp=${stamp}`, await readInstrument(viewer));
          const inbound = await inboundVideoStats(viewer);
          console.log(`_${row.rid} inbound: ${JSON.stringify(inbound)}`);
          result.rungs[row.rid] = { played: true, read, inbound };
        } catch (error) {
          result.rungs[row.rid] = { played: false, error: error.message.split('\n')[0] };
        } finally {
          await context.close();
        }
      }

      result.publisher = summarize(`simulcast publisher, stamp=${stamp}`, await readInstrument(publisher));
      console.log(`rungs skipped, stamp=${stamp}: ${JSON.stringify(result.skipped)}`);
      return result;
    } finally {
      await pubContext.close();
    }
  };

  test('the control: a rescaled rung plays when nothing is injected', async ({ browser }) => {
    test.setTimeout(300_000);
    const control = await runRungs(browser, { stamp: false });
    const measuredRungs = Object.keys(control.rungs);

    // If a rescaled rung does not play with nothing injected, the harness or the Engine is
    // the problem, and the measurement below would blame the stamp for it.
    expect(measuredRungs.length,
      `no rescaled rung carried frames to measure. Skipped: ${JSON.stringify(control.skipped)}`)
      .toBeGreaterThan(0);
    for (const rung of measuredRungs) {
      expect(control.rungs[rung].played,
        `rung _${rung} did not play with no stamp: ${control.rungs[rung].error}`).toBe(true);
      expect(control.rungs[rung].read.framesStamped,
        'a control run must carry no marker').toBe(0);
    }
  });

  test('the measurement: count marker hits on every rung the browser fills', async ({ browser }) => {
    test.setTimeout(300_000);
    const measured = await runRungs(browser, { stamp: true });

    /*
     * The sender's encoded stream carries every rung's frames under a different SSRC, so more
     * than one key here is the proof that simulcast was genuinely running rather than the
     * publish having quietly fallen back to a single encoding.
     */
    expect(Object.keys(measured.publisher.sentByRung).length,
      `simulcast was not active: ${JSON.stringify(measured.publisher.sentByRung)}`)
      .toBeGreaterThanOrEqual(2);

    /*
     * A standing note, not a requirement. rid is undefined on every sender frame in this
     * Chromium, which is why the rung is keyed on SSRC. If this ever prints true the probe
     * module can key on rid instead, which survives a renegotiation where an SSRC may not.
     */
    console.log(`rid populated on any sender frame: ${measured.publisher.ridSeen}`);

    const measuredRungs = Object.keys(measured.rungs);
    expect(measuredRungs.length,
      `no rescaled rung carried frames to measure. Skipped: ${JSON.stringify(measured.skipped)}`)
      .toBeGreaterThan(0);

    for (const rung of measuredRungs) {
      const outcome = measured.rungs[rung];
      expect(outcome.played,
        `rung _${rung} never played with the stamp injected although the control plays it, `
        + `which is the stamp breaking the Engine's rung republish: ${outcome.error}`).toBe(true);
      expect(outcome.read.framesReceived, `rung _${rung} delivered no frames`).toBeGreaterThan(30);
      // The answer to the design doc's open question. The pixel stamp managed 8.7% here.
      expect(outcome.read.markerRate, `the marker did not survive rung _${rung}`).toBe(1);
      // And the rung really was rescaled, or this is not the case the pixel stamp failed on.
      expect(outcome.inbound.frameWidth,
        `rung _${rung} was not rescaled, so it does not test what killed the pixel stamp`)
        .toBeLessThan(640);
    }
  });
});

/* ============================================================ does no harm ================ */

test.describe('injection does no harm', () => {
  /*
   * Baseline against stamped, and TWO runs of each, because one of each is not enough to tell
   * a difference from noise.
   *
   * The first version of this test ran one baseline and one stamped session and asserted the
   * three counters equal. It failed on freezeCount: baseline 0, stamped 1. That looks like
   * harm and is not. In the same session, a simulcast run with NOTHING injected reported
   * freezeCount 4, so freezeCount moves on its own here: it is derived from inter-frame gaps
   * and picks up compositor scheduling and session startup, not just bitstream damage.
   *
   * So the counters are split by what they actually mean:
   *
   *   framesDropped, pliCount, packetsLost, and the decoded resolution are the ones a
   *   decoder moves when it cannot parse a frame. It discards the frame, asks for a keyframe,
   *   and in the worst case falls back to a different resolution. These are asserted equal.
   *
   *   freezeCount is reported and bounded, not asserted equal, and the bound is stated in
   *   terms of the baseline's own run-to-run spread rather than a number picked out of the
   *   air.
   */
  test('the decoder counters match a baseline run', async ({ browser }) => {
    test.setTimeout(400_000);
    const measure = async (stamp, run) => {
      const pubContext = await newInstrumentedContext(browser, { stamp });
      const playContext = await newInstrumentedContext(browser, { stamp });
      const publisher = await pubContext.newPage();
      const viewer = await playContext.newPage();
      try {
        const streamName = uniqueStream(stamp ? `harmOn${run}` : `harmOff${run}`);
        await publishStamped(publisher, { streamName });
        await playStamped(viewer, { streamName });
        await viewer.waitForTimeout(12_000);
        const read = await readInstrument(viewer);
        const stats = await inboundVideoStats(viewer);
        const label = `${stamp ? 'stamped' : 'baseline'} run ${run}`;
        summarize(label, read);
        console.log(`${label} inbound: ${JSON.stringify(stats)}`);
        return { label, stats, read };
      } finally {
        await pubContext.close();
        await playContext.close();
      }
    };

    const baselines = [await measure(false, 1), await measure(false, 2)];
    const stampeds = [await measure(true, 1), await measure(true, 2)];
    const all = [...baselines, ...stampeds];

    for (const arm of all) {
      expect(arm.stats, `${arm.label} produced no inbound video stats`).not.toBeNull();
    }
    // The marker has to actually be in the stamped arms, or this test compares nothing.
    for (const arm of stampeds) {
      expect(arm.read.frames.filter((f) => f.seq !== null).length,
        `${arm.label} carried no marker`).toBeGreaterThan(30);
    }
    for (const arm of baselines) {
      expect(arm.read.frames.filter((f) => f.seq !== null).length,
        `${arm.label} is a baseline and must carry no marker`).toBe(0);
    }

    const values = (arms, field) => arms.map((a) => a.stats[field]);
    const report = {
      framesDropped: { baseline: values(baselines, 'framesDropped'), stamped: values(stampeds, 'framesDropped') },
      pliCount: { baseline: values(baselines, 'pliCount'), stamped: values(stampeds, 'pliCount') },
      nackCount: { baseline: values(baselines, 'nackCount'), stamped: values(stampeds, 'nackCount') },
      packetsLost: { baseline: values(baselines, 'packetsLost'), stamped: values(stampeds, 'packetsLost') },
      freezeCount: { baseline: values(baselines, 'freezeCount'), stamped: values(stampeds, 'freezeCount') },
      resolution: all.map((a) => `${a.stats.frameWidth}x${a.stats.frameHeight}`),
      framesDecoded: all.map((a) => a.stats.framesDecoded),
    };
    console.log(`\n--- does no harm, four sessions ---\n${JSON.stringify(report, null, 2)}`);

    // The parse-failure counters, asserted equal across every session.
    for (const field of ['framesDropped', 'pliCount', 'packetsLost']) {
      const baselineMax = Math.max(...values(baselines, field));
      for (const arm of stampeds) {
        expect(arm.stats[field],
          `${field} moved with the stamp: baseline ${JSON.stringify(values(baselines, field))}, `
          + `${arm.label} ${arm.stats[field]}`).toBe(baselineMax);
      }
    }

    // A decoder that could not parse the stream would not hold the same resolution.
    const resolutions = new Set(report.resolution);
    expect([...resolutions],
      `the decoded resolution differed across sessions: ${JSON.stringify(report.resolution)}`)
      .toHaveLength(1);

    /*
     * freezeCount, bounded rather than equal. The allowance is the baseline's own spread plus
     * one, so a stamped arm is only a failure when it freezes more than the baseline varies
     * by on its own. With two baselines the spread is a floor on the real noise, not a
     * measurement of it, which is why the plus one is there and why this is the one counter
     * that is not asserted equal.
     */
    const baselineSpread = Math.max(...values(baselines, 'freezeCount'))
      - Math.min(...values(baselines, 'freezeCount'));
    const allowance = Math.max(...values(baselines, 'freezeCount')) + baselineSpread + 1;
    for (const arm of stampeds) {
      expect(arm.stats.freezeCount,
        `${arm.label} froze ${arm.stats.freezeCount} times against baselines `
        + `${JSON.stringify(values(baselines, 'freezeCount'))}, past the allowance of ${allowance}`)
        .toBeLessThanOrEqual(allowance);
    }
  });
});

/* ====================================================== join to presented frames ========== */

test.describe('encoded frames join to presented frames', () => {
  test('every presented frame matches an encoded frame on rtpTimestamp', async ({ browser }) => {
    test.setTimeout(150_000);
    const pubContext = await newInstrumentedContext(browser);
    const playContext = await newInstrumentedContext(browser);
    const publisher = await pubContext.newPage();
    const viewer = await playContext.newPage();

    try {
      const streamName = uniqueStream('join');
      await publishStamped(publisher, { streamName });
      await playStamped(viewer, { streamName });
      // The join starts after PLAYING, so presented frames are only counted from a point
      // where every encoded frame they could match is already recorded.
      await joinPresentedFrames(viewer, '#player-video');
      await viewer.waitForTimeout(12_000);

      const read = await readInstrument(viewer);
      const summary = summarize('rtpTimestamp join', read);
      const withDisplay = read.frames.filter((f) => f.displayHi !== null).length;
      console.log(`encoded records that got a display time: ${withDisplay} of ${read.frames.length}`);

      expect(summary.presented, 'requestVideoFrameCallback never fired').toBeGreaterThan(30);
      expect(read.presentedWithRtp, 'rVFC metadata carried no rtpTimestamp, so no join is possible')
        .toBe(summary.presented);
      expect(read.presentedWithExpected, 'rVFC metadata carried no expectedDisplayTime')
        .toBe(summary.presented);
      expect(summary.joinRate).toBe(1);
      // A join that produced no player-side figure is a join in name only.
      expect(summary.playerP50).not.toBeNull();
    } finally {
      await pubContext.close();
      await playContext.close();
    }
  });
});

/* ============================================================ a stalled publisher ========= */

test.describe('a stalled publisher produces missed frames, not a wrong number', () => {
  /*
   * Two different stalls, because they fail differently and the design doc conflates them.
   *
   * Loss: frames go missing and the sequence numbers say so. Manufactured, because this
   * Engine on loopback loses nothing.
   *
   * Silence: the publisher's main thread blocks, so nothing is stamped and nothing is sent.
   * The player cannot see a gap, only an absence, and the honest output is the age of the
   * last frame rather than a figure computed from it.
   */
  test('dropped frames are counted as missed, and the count matches what was dropped', async ({ browser }) => {
    test.setTimeout(150_000);
    const dropEvery = 10;
    const pubContext = await newInstrumentedContext(browser, { dropEvery });
    const playContext = await newInstrumentedContext(browser);
    const publisher = await pubContext.newPage();
    const viewer = await playContext.newPage();

    try {
      const streamName = uniqueStream('drop');
      await publishStamped(publisher, { streamName });
      await playStamped(viewer, { streamName });
      await viewer.waitForTimeout(12_000);

      const sent = summarize('every 10th frame dropped, publisher', await readInstrument(publisher));
      const read = summarize('every 10th frame dropped, player', await readInstrument(viewer));

      expect(sent.sentDropped, 'nothing was dropped, so there is nothing to detect')
        .toBeGreaterThan(3);
      expect(read.framesStamped, 'the player read no stamped frames').toBeGreaterThan(30);
      expect(read.missedFrames, 'the player saw no gaps although frames were dropped')
        .toBeGreaterThan(0);
      // The count has to be roughly the loss rate, not merely non-zero. A tenth of the
      // frames were discarded, so about a ninth of what arrives should be missing ahead of
      // it. Wide bounds, because the two windows do not start and end on the same frame.
      const lossRatio = read.missedFrames / (read.framesStamped + read.missedFrames);
      console.log(`measured loss ratio: ${lossRatio} against an injected 1 in ${dropEvery}`);
      expect(lossRatio).toBeGreaterThan(0.03);
      expect(lossRatio).toBeLessThan(0.25);
    } finally {
      await pubContext.close();
      await playContext.close();
    }
  });

  test('a blocked publisher thread produces a measurable silence, not a fresh figure', async ({ browser }) => {
    test.setTimeout(180_000);
    const pubContext = await newInstrumentedContext(browser);
    const playContext = await newInstrumentedContext(browser);
    const publisher = await pubContext.newPage();
    const viewer = await playContext.newPage();

    try {
      const streamName = uniqueStream('stall');
      await publishStamped(publisher, { streamName });
      await playStamped(viewer, { streamName });
      await viewer.waitForTimeout(6_000);

      const before = await readInstrument(viewer);
      const blockMs = 4_000;
      // Deliberately synchronous: a busy loop on the publisher's main thread is what a
      // stalled publisher looks like from the outside, and it stops the sender transform
      // along with everything else.
      await publisher.evaluate((ms) => {
        const until = Date.now() + ms;
        while (Date.now() < until) { /* hold the thread */ }
      }, blockMs);
      const after = await readInstrument(viewer);

      const stampedBefore = before.frames.filter((f) => f.seq !== null);
      const stampedAfter = after.frames.filter((f) => f.seq !== null);
      const arrivals = stampedAfter.map((f) => f.arrivedAt);
      let biggestSilence = 0;
      for (let i = 1; i < arrivals.length; i += 1) {
        biggestSilence = Math.max(biggestSilence, arrivals[i] - arrivals[i - 1]);
      }
      /*
       * The age of the newest frame, and NOT the biggest gap between two arrivals, is the
       * signal that matters.
       *
       * Measured on the first run of this test: a 4,000 ms block produced framesDuringBlock 0,
       * newestFrameAgeMs 4,022 and biggestSilenceMs 64. Nothing arrived at all during the
       * block, so the silence sits at the END of the arrival record and there is no pair of
       * arrivals to measure a gap between. An assertion on the gap passes only if the
       * publisher recovers before the record is read, which makes it an assertion about
       * recovery timing rather than about the stall. The design's STALE_MS rule reads the age
       * of the last frame, which is exactly the quantity that moves here.
       */
      const summary = summarize('blocked publisher, player', after);
      const newestAgeAtRead = Date.now() - (arrivals.length ? arrivals[arrivals.length - 1] : Date.now());
      const framesDuringBlock = stampedAfter.length - stampedBefore.length;

      console.log(`\n--- blocked publisher ---\n${JSON.stringify({
        blockMs,
        stampedBefore: stampedBefore.length,
        stampedAfter: stampedAfter.length,
        framesDuringBlock,
        biggestSilenceMs: biggestSilence,
        newestFrameAgeMs: newestAgeAtRead,
        missedFramesReported: summary.missedFrames,
        transportP50BeforeBlock: summary.transportP50,
      }, null, 2)}`);

      expect(stampedBefore.length, 'nothing was measured before the block').toBeGreaterThan(30);

      /*
       * The staleness must be visible. Either the publisher went silent and the newest frame
       * is now older than the probe's STALE_MS of 1,000 ms, or it recovered inside the window
       * and left a gap that size in the record. One of the two has to be true, or the block
       * did not reach the media path and this test measured nothing.
       */
      expect(Math.max(newestAgeAtRead, biggestSilence),
        `neither a stale newest frame nor a gap: age ${newestAgeAtRead} ms, gap ${biggestSilence} ms`)
        .toBeGreaterThan(1_000);

      /*
       * And the block really did stop the media, rather than the browser buffering through it.
       * At about 20 fps a 4 s block should cost roughly 80 frames, so anything close to that
       * many arriving would mean the thread was not actually held.
       */
      expect(framesDuringBlock,
        `${framesDuringBlock} stamped frames arrived during a ${blockMs} ms block, so the `
        + 'publisher was not actually stalled').toBeLessThan(20);

      /*
       * The point of the whole test. Every figure the probe would show rests on frames that
       * arrived BEFORE the block, so it must be reported as stale rather than as a current
       * latency. This asserts the input to that decision exists and is honest: the newest
       * frame is old, and the median is a median of pre-block frames, not a fresh reading.
       */
      expect(stampedAfter.length, 'no stamped frame at all after the block').toBeGreaterThan(30);
      expect(summary.transportP50,
        'a stalled session still has to carry its last real measurement, not null')
        .not.toBeNull();
    } finally {
      await pubContext.close();
      await playContext.close();
    }
  });
});

/* =========================================== mode A against mode B ======================== */

test.describe('same-machine clock modes agree', () => {
  /*
   * Mode A is one browser context with publisher and player in one JS context, which is the
   * split view. Mode B is two contexts on one machine. Both read the same OS clock, so both
   * should produce the same transport figure and the difference between them is the thing
   * being measured. A disagreement here would mean the split view is measuring something the
   * two-window case is not.
   */
  test('the split view and two contexts report the same Engine leg', async ({ browser }) => {
    test.setTimeout(240_000);

    const modeA = await (async () => {
      const context = await newInstrumentedContext(browser);
      const page = await context.newPage();
      try {
        const streamName = uniqueStream('modeA');
        await page.goto('/#/loopback');
        await requireEngine(page, test);
        await startPublishing(page, { streamName, codec: 'H264' });
        await expectLive(page);
        await page.getByRole('button', { name: 'Player', exact: true }).click();
        await fillPlayForm(page, { streamName });
        await playWithRetry(page);
        await joinPresentedFrames(page, '#player-video');
        await page.waitForTimeout(12_000);
        return summarize('mode A, split view, one context', await readInstrument(page));
      } finally {
        await context.close();
      }
    })();

    const modeB = await (async () => {
      const pubContext = await newInstrumentedContext(browser);
      const playContext = await newInstrumentedContext(browser);
      const publisher = await pubContext.newPage();
      const viewer = await playContext.newPage();
      try {
        const streamName = uniqueStream('modeB');
        await publishStamped(publisher, { streamName });
        await playStamped(viewer, { streamName });
        await joinPresentedFrames(viewer, '#player-video');
        await viewer.waitForTimeout(12_000);
        return summarize('mode B, two contexts, one machine', await readInstrument(viewer));
      } finally {
        await pubContext.close();
        await playContext.close();
      }
    })();

    expect(modeA.markerRate, 'the split view read no marker').toBe(1);
    expect(modeB.markerRate, 'the two-context run read no marker').toBe(1);
    expect(modeA.transportP50).not.toBeNull();
    expect(modeB.transportP50).not.toBeNull();

    const difference = Math.abs(modeA.transportP50 - modeB.transportP50);
    console.log(`\nmode A p50 ${modeA.transportP50} ms, mode B p50 ${modeB.transportP50} ms, `
      + `difference ${difference} ms`);

    /*
     * 40 ms, and the number is a tolerance on session-to-session variation rather than on
     * clock error, which is zero in both arms by construction. The Engine leg measured about
     * 100 ms on 2026-09-17 with a session-to-session spread of a few milliseconds; 40 ms is
     * wide enough for a jitter buffer that settles differently on two runs and narrow enough
     * that a systematic clock difference between the two modes would fail it.
     */
    expect(difference).toBeLessThan(40);
  });
});

/* ========================================== the feature, when it is in the build ========== */

/*
 * Everything above tests the instrument. These test the FEATURE: the toggle, the panel and
 * the wiring that connects them. They skip with a named reason when the probe is not in the
 * build, because a failure there says nothing about whether the stamp works.
 */
const requireProbeUi = async (page, testRef) => {
  await page.goto('/#/play');
  const present = await page.locator('#playLatencyProbe').count();
  testRef.skip(present === 0,
    'The Latency Probe toggle is not in this build. src/diagnostics/latencyProbe.js and '
    + 'src/components/diagnostics/LatencyGroup.jsx have to be placed and the pages wired '
    + 'before these can run.');
};

test.describe('the latency probe feature', () => {
  test('the probe off renders no latency group', async ({ page }) => {
    await requireProbeUi(page, test);
    await requireEngine(page, test);
    const streamName = uniqueStream('uioff');

    await page.goto('/#/loopback');
    await startPublishing(page, { streamName, codec: 'H264' });
    await expectLive(page);
    await page.getByRole('button', { name: 'Player', exact: true }).click();
    await fillPlayForm(page, { streamName });
    await playWithRetry(page);
    await page.waitForTimeout(4_000);

    await expect(page.locator('#latency-group')).toHaveCount(0);
  });

  test('with the probe on at both ends the panel reports a figure', async ({ page }) => {
    test.setTimeout(150_000);
    await requireProbeUi(page, test);
    await requireEngine(page, test);
    const streamName = uniqueStream('uion');

    await page.goto('/#/loopback');
    await waitForCamera(page);
    await openTab(page, 'Advanced');
    await page.locator('#publishLatencyProbe').check();
    await openTab(page, 'Connection');
    await startPublishing(page, { streamName, codec: 'H264' });
    await expectLive(page);

    await page.getByRole('button', { name: 'Player', exact: true }).click();
    await openTab(page, 'Advanced');
    await page.locator('#playLatencyProbe').check();
    await openTab(page, 'Connection');
    await fillPlayForm(page, { streamName });
    await playWithRetry(page);

    const group = page.locator('#latency-group');
    await expect(group).toBeVisible({ timeout: 20_000 });
    // Both arms are in one JS context, so the clock is the same one and the panel has to say
    // so rather than quote an uncertainty it does not have.
    await expect(group).toContainText(/exact/i, { timeout: 30_000 });
    await expect(group).toContainText(/\d+\s*ms/, { timeout: 30_000 });
    console.log(`latency panel text:\n${await group.innerText()}`);
  });
});

/*
 * Two regressions found by Alex testing on his own machine, both of which the suite above
 * missed because it checked the parts and not the assembled panel.
 */
/*
 * encodedInsertableStreams is a property of the whole peer connection. Once it is on, every
 * sender and receiver hands its encoded frames to script and sends nothing until script hands
 * them back, and the probe only ever wanted the video. Switching the probe on therefore took
 * the audio off the air: 0 bytes and 0 packets sent, while the player showed "Audio codec:
 * none" on a session whose SDP had negotiated opus.
 */
/*
 * The stamp is an H.264 SEI NAL. Publishing to a server that answers VP8 leaves the probe
 * running and writing nothing, and the panel used to offer three possibilities and leave the
 * reader to work out which one applied. It knows.
 */
/*
 * The combined page stamps and reads in one JavaScript context, so both ends call the same
 * Date.now and the offset between them is zero by construction. The clock samples still travel
 * out to the Engine and back, and that round trip measured ± 34 ms, past the trusted bound, so
 * the page refused to show any figure at all: three dashes and "Clock offset too uncertain to
 * measure". That is the page most testing runs on.
 */
/*
 * The panel carries three kinds of latency figure that answer different questions, and the
 * commonest one asked about them is why the player's estimate and the probe disagree. The
 * long answer used to be a paragraph nobody read twice; it is behind a button now.
 */
/*
 * The visible counterpart to the frame stamp: the time drawn onto every frame before encode,
 * so a publisher and a player side by side can be read against each other by eye.
 *
 * It replaces the published video track, which is the part that can go wrong. The first
 * version tied the derived track to a React effect and stopped it in the cleanup: the effect
 * re-runs for unrelated reasons and the publish went to three encoded frames and stayed there.
 */
/*
 * Every probe handle used to be dropped on the floor. Nothing stopped when a session stopped:
 * the clock kept a 250 ms timer chain for the life of the tab, the probe kept a 500 ms emit
 * interval and a reference to the closed connection, and the publisher went on reporting
 * itself as stamping. That last one decides whether the panel may call two clocks identical,
 * so a later play-only session against someone else's stream could be told its figures were
 * exact when they were guesses.
 */
test.describe('a stopped session lets go', () => {

  const countTimers = (page) => page.evaluate(() => ({
    timeouts: window.__wzTimers.timeouts.size,
    intervals: window.__wzTimers.intervals.size,
  }));

  const watchTimers = (page) => page.addInitScript(() => {
    window.__wzTimers = { timeouts: new Set(), intervals: new Set() };
    const { setTimeout: st, clearTimeout: ct, setInterval: si, clearInterval: ci } = window;
    window.setTimeout = (...a) => {
      const id = st(...a);
      window.__wzTimers.timeouts.add(id);
      return id;
    };
    window.clearTimeout = (id) => { window.__wzTimers.timeouts.delete(id); return ct(id); };
    window.setInterval = (...a) => {
      const id = si(...a);
      window.__wzTimers.intervals.add(id);
      return id;
    };
    window.clearInterval = (id) => { window.__wzTimers.intervals.delete(id); return ci(id); };
  });

  test('the probe stops emitting and stops holding the connection', async ({ browser }) => {
    const publisher = await browser.newPage();
    await publisher.goto('/#/publish');
    await requireEngine(publisher, test);

    const streamName = uniqueStream('letgo');
    await waitForCamera(publisher);
    await openTab(publisher, 'Advanced');
    await publisher.locator('#publishLatencyProbe').check();
    await openTab(publisher, 'Connection');
    await startPublishing(publisher, { streamName });
    await expectLive(publisher);

    const viewer = await browser.newPage();
    await watchTimers(viewer);
    await viewer.goto('/#/play');
    await openTab(viewer, 'Advanced');
    await viewer.locator('#playLatencyProbe').check();
    await openTab(viewer, 'Connection');
    await startPlaying(viewer, { streamName });
    await expectPlaying(viewer);
    await viewer.waitForTimeout(3000);

    const running = await countTimers(viewer);
    expect(running.intervals, 'the probe should be emitting while it plays')
      .toBeGreaterThan(0);

    await viewer.locator('#play-toggle').click();
    await viewer.waitForTimeout(2000);

    const stopped = await countTimers(viewer);
    expect(stopped.intervals, 'the probe kept its emit interval after the stop')
      .toBeLessThan(running.intervals);


    await publisher.close();
    await viewer.close();
  });

  /*
   * The consequence, rather than the flag.
   *
   * "The publisher is stamping in this page" is what lets the panel call two clocks identical
   * and skip the uncertainty gate. Left set after a publish stops, the next play-only session
   * in that same page is told its figures are exact when they were estimated from another
   * machine's clock.
   *
   * The route change is a hash change, so the module state survives it. A reload would reset
   * the very flag under test and the assertion would pass for the wrong reason.
   */
  test('a stopped publisher does not make the next playback claim one clock', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/#/publish');
    await requireEngine(page, test);

    // Publish with the probe, then stop. This is what used to leave the flag set.
    await waitForCamera(page);
    await openTab(page, 'Advanced');
    await page.locator('#publishLatencyProbe').check();
    await openTab(page, 'Connection');
    await startPublishing(page, { streamName: uniqueStream('stale') });
    await expectLive(page);
    await page.waitForTimeout(1500);
    await page.locator('#publish-toggle').click();
    await expect(page.locator('#video-live-indicator-live')).toBeHidden();

    // Somebody else's stream, from its own page, so the frames carry another context's clock.
    const other = await browser.newPage();
    await other.goto('/#/publish');
    const theirStream = uniqueStream('theirs');
    await waitForCamera(other);
    await openTab(other, 'Advanced');
    await other.locator('#publishLatencyProbe').check();
    await openTab(other, 'Connection');
    await startPublishing(other, { streamName: theirStream });
    await expectLive(other);

    // Same page, no reload: the hash route keeps the module state the flag lives in.
    await page.getByRole('link', { name: 'Play', exact: true }).click();
    await openTab(page, 'Advanced');
    await page.locator('#playLatencyProbe').check();
    await openTab(page, 'Connection');
    await startPlaying(page, { streamName: theirStream });
    await expectPlaying(page);
    await page.waitForTimeout(4000);

    const clockRow = page.locator('.wz-latency__table tr').filter({ hasText: 'Clock' }).first();
    // Two contexts on one machine do share a clock, so "one clock" is the honest reading here.
    // "one browser" is the claim only a stale stamping flag can produce.
    await expect(clockRow, 'a stale stamping flag claimed one browser across two of them')
      .not.toContainText('one browser');
    await expect(clockRow).toContainText('exact');

    await other.close();
    await context.close();
  });
});

test.describe('burned-in clock', () => {

  const hookConnections = (page) => page.addInitScript(() => {
    const Original = window.RTCPeerConnection;
    window.__pcs = [];
    window.RTCPeerConnection = class extends Original {
      constructor(...args) { super(...args); window.__pcs.push(this); }
    };
  });

  const videoSent = (page) => page.evaluate(async () => {
    let out = null;
    for (const pc of window.__pcs || []) {
      (await pc.getStats()).forEach((r) => {
        if (r.type === 'outbound-rtp' && r.kind === 'video') {
          out = { framesEncoded: r.framesEncoded ?? 0, bytesSent: r.bytesSent ?? 0 };
        }
      });
    }
    return out;
  });

  test('keeps publishing video, and goes on publishing it', async ({ page }) => {
    await hookConnections(page);
    await requireEngine(page, test);
    await page.goto('/#/publish');
    await waitForCamera(page);

    await openTab(page, 'Advanced');
    await page.locator('#publishBurnedClock').check();
    await openTab(page, 'Connection');
    await startPublishing(page, { streamName: uniqueStream('burned') });
    await expectLive(page);
    await page.waitForTimeout(3000);

    const first = await videoSent(page);
    expect(first, 'no outbound video at all').not.toBeNull();
    expect(first.framesEncoded, 'the clock stopped the video').toBeGreaterThan(20);

    // Still going a few seconds later, rather than having stalled after a handful of frames.
    await page.waitForTimeout(3000);
    const second = await videoSent(page);
    expect(second.framesEncoded).toBeGreaterThan(first.framesEncoded + 20);
  });

  test('draws it on the preview, so both ends can be photographed together', async ({ page }) => {
    await page.goto('/#/publish');
    await waitForCamera(page);
    await openTab(page, 'Advanced');
    await page.locator('#publishBurnedClock').check();

    // The preview carries the derived track, not the raw camera.
    await expect.poll(async () => page.evaluate(() => {
      const stream = document.getElementById('publisher-video')?.srcObject;
      const track = stream && stream.getVideoTracks()[0];
      return track ? track.readyState : null;
    }), { timeout: 10_000 }).toBe('live');
  });

  /*
   * Switching sides on the combined page unmounts the settings form while the publish carries
   * on, so the derived track cannot belong to that component's lifetime.
   */
  test('survives the settings form being unmounted', async ({ page }) => {
    await hookConnections(page);
    await requireEngine(page, test);
    await page.goto('/#/loopback');
    await waitForCamera(page);

    await openTab(page, 'Advanced');
    await page.locator('#publishBurnedClock').check();
    await openTab(page, 'Connection');
    await page.fill('#signalingURL', SIGNALING_URL);
    await page.fill('#applicationName', APPLICATION);
    await page.fill('#streamName', uniqueStream('burnedSwap'));
    await page.click('#publish-toggle');
    await expectLive(page);
    await page.waitForTimeout(2000);

    const before = await videoSent(page);
    await page.getByRole('button', { name: 'Player', exact: true }).click();
    await page.getByRole('button', { name: 'Publisher', exact: true }).click();
    await page.waitForTimeout(3000);

    const after = await videoSent(page);
    expect(after.framesEncoded, 'the side switch stopped the video')
      .toBeGreaterThan(before.framesEncoded + 20);
  });

  test('turning it off puts the camera back', async ({ page }) => {
    await page.goto('/#/publish');
    await waitForCamera(page);
    await openTab(page, 'Advanced');

    await page.locator('#publishBurnedClock').check();
    await page.waitForTimeout(500);
    await page.locator('#publishBurnedClock').uncheck();

    await expect.poll(async () => page.evaluate(() => {
      const stream = document.getElementById('publisher-video')?.srcObject;
      const track = stream && stream.getVideoTracks()[0];
      return track ? track.readyState : null;
    }), { timeout: 10_000 }).toBe('live');
  });
});

test.describe('how these numbers are measured', () => {

  const openPanel = async (page) => {
    await requireEngine(page, test);
    await page.goto('/#/loopback');
    await waitForCamera(page);

    const streamName = uniqueStream('help');
    await openTab(page, 'Advanced');
    await page.locator('#publishLatencyProbe').check();
    await openTab(page, 'Connection');
    await page.fill('#signalingURL', SIGNALING_URL);
    await page.fill('#applicationName', APPLICATION);
    await page.fill('#streamName', streamName);
    await page.click('#publish-toggle');
    await expectLive(page);

    await page.getByRole('button', { name: 'Player', exact: true }).click();
    await openTab(page, 'Advanced');
    await page.locator('#playLatencyProbe').check();
    await openTab(page, 'Connection');
    await page.fill('#playSignalingURL', SIGNALING_URL);
    await page.fill('#playApplicationName', APPLICATION);
    await page.fill('#playStreamName', streamName);
    await page.click('#play-toggle');
    await expectPlaying(page);
  };

  test('opens from the panel head and closes every way it should', async ({ page }) => {
    await openPanel(page);

    const dialog = page.locator('#measurement-help');
    await expect(dialog).toBeHidden();

    await page.locator('#measurement-help-open').click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('do not add up');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.locator('#measurement-help-open').click();
    await page.locator('#measurement-help-close').click();
    await expect(dialog).toBeHidden();
  });

  test('answers the three questions it exists for', async ({ page }) => {
    await openPanel(page);
    await page.locator('#measurement-help-open').click();
    const dialog = page.locator('#measurement-help');

    // Why a round trip is not the delay a frame experiences.
    await expect(dialog).toContainText('Round trip is not latency');
    // Why the player's estimate is smaller than the probe.
    await expect(dialog).toContainText('Latency covers the last hop only');
    // Why a packet loss figure of zero on one side is an answer, not a missing reading.
    await expect(dialog).toContainText('Packet loss is per direction');
  });

  // The sentence that has to survive on the panel itself, because it qualifies every figure.
  test('leaves the short caveat on the panel', async ({ page }) => {
    await openPanel(page);
    await expect(page.locator('.wz-latency__caveat'))
      .toContainText('larger than this');
  });

  test('is readable in both themes', async ({ page }) => {
    await openPanel(page);
    await page.locator('#measurement-help-open').click();

    const contrast = () => page.evaluate(() => {
      const luminance = (colour) => {
        const [r, g, b] = colour.match(/\d+/g).map(Number).map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const style = getComputedStyle(document.getElementById('measurement-help'));
      const text = luminance(style.color);
      const behind = luminance(style.backgroundColor);
      return (Math.max(text, behind) + 0.05) / (Math.min(text, behind) + 0.05);
    });

    expect(await contrast()).toBeGreaterThan(7);

    await page.evaluate(() => window.localStorage.setItem('wz.theme', 'light'));
    await page.reload();
    await openPanel(page);
    await page.locator('#measurement-help-open').click();
    expect(await contrast()).toBeGreaterThan(7);
  });
});

test.describe('the combined page clock', () => {

  test('measures a latency rather than refusing over the sample round trip', async ({ page }) => {
    await requireEngine(page, test);
    await page.goto('/#/loopback');
    await waitForCamera(page);

    const streamName = uniqueStream('loopClock');
    await openTab(page, 'Advanced');
    await page.locator('#publishLatencyProbe').check();
    await openTab(page, 'Connection');
    await page.fill('#signalingURL', SIGNALING_URL);
    await page.fill('#applicationName', APPLICATION);
    await page.fill('#streamName', streamName);
    await page.click('#publish-toggle');
    await expectLive(page);

    await page.getByRole('button', { name: 'Player', exact: true }).click();
    await openTab(page, 'Advanced');
    await page.locator('#playLatencyProbe').check();
    await openTab(page, 'Connection');
    await page.fill('#playSignalingURL', SIGNALING_URL);
    await page.fill('#playApplicationName', APPLICATION);
    await page.fill('#playStreamName', streamName);
    await page.click('#play-toggle');
    await expectPlaying(page);

    const rows = page.locator('.wz-latency__table tr');
    const row = (name) => rows.filter({ hasText: name }).first();

    await expect(row('Clock')).toContainText('exact', { timeout: 20_000 });
    await expect(row('Clock')).toContainText('one browser');

    // And the figures are figures, not dashes.
    for (const name of ['Publisher to player', 'Player decode and display', 'Total']) {
      await expect(row(name)).toContainText(/\d+\s*ms/, { timeout: 20_000 });
    }
  });
});

test.describe('a stream that cannot carry a stamp', () => {

  test('the publisher says so before publishing, while Auto is selected', async ({ page }) => {
    await page.goto('/#/publish');
    await openTab(page, 'Advanced');

    // Nothing to say until the probe is actually on.
    await expect(page.locator('#publishLatencyProbe-codec-risk')).toHaveCount(0);

    await page.locator('#publishLatencyProbe').check();
    await expect(page.locator('#publishLatencyProbe-codec-risk')).toContainText('Auto');

    // Choosing H.264 settles it, so the warning goes.
    await openTab(page, 'Source');
    await page.selectOption('#videoCodec', 'H264');
    await openTab(page, 'Advanced');
    await expect(page.locator('#publishLatencyProbe-codec-risk')).toHaveCount(0);
  });

  test('the player names the codec instead of listing what it might be', async ({ browser }) => {
    const publisher = await browser.newPage();
    await publisher.goto('/#/publish');
    await requireEngine(publisher, test);

    const streamName = uniqueStream('vp8');
    await waitForCamera(publisher);
    await openTab(publisher, 'Source');
    await publisher.selectOption('#videoCodec', 'VP8');
    await openTab(publisher, 'Connection');
    await startPublishing(publisher, { streamName });
    await expectLive(publisher);

    const viewer = await browser.newPage();
    await viewer.goto('/#/play');
    await openTab(viewer, 'Advanced');
    await viewer.locator('#playLatencyProbe').check();
    await openTab(viewer, 'Connection');
    await startPlaying(viewer, { streamName });
    await expectPlaying(viewer);
    await viewer.waitForTimeout(3000);

    const panel = viewer.locator('.wz-latency__caveat');
    await expect(panel).toContainText('VP8');
    await expect(panel).toContainText('H.264 SEI NAL');
    await expect(panel).toContainText('Set Video Codec to H.264');

    await publisher.close();
    await viewer.close();
  });
});

test.describe('the probe and the rest of the media', () => {

  const hookConnections = (page) => page.addInitScript(() => {
    const Original = window.RTCPeerConnection;
    window.__pcs = [];
    window.RTCPeerConnection = class extends Original {
      constructor(...args) { super(...args); window.__pcs.push(this); }
    };
  });

  const rtp = (page, type) => page.evaluate(async (wanted) => {
    const pc = (window.__pcs || []).filter((c) => c.connectionState === 'connected').pop();
    if (!pc) return null;
    let found = null;
    (await pc.getStats()).forEach((r) => {
      if (r.type === wanted && r.kind === 'audio') {
        found = { bytes: r.bytesSent ?? r.bytesReceived ?? 0,
                  packets: r.packetsSent ?? r.packetsReceived ?? 0 };
      }
    });
    return found;
  }, type);

  test('a publish with the probe on still sends audio', async ({ page }) => {
    await hookConnections(page);
    await requireEngine(page, test);
    await page.goto('/#/publish');
    await waitForCamera(page);
    await openTab(page, 'Advanced');
    await page.locator('#publishLatencyProbe').check();
    await openTab(page, 'Connection');
    await startPublishing(page, { streamName: uniqueStream('probeAudio') });
    await expectLive(page);
    await page.waitForTimeout(3000);

    const audio = await rtp(page, 'outbound-rtp');
    expect(audio, 'no outbound audio stream at all').not.toBeNull();
    expect(audio.packets, 'the probe stopped the audio going out').toBeGreaterThan(0);
    expect(audio.bytes).toBeGreaterThan(0);
  });

  test('a playback with the probe on still receives audio', async ({ browser }) => {
    const publisher = await browser.newPage();
    await publisher.goto('/#/publish');
    await requireEngine(publisher, test);
    const streamName = uniqueStream('probeAudioIn');
    await startPublishing(publisher, { streamName });
    await expectLive(publisher);

    const viewer = await browser.newPage();
    await hookConnections(viewer);
    await viewer.goto('/#/play');
    await openTab(viewer, 'Advanced');
    await viewer.locator('#playLatencyProbe').check();
    await openTab(viewer, 'Connection');
    await startPlaying(viewer, { streamName });
    await expectPlaying(viewer);
    await viewer.waitForTimeout(3000);

    const audio = await rtp(viewer, 'inbound-rtp');
    expect(audio, 'no inbound audio stream at all').not.toBeNull();
    expect(audio.packets, 'the probe stopped the audio arriving').toBeGreaterThan(0);

    await publisher.close();
    await viewer.close();
  });
});

test.describe('regressions from real use', () => {
  /*
   * A simulcast publish reported 216 missed frames on a session that lost nothing. The sender
   * keyed its per-rung sequence counter on rid and spatialIndex, and Chromium reports those as
   * undefined and 0 on every rung, so all three rungs shared one counter and the player,
   * receiving one rung, saw a sequence full of holes. synchronizationSource is the field that
   * actually differs per rung.
   */
  test('a simulcast publish reports no missed frames', async ({ browser }) => {
    const publisher = await browser.newPage();
    await publisher.goto('/#/publish');
    await requireEngine(publisher, test);

    const streamName = uniqueStream('rgsim');
    await waitForCamera(publisher);
    await openTab(publisher, 'Source');
    await publisher.locator('#publishUseSimulcast').check();
    await openTab(publisher, 'Advanced');
    await publisher.locator('#publishLatencyProbe').check();
    await openTab(publisher, 'Connection');
    await startPublishing(publisher, { streamName });
    await expectLive(publisher);

    const viewer = await browser.newPage();
    await viewer.goto('/#/play');
    await openTab(viewer, 'Advanced');
    await viewer.locator('#playLatencyProbe').check();
    await openTab(viewer, 'Connection');
    await startPlaying(viewer, { streamName });
    await expectPlaying(viewer);
    await viewer.waitForTimeout(10000);

    const missed = await viewer.evaluate(() => {
      const rows = [...document.querySelectorAll('.wz-latency__table tr')];
      const row = rows.find((r) => /frames missed/i.test(r.textContent));
      return row ? row.textContent.replace(/[^0-9]/g, '') : null;
    });
    expect(missed, 'frames missed on a healthy simulcast session').toBe('0');

    await publisher.close();
    await viewer.close();
  });

  /*
   * The panel showed the Engine leg and a dash for both the player leg and the total, because
   * attachProbeVideoElement was exported, documented and never called. The encoded half of the
   * join attaches to the receiver in startPlay; this is the half that attaches to the video
   * element, and nothing connected them.
   */
  test('the panel reports all three figures, not just the transport leg', async ({ browser }) => {
    const publisher = await browser.newPage();
    await publisher.goto('/#/publish');
    await requireEngine(publisher, test);

    const streamName = uniqueStream('rgjoin');
    await waitForCamera(publisher);
    await openTab(publisher, 'Advanced');
    await publisher.locator('#publishLatencyProbe').check();
    await openTab(publisher, 'Connection');
    await startPublishing(publisher, { streamName });
    await expectLive(publisher);

    const viewer = await browser.newPage();
    await viewer.goto('/#/play');
    await openTab(viewer, 'Advanced');
    await viewer.locator('#playLatencyProbe').check();
    await openTab(viewer, 'Connection');
    await startPlaying(viewer, { streamName });
    await expectPlaying(viewer);
    await viewer.waitForTimeout(8000);

    const figures = await viewer.evaluate(() => {
      const rows = [...document.querySelectorAll('.wz-latency__table tr')];
      const read = (pattern) => {
        const row = rows.find((r) => pattern.test(r.textContent));
        if (!row) return null;
        const match = row.textContent.match(/(\d+)\s*ms/);
        return match ? Number(match[1]) : null;
      };
      return {
        transport: read(/publisher to player/i),
        player: read(/decode and display/i),
        total: read(/^\s*Total/i) ?? read(/Total/i),
      };
    });

    expect(figures.transport, 'the Engine leg').toBeGreaterThan(0);
    expect(figures.player, 'the player decode and display leg').not.toBeNull();
    expect(figures.total, 'the total').not.toBeNull();
    expect(figures.total).toBeGreaterThanOrEqual(figures.transport);

    await publisher.close();
    await viewer.close();
  });
});
