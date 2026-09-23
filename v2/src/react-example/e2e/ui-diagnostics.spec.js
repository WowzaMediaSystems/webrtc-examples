import { test, expect } from '@playwright/test';

import {
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

    // The width survives a reload.
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
 * A display:none video never fires resize, so the element must not wait on resize to be
 * shown or the two conditions deadlock and the placeholder stays up.
 */
test.describe('player picture', () => {
  test('the video is shown once frames arrive, not the placeholder', async ({ browser }) => {
    const publisher = await browser.newPage();
    const viewer = await browser.newPage();

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

    // Sized from the stream, not the element default.
    const size = await viewer.locator('#player-video')
      .evaluate((v) => [v.videoWidth, v.videoHeight]);
    expect(size[0]).toBeGreaterThan(0);
    expect(size[1]).toBeGreaterThan(0);

    await publisher.close();
    await viewer.close();
  });
});


/*
 * The browser reports one outbound-rtp per simulcast encoding; every one must be shown, or a
 * publish with two idle layers looks the same as a healthy one.
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

    // A WHIP session opens no socket, so this tab is legitimately empty.
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

    await expect(network).not.toContainText('codec');
    await expect(media).not.toContainText('Round trip');
  });
});


/*
 * RTCPeerConnection.close() fires no connectionstatechange, so the State tile must not rely
 * on that event to leave "connected".
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
    // Promptly: a tile that catches up seconds later is still wrong.
    await expect(statValue(page, 'State')).toHaveText('idle', { timeout: 2000 });
  });

  /*
   * Closes the connection directly, as the error path does. Pressing Unpublish does not
   * reproduce this: the ordinary stop happens to produce a reported transition.
   */
  test('a connection closed without an event does not stay connected', async ({ page }) => {
    await requireEngine(page, test);

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
 * Closing the socket is not always quiet: with a frame in flight the browser fails it with
 * "Data frame received after close" and fires an error event carrying no detail.
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

    // Logged as a close-time event, not as a failure.
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

