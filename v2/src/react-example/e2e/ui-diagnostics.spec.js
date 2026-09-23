import { test, expect } from '@playwright/test';

import {
  requireEngine,
  uniqueStream,
} from './helpers.js';
import {
  expectLive,
  expectPlaying,
  startPlaying,
  startPublishing,
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

