import { expect, test } from '@playwright/test';
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
 * Data channels: chat in both directions, captions from publisher to player. Both need
 * Engine 4.12.0 or later, so a failure can be the example or the Engine.
 */

const enableChannels = async (page, { chat = false, captions = false, role }) => {
  const prefix = role === 'publish' ? 'publish' : 'play';
  if (chat) await page.locator(`#${prefix}ChatEnabled`).check();
  if (captions) await page.locator(`#${prefix}CaptionsEnabled`).check();
};

test.describe('data channel: chat', () => {
  test('a message typed by the publisher arrives at the player', async ({ browser }) => {
    const publisher = await browser.newPage();
    const viewer = await browser.newPage();

    await publisher.goto('/#/publish');
    await requireEngine(publisher, test);

    const streamName = uniqueStream('e2eChat');
    await enableChannels(publisher, { chat: true, role: 'publish' });
    await startPublishing(publisher, { streamName });
    await expectLive(publisher);

    await viewer.goto('/#/play');
    await enableChannels(viewer, { chat: true, role: 'play' });
    await startPlaying(viewer, { streamName });
    await expectPlaying(viewer);

    const message = `hello-${Date.now()}`;
    const input = publisher.locator('.data-channel-panel input.form-control');
    await expect(input).toBeEnabled({ timeout: 20_000 });
    await input.fill(message);
    await publisher.locator('.data-channel-panel button', { hasText: 'Send' }).click();

    await expect(viewer.locator('.data-channel-panel')).toContainText(message, { timeout: 20_000 });
    await expect(publisher.locator('.chat-message-sent')).toContainText(message);

    await publisher.close();
    await viewer.close();
  });

  test('the chat panel refuses input until the channel is open', async ({ page }) => {
    await page.goto('/#/publish');
    await enableChannels(page, { chat: true, role: 'publish' });
    await expect(page.locator('.data-channel-panel input.form-control')).toBeDisabled();
  });
});

test.describe('data channel: captions', () => {
  // The publisher cycles fixed placeholder lines on a 3 s timer, so wait for a known phrase.
  const FIRST_PHRASE = 'Welcome to the live stream.';

  test('the publisher mirrors the caption it is broadcasting', async ({ page }) => {
    await page.goto('/#/publish');
    await requireEngine(page, test);

    await enableChannels(page, { captions: true, role: 'publish' });
    await startPublishing(page, { streamName: uniqueStream('e2eCapTx') });
    await expectLive(page);

    const box = page.locator('#publish-caption-box');
    await expect(box).toBeVisible({ timeout: 20_000 });
    // Starts empty, then fills once the channel opens and the first tick fires.
    await expect(box).toContainText(FIRST_PHRASE, { timeout: 25_000 });
  });

  test('a caption sent by the publisher overlays the player video', async ({ browser }) => {
    const publisher = await browser.newPage();
    const viewer = await browser.newPage();

    await publisher.goto('/#/publish');
    await requireEngine(publisher, test);

    const streamName = uniqueStream('e2eCap');
    await enableChannels(publisher, { captions: true, role: 'publish' });
    await startPublishing(publisher, { streamName });
    await expectLive(publisher);

    await viewer.goto('/#/play');
    await enableChannels(viewer, { captions: true, role: 'play' });
    await startPlaying(viewer, { streamName });
    await expectPlaying(viewer);

    // The overlay only exists once a caption has arrived over the channel.
    await expect(viewer.locator('.caption-overlay')).toContainText(/\w+/, { timeout: 30_000 });

    await publisher.close();
    await viewer.close();
  });

  test('the caption box is hidden until captions are enabled', async ({ page }) => {
    await page.goto('/#/publish');
    await expect(page.locator('#publish-caption-box')).toHaveCount(0);
    await enableChannels(page, { captions: true, role: 'publish' });
    await expect(page.locator('#publish-caption-box')).toBeVisible();
  });
});