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
  openTab,
  startPublishing,
  waitForCamera,
} from './ui-helpers.js';

/*
 * The frame stamp (the H.264 SEI NAL in src/utils/frameStamp.js) against a live Engine.
 *
 * The transforms are injected from an init script, not through the Latency Probe toggle.
 * encodedInsertableStreams can only be set when the RTCPeerConnection is constructed, so the
 * constructor is wrapped and transforms attach at addTrack/addTransceiver time, counting every
 * frame from the first. Tests that drive the toggle skip with a named reason when it is absent.
 *
 * Clocks: publisher and player share one machine (design modes A and B), so Date.now() agrees
 * and no offset estimate is involved. Mode C (two machines) is not automatable here.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/*
 * The real codec, read at test time so these tests follow any wire-format change.
 * frameStamp.js has no imports, so stripping `export ` makes it a classic script.
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
 * `stamp` false is the baseline: transforms attached and counting, nothing written.
 * `dropEvery` discards every Nth frame after advancing its sequence number, because loopback
 * against this Engine loses nothing.
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

// Each context gets its own instrument: the publisher's counts what it stamped, the player's
// what it read.
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
 * Retries Play until playback starts. The Engine lists <name>_m and <name>_l several seconds
 * before it serves them, and even a plain wss play intermittently fails on the first click.
 * The toggle is reset between attempts because a half-started session leaves it at "Stop".
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

// A pixel stamp was 8.7% readable on a rescaled simulcast rung. This checks whether the SEI
// survives the rungs.
test.describe('the open question: does the marker survive the simulcast rungs', () => {
  /*
   * Only rungs the browser actually encodes are measured. Against the fake 640x480 camera,
   * Chromium sends 0 frames for rung l while the Engine still lists <name>_l, so rungs with
   * framesSent 0 are skipped with a named reason.
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

  // One rung at a time, each viewer closed before the next: two viewers on two rungs of one
  // simulcast ingest at once is unreliable on this Engine even with nothing injected.
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

    // More than one SSRC key proves simulcast ran, not a fallback to a single encoding.
    expect(Object.keys(measured.publisher.sentByRung).length,
      `simulcast was not active: ${JSON.stringify(measured.publisher.sentByRung)}`)
      .toBeGreaterThanOrEqual(2);

    // Informational. If rid ever appears, the probe could key on it, which survives a
    // renegotiation where an SSRC may not.
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
      expect(outcome.read.markerRate, `the marker did not survive rung _${rung}`).toBe(1);
      expect(outcome.inbound.frameWidth,
        `rung _${rung} was not rescaled, so it does not test what killed the pixel stamp`)
        .toBeLessThan(640);
    }
  });
});

/* ============================================================ does no harm ================ */

test.describe('injection does no harm', () => {
  /*
   * Two baseline and two stamped sessions. framesDropped, pliCount, packetsLost and decoded
   * resolution move when a decoder cannot parse a frame, so they must match. freezeCount moves
   * on its own (compositor scheduling, startup), so it is bounded by the baseline's spread.
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

    // Allowance: baseline max plus its spread plus one. Two baselines give only a floor on the
    // real noise, hence the plus one.
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
   * Two stalls. Loss: frames go missing and the sequence shows it (manufactured, since loopback
   * loses nothing). Silence: the publisher's thread blocks and nothing is sent, so the signal
   * is the age of the last frame.
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
      // Roughly the injected loss rate, not merely non-zero. Wide bounds, because the two
      // windows do not start and end on the same frame.
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
      // A synchronous busy loop stalls the publisher's main thread, sender transform included.
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
       * The newest frame's age is the signal, not the biggest arrival gap: nothing arrives
       * during the block, so the silence sits at the end of the record with no pair of
       * arrivals around it. This is what the design's STALE_MS rule reads.
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

      // Either the newest frame is older than STALE_MS (1,000 ms) or the publisher recovered
      // and left a gap that size. Neither means the block never reached the media path.
      expect(Math.max(newestAgeAtRead, biggestSilence),
        `neither a stale newest frame nor a gap: age ${newestAgeAtRead} ms, gap ${biggestSilence} ms`)
        .toBeGreaterThan(1_000);

      // At about 20 fps a 4 s block costs roughly 80 frames; near that many arriving means the
      // thread was not actually held.
      expect(framesDuringBlock,
        `${framesDuringBlock} stamped frames arrived during a ${blockMs} ms block, so the `
        + 'publisher was not actually stalled').toBeLessThan(20);

      // The figures now rest on pre-block frames; the last real median must still exist so the
      // probe can report it as stale rather than as a fresh reading.
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
  // Mode A: publisher and player in one JS context (the split view). Mode B: two contexts on
  // one machine. Both read the same OS clock, so the transport figures should agree.
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

    // A tolerance on session-to-session jitter buffer variation; clock error is zero in both
    // arms. A systematic clock difference between the modes would exceed it.
    expect(difference).toBeLessThan(40);
  });
});

// The time drawn onto every frame before encode, replacing the published video track.
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
