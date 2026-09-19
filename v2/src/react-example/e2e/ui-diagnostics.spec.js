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
  statValue,
  waitForCamera,
} from './ui-helpers.js';

/*
 * What the page reports while media is flowing: the statistics, the simulcast
 * layers, the server communication log, and how a session ends.
 */

test.describe('resizable panels', () => {

  const widthOf = (page, selector) =>
    page.locator(selector).evaluate((el) => Math.round(el.getBoundingClientRect().width));
  const heightOf = (page, selector) =>
    page.locator(selector).evaluate((el) => Math.round(el.getBoundingClientRect().height));

  test('the settings panel is dragged wider and stays that way', async ({ page }) => {
    await page.goto('/#/publish');
    const before = await widthOf(page, '.wz-inspector');

    const handle = page.locator('.wz-resizer--x');
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + 300, { steps: 10 });
    await page.mouse.up();

    const after = await widthOf(page, '.wz-inspector');
    expect(after).toBeGreaterThan(before + 100);

    // The choice survives a reload, which is the point of remembering it.
    await page.reload();
    expect(await widthOf(page, '.wz-inspector')).toBe(after);
  });

  test('the log panel is dragged taller', async ({ page }) => {
    await page.goto('/#/publish');
    await page.locator('.wz-debug__toggle').click();
    const before = await heightOf(page, '.wz-debug__body');

    const handle = page.locator('.wz-resizer--y');
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + 200, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + box.height / 2 - 90, { steps: 10 });
    await page.mouse.up();

    expect(await heightOf(page, '.wz-debug__body')).toBeGreaterThan(before + 70);
  });

  test('the panel cannot be dragged wide enough to squeeze the stage out', async ({ page }) => {
    await page.goto('/#/publish');
    const handle = page.locator('.wz-resizer--x');
    const box = await handle.boundingBox();

    await page.mouse.move(box.x + box.width / 2, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(10, box.y + 300, { steps: 10 });
    await page.mouse.up();

    const stage = await widthOf(page, '.wz-stage');
    expect(stage).toBeGreaterThan(400);
  });
});

/*
 * The Engine republishes a simulcast ingest as one stream per rendition, so the player's
 * rendition list is a list of stream names. This test is the check on that claim: if the
 * Engine ever stops naming them this way, it fails here rather than silently offering an
 * empty dropdown.
 */

/*
 * The Engine republishes a simulcast ingest as one stream per rendition, so the player's
 * rendition list is a list of stream names. This test is the check on that claim: if the
 * Engine ever stops naming them this way, it fails here rather than silently offering an
 * empty dropdown.
 */
test.describe('simulcast renditions', () => {

  test('the player lists the renditions the Engine is carrying', async ({ browser }) => {
    // Two pages, because leaving the publish route in the same tab tears the publish down
    // and there would be nothing left for the player to ask about.
    const publisher = await browser.newPage();
    const viewer = await browser.newPage();
    // Each newPage is its own context and outlives the test unless it is closed; several
    // of these in one run exhausted the fake capture device for the suites that follow, so
    // every one of them is closed at the end.

    await publisher.goto('/#/publish');
    await requireEngine(publisher, test);

    const streamName = uniqueStream('rend');
    await waitForCamera(publisher);
    await openTab(publisher, 'Source');
    await publisher.locator('#publishUseSimulcast').check();
    await openTab(publisher, 'Connection');
    await startPublishing(publisher, { streamName });
    await expectLive(publisher);

    await viewer.goto('/#/play');
    await viewer.fill('#playSignalingURL', SIGNALING_URL);
    await viewer.fill('#playApplicationName', APPLICATION);
    await viewer.fill('#playStreamName', streamName);

    const select = viewer.locator('#playRendition');

    // The Engine republishes the lower renditions a moment after the ingest is live, so
    // the lookup is retried rather than asked once and believed.
    await expect(async () => {
      await viewer.click('#play-find-renditions');
      await expect(select).toBeEnabled({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });

    const labels = await select.locator('option').allTextContents();
    expect(labels[0]).toMatch(/source/i);
    expect(labels.join(' ')).toMatch(/"m"/);
    expect(labels.join(' ')).toMatch(/"l"/);

    // Choosing a rendition is choosing the stream it plays.
    await select.selectOption(`${streamName}_m`);
    await expect(viewer.locator('#playStreamName')).toHaveValue(`${streamName}_m`);

    await publisher.close();
    await viewer.close();
  });
});

/*
 * The player showed its placeholder while frames decoded behind it. The element is not
 * displayed until it has a picture, and a display:none video never fires resize, so waiting
 * on resize alone left the two conditions waiting for each other.
 */

/*
 * The player showed its placeholder while frames decoded behind it. The element is not
 * displayed until it has a picture, and a display:none video never fires resize, so waiting
 * on resize alone left the two conditions waiting for each other.
 */
test.describe('player picture', () => {
  test('the video is shown once frames arrive, not the placeholder', async ({ browser }) => {
    const publisher = await browser.newPage();
    const viewer = await browser.newPage();
    // Each newPage is its own context and outlives the test unless it is closed; several
    // of these in one run exhausted the fake capture device for the suites that follow, so
    // every one of them is closed at the end.

    await publisher.goto('/#/publish');
    await requireEngine(publisher, test);

    const streamName = uniqueStream('pict');
    await startPublishing(publisher, { streamName });
    await expectLive(publisher);

    await viewer.goto('/#/play');
    await startPlaying(viewer, { streamName });
    await expectPlaying(viewer);

    await expect(viewer.locator('#player-video')).toBeVisible({ timeout: 20_000 });
    await expect(viewer.locator('.wz-video-placeholder')).toHaveCount(0);

    // And it is a real picture, sized from the stream rather than the element default.
    const size = await viewer.locator('#player-video')
      .evaluate((v) => [v.videoWidth, v.videoHeight]);
    expect(size[0]).toBeGreaterThan(0);
    expect(size[1]).toBeGreaterThan(0);

    await publisher.close();
    await viewer.close();
  });

  /*
   * Both sides live, which is the state the figures were cut off in: two sets of tiles share
   * the stage, so each tile is at its narrowest and the numbers are at their longest.
   *
   * Swept across widths deliberately. A first version of this test ran only at Playwright's
   * default 1280 and passed, while 1440 - where the grid fits another column and every tile
   * is narrower - was still ellipsising the bitrate. A layout assertion at one width is an
   * assertion about that width.
   */
  test('no stat value is cut off on the combined page, at any width', async ({ page }) => {
    await requireEngine(page, test);
    const streamName = uniqueStream('both');

    await page.goto('/#/loopback');
    await startPublishing(page, { streamName });
    await expectLive(page);

    await page.getByRole('button', { name: 'Player', exact: true }).click();
    await startPlaying(page, { streamName });
    await expectPlaying(page);

    // Let the counters grow to their full width before measuring.
    await page.waitForTimeout(5000);

    for (const width of [1280, 1366, 1440, 1600, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(400);

      const clipped = await page.$$eval('.wz-loopback .wz-stat__value', (els) =>
        els.filter((e) => e.scrollWidth > e.clientWidth + 1)
          .map((e) => `${e.closest('.wz-stat').querySelector('.wz-stat__label').textContent}="${e.textContent}"`));

      expect(clipped, `at ${width}px, ellipsised: ${clipped.join(', ')}`).toEqual([]);
    }
  });
});


/*
 * Rendition lookup over WHEP. The field holds an https origin there, and the same host
 * serves the signalling endpoint, so the socket URL is derived rather than demanded.
 */
test.describe('renditions over WHEP', () => {
  test('the renditions are found from a WHEP origin', async ({ browser }) => {
    const publisher = await browser.newPage();
    const viewer = await browser.newPage();
    // Each newPage is its own context and outlives the test unless it is closed; several
    // of these in one run exhausted the fake capture device for the suites that follow, so
    // every one of them is closed at the end.

    await publisher.goto('/#/publish');
    await requireEngine(publisher, test);

    const streamName = uniqueStream('whep');
    await waitForCamera(publisher);
    await openTab(publisher, 'Source');
    await publisher.locator('#publishUseSimulcast').check();
    await openTab(publisher, 'Connection');
    await startPublishing(publisher, { streamName, useWhip: true });
    await expectLive(publisher);

    await viewer.goto('/#/play');
    await viewer.locator('#playUseWhep').check();
    await viewer.fill('#playSignalingURL', httpOrigin());
    await viewer.fill('#playApplicationName', APPLICATION);
    await viewer.fill('#playStreamName', streamName);

    const find = viewer.locator('#play-find-renditions');
    await expect(find).toBeEnabled();

    const select = viewer.locator('#playRendition');
    await expect(async () => {
      await find.click();
      await expect(select).toBeEnabled({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });

    const labels = (await select.locator('option').allTextContents()).join(' ');
    expect(labels).toMatch(/source/i);
    expect(labels).toMatch(/"m"/);

    // And the rendition it picks actually plays back over WHEP.
    await select.selectOption(`${streamName}_m`);
    await viewer.click('#play-toggle');
    await expectPlaying(viewer);
    await viewer.waitForFunction(
      () => { const v = document.querySelector('#player-video'); return v && v.videoWidth > 0; },
      null, { timeout: 20_000 });

    await publisher.close();
    await viewer.close();
  });
});

/*
 * The rendition badge and the caption overlay are positioned against their container, so
 * that container has to be the picture and not the space around it. On the combined page one
 * element was doing both jobs - filling the pane and anchoring the overlays - and the badge
 * ended up floating above the video.
 */

/*
 * Simulcast visibility. A simulcast publish sends several encodings and the browser reports
 * one outbound-rtp per encoding; the panel used to show exactly one of them, so a publish
 * where two layers were sitting at zero looked identical to one where all three were fine.
 */
test.describe('simulcast layers', () => {
  test('every rung is listed, with what it is doing', async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/#/publish');
    await requireEngine(page, test);

    const streamName = uniqueStream('rungs');
    await waitForCamera(page);
    await openTab(page, 'Source');
    await page.locator('#publishUseSimulcast').check();
    await openTab(page, 'Connection');
    await startPublishing(page, { streamName });
    await expectLive(page);

    const table = page.locator('#simulcast-layers');
    await expect(table).toBeVisible({ timeout: 20_000 });

    // One row per configured rendition, named by its rid.
    for (const rid of ['h', 'm', 'l']) {
      await expect(table.getByRole('rowheader', { name: rid, exact: true })).toBeVisible();
    }

    // Each row says either that it is sending or why it is not; neither may be blank.
    const states = await table.locator('tbody tr td:last-child').allTextContents();
    expect(states).toHaveLength(3);
    for (const state of states) {
      expect(state.trim()).toMatch(/^(sending|idle)/);
    }

    await expect(table.locator('.wz-layers__summary')).toContainText(/of 3 sending/);
    await page.close();
  });

  test('an ordinary publish shows no layer table at all', async ({ page }) => {
    await requireEngine(page, test);
    await page.goto('/#/publish');
    await startPublishing(page, { streamName: uniqueStream('plain') });
    await expectLive(page);
    await page.waitForTimeout(3000);
    await expect(page.locator('#simulcast-layers')).toHaveCount(0);
  });
});


/*
 * The log had nothing to say once a session was up: when latency moved, the tiles changed
 * and the log sat still. These check that a change produces a line naming both values.
 */
test.describe('server communication panel', () => {
  test('newest first by default, and the order can be flipped', async ({ page }) => {
    await requireEngine(page, test);
    await page.goto('/#/publish');
    await startPublishing(page, { streamName: uniqueStream('order') });
    await expectLive(page);

    await page.getByRole('button', { name: /Server communication/ }).click();
    const times = () => page.locator('.wz-debug__time').allTextContents();

    const newest = await times();
    expect(newest.length).toBeGreaterThan(1);
    expect([...newest].sort().reverse()).toEqual(newest);

    await page.locator('#debug-order').click();
    const oldest = await times();
    expect([...oldest].sort()).toEqual(oldest);
  });

  test('an empty channel says why it is empty rather than nothing at all', async ({ page }) => {
    await requireEngine(page, test);
    await page.goto('/#/publish');
    await startPublishing(page, { streamName: uniqueStream('empty'), useWhip: true });
    await expectLive(page);

    await page.getByRole('button', { name: /Server communication/ }).click();
    await page.getByRole('button', { name: 'Signaling', exact: true }).click();

    // A WHIP session opens no socket, so this tab is legitimately empty and says so.
    await expect(page.locator('.wz-debug__empty')).toContainText(/no signalling socket/i);
    await expect(page.locator('.wz-debug__empty')).toContainText(/WHIP\/WHEP tab/i);
  });
});


test.describe('stat groups', () => {
  test('media and network are separate groups, and audio is reported', async ({ page }) => {
    await requireEngine(page, test);
    await page.goto('/#/publish');
    await startPublishing(page, { streamName: uniqueStream('groups') });
    await expectLive(page);
    await page.waitForTimeout(3000);

    const network = page.getByRole('group', { name: 'Network' });
    const media = page.getByRole('group', { name: 'Media' });

    await expect(network).toContainText('Round trip');
    await expect(network).toContainText('Packet loss');
    await expect(media).toContainText('Video codec');
    await expect(media).toContainText('Audio codec');
    await expect(media).toContainText('Frames encoded');

    // The two questions live apart: no codec in the network group, no round trip in media.
    await expect(network).not.toContainText('codec');
    await expect(media).not.toContainText('Round trip');
  });
});


test.describe('rendition hint', () => {

  test('reads the same under either transport', async ({ page }) => {
    await page.goto('/#/play');
    const hint = page.locator('#playRendition-hint');

    const wss = await hint.textContent();
    await page.locator('#playUseWhep').check();
    expect(await hint.textContent()).toBe(wss);
  });

  test('asks for a server before offering a lookup, and the button waits too', async ({ page }) => {
    await page.goto('/#/play');
    const hint = page.locator('#playRendition-hint');

    await expect(hint).toContainText('Enter the server URL first');
    await expect(page.locator('#play-find-renditions')).toBeDisabled();

    await page.fill('#playSignalingURL', 'wss://engine.example/webrtc-session.json');
    await page.fill('#playStreamName', 'someStream');
    await expect(hint).toContainText('which renditions of this stream are live');
    await expect(page.locator('#play-find-renditions')).toBeEnabled();
  });
});

/*
 * The suggestions used to be a native <datalist>, whose popup the browser draws at its own
 * size: rows around three times the height of a control in this panel. This is the same
 * offer, drawn in the panel's own terms, and it is still a text field underneath.
 */

/*
 * RTCPeerConnection.close() fires no connectionstatechange, so a session the user ended by
 * hand left the panel reporting the last state it had seen. It said connected against a
 * connection that was shut, which is the one thing a state tile must never do.
 */
test.describe('state after stopping', () => {

  test('the publisher stops saying connected when publishing stops', async ({ page }) => {
    await requireEngine(page, test);
    await page.goto('/#/publish');
    await startPublishing(page, { streamName: uniqueStream('stopState') });
    await expectLive(page);
    await expect(statValue(page, 'State')).toHaveText('connected');

    await page.locator('#publish-toggle').click();
    await expect(page.locator('#video-live-indicator-live')).toBeHidden();
    // Promptly. A tile that catches up after several seconds is still telling the wrong story.
    await expect(statValue(page, 'State')).toHaveText('idle', { timeout: 2000 });
  });

  /*
   * The shape actually reported: the media tiles blank while State still read connected.
   * A connection closed outside the stop button, which is what the error path does when it
   * abandons an attempt, dispatches no connectionstatechange at all. Closing it from here
   * reproduces that exactly, where pressing Unpublish does not: the ordinary stop happens to
   * produce a reported transition, so it cleared on its own and proved nothing.
   */
  test('a connection closed without an event does not stay connected', async ({ page }) => {
    await requireEngine(page, test);

    // Recorded from out here rather than by adding a handle to the app for the test's sake.
    await page.addInitScript(() => {
      const Original = window.RTCPeerConnection;
      window.__pcs = [];
      window.RTCPeerConnection = class extends Original {
        constructor(...args) {
          super(...args);
          window.__pcs.push(this);
        }
      };
    });

    await page.goto('/#/publish');
    await startPublishing(page, { streamName: uniqueStream('silentClose') });
    await expectLive(page);
    await expect(statValue(page, 'State')).toHaveText('connected');

    const fired = await page.evaluate(() => new Promise((resolve) => {
      const pc = window.__pcs.filter((c) => c.connectionState === 'connected').pop();
      let sawEvent = false;
      pc.addEventListener('connectionstatechange', () => { sawEvent = true; });
      pc.close();
      setTimeout(() => resolve(sawEvent), 300);
    }));
    expect(fired, 'close() is expected to be silent; if it fired, this no longer tests anything')
      .toBe(false);

    await expect(statValue(page, 'State')).not.toHaveText('connected', { timeout: 3000 });
  });

  test('the player stops saying connected when playback stops', async ({ page }) => {
    await requireEngine(page, test);
    const streamName = uniqueStream('stopStatePlay');

    const publisher = await page.context().newPage();
    await publisher.goto('/#/publish');
    await startPublishing(publisher, { streamName });
    await expectLive(publisher);

    await page.goto('/#/play');
    await startPlaying(page, { streamName });
    await expectPlaying(page);
    await expect(statValue(page, 'State')).toHaveText('connected');

    await page.locator('#play-toggle').click();
    await expect(page.locator('#video-play-indicator')).toBeHidden();
    await expect(statValue(page, 'State')).toHaveText('idle', { timeout: 2000 });

    await publisher.close();
  });
});

/*
 * What the bundle no longer carries. The icon font and the two routes that are now fetched
 * on demand are invisible when they work and obvious when they do not, and nothing else in
 * this suite would have noticed either going missing.
 */

/*
 * Stopping a publish put a red "Websocket Error: undefined" across the page. Closing the socket
 * is not always quiet: the Engine can have a frame in flight, and the browser then fails the
 * connection with "Data frame received after close" and dispatches an error event. The event
 * carries no detail at all, which is where the word undefined came from.
 */
test.describe('stopping cleanly', () => {

  test('a publish stopped over wss raises nothing', async ({ page }) => {
    await requireEngine(page, test);
    await page.goto('/#/publish');
    await startPublishing(page, { streamName: uniqueStream('quietStop') });
    await expectLive(page);

    await page.locator('#publish-toggle').click();
    await expect(page.locator('#video-live-indicator-live')).toBeHidden();

    // Long enough for the close to complete and any trailing frame to arrive.
    await page.waitForTimeout(1500);
    await expect(page.locator('#error-panel')).toHaveCount(0);

    // And the log calls it what it is rather than colouring it as a failure.
    await page.getByRole('button', { name: /Server communication/ }).click();
    await expect(page.locator('.wz-debug__row--error')).toHaveCount(0);
    await expect(page.locator('.wz-debug__row', { hasText: /socket error/ }))
      .toContainText('while closing');
  });

  test('a playback stopped over wss raises nothing', async ({ page }) => {
    await requireEngine(page, test);
    const streamName = uniqueStream('quietStopPlay');

    const publisher = await page.context().newPage();
    await publisher.goto('/#/publish');
    await startPublishing(publisher, { streamName });
    await expectLive(publisher);

    await page.goto('/#/play');
    await startPlaying(page, { streamName });
    await expectPlaying(page);

    await page.locator('#play-toggle').click();
    await page.waitForTimeout(1500);
    await expect(page.locator('#error-panel')).toHaveCount(0);

    await publisher.close();
  });

  // The message the banner does show when something is genuinely wrong has to say something.
  test('a signalling failure says what to check, never undefined', async ({ page }) => {
    await page.goto('/#/publish');
    await page.fill('#signalingURL', 'wss://127.0.0.1:1/webrtc-session.json');
    await page.fill('#applicationName', 'webrtc');
    await page.fill('#streamName', 'nowhere');
    await page.click('#publish-toggle');

    const banner = page.locator('#error-panel');
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner).not.toContainText('undefined');
    await expect(banner).toContainText(/certificate|address|running/);
  });
});

/*
 * The mute button used to render from a useState(true) inside the settings form, which is a
 * second copy of something MediaStreamTrack.enabled already knows. Anything that remounted the
 * form reset the copy and not the track, so the button showed a live microphone over a muted
 * one and the publisher sent no audio with nothing on screen to say why.
 */

test.describe('panel polish', () => {
  /*
   * The legacy note's rule and the server communication bar's rule read as one line across the
   * shell, so they have to land on the same pixel. The note was 43px against the bar's 39 and
   * sat three out.
   */
  test('the legacy note rule lines up with the server communication rule', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const route of ['#/publish', '#/play']) {
      await page.goto(`/${route}`);
      const tops = await page.evaluate(() => ({
        foot: Math.round(document.querySelector('.wz-inspector__foot').getBoundingClientRect().top),
        debug: Math.round(document.querySelector('.wz-debug').getBoundingClientRect().top),
      }));
      expect(tops.foot, `${route}: foot ${tops.foot} vs debug ${tops.debug}`).toBe(tops.debug);
    }
  });

  test('the player Advanced tab leads with Diagnostics, and no section is double ruled',
    async ({ page }) => {
      await page.goto('/#/play');
      await openTab(page, 'Advanced');

      const shape = await page.evaluate(() => {
        const adv = [...document.querySelectorAll('.wz-inspector__body form > div')]
          .find((d) => d.querySelector('#playSecret'));
        const seq = [];
        adv.childNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          const c = n.className.toString();
          seq.push(c.includes('wz-group') ? `GROUP ${n.textContent.trim()}` : (c.includes('wz-rule') ? 'rule' : 'block'));
        });
        return seq;
      });

      expect(shape[0]).toBe('GROUP Diagnostics');
      expect(shape.filter((v) => v.startsWith('GROUP'))).toEqual(
        ['GROUP Diagnostics', 'GROUP Secure Token', 'GROUP ICE Servers']);
      expect(shape.some((v, i) => v === 'rule' && shape[i + 1] === 'rule'),
        'two separators in a row').toBe(false);
    });

  /*
   * The hover wash was a 5 percent WHITE overlay in both themes, so on a white panel it was
   * invisible: in light mode there was nothing to see at all. The defect was the wash's own
   * colour, so that is what this checks. A wash has to pull away from the surface under it,
   * which means lifting on a dark panel and darkening on a light one.
   */
  test('the hover wash pulls away from the surface in both themes', async ({ page }) => {
    await page.goto('/#/publish');

    const washes = await page.evaluate(() => {
      const read = (theme) => {
        document.documentElement.setAttribute('data-bs-theme', theme);
        const style = getComputedStyle(document.documentElement);
        return {
          hover: style.getPropertyValue('--wz-hover').trim(),
          surface: style.getPropertyValue('--wz-surface').trim(),
        };
      };
      return { dark: read('dark'), light: read('light') };
    });

    // Both themes define one at all, which is the first thing that could regress.
    expect(washes.dark.hover).not.toBe('');
    expect(washes.light.hover).not.toBe('');

    // And they are not the same wash, which is the bug: one white overlay used for both.
    expect(washes.light.hover).not.toBe(washes.dark.hover);

    /*
     * Dark lifts: the wash is near white. Light darkens: the wash is not. The channels are read
     * back through the browser rather than parsed, because the production build minifies
     * rgba(255, 255, 255, 0.07) to #ffffff12 and a digit regex then reads 12 as the red channel.
     */
    const channels = await page.evaluate((colours) => {
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      const normalise = (colour) => {
        probe.style.color = '';
        probe.style.color = colour;
        const parts = getComputedStyle(probe).color.match(/[\d.]+/g) || [];
        return parts.slice(0, 3).map(Number);
      };
      const out = { dark: normalise(colours.dark), light: normalise(colours.light) };
      probe.remove();
      return out;
    }, { dark: washes.dark.hover, light: washes.light.hover });

    expect(Math.min(...channels.dark), 'the dark wash should be light').toBeGreaterThan(200);
    expect(Math.max(...channels.light), 'the light wash should be dark').toBeLessThan(120);
  });
});
