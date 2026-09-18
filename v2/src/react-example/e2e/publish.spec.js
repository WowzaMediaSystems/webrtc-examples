import { expect, test } from '@playwright/test';
import {
  APPLICATION,
  listStreams,
  requireEngine,
  uniqueStream,
} from './helpers.js';
import {
  expectLive,
  startPublishing,
  statValue,
} from './ui-helpers.js';

/* Publishing over the WebSocket signaling path. Requires a reachable Engine. */

test.describe('publish over wss', () => {
  test('publishes, reports LIVE in the header, and appears on the Engine', async ({ page }) => {
    await page.goto('/#/publish');
    await requireEngine(page, test);

    const streamName = uniqueStream('e2ePub');
    await startPublishing(page, { streamName });

    await expectLive(page);
    await expect(statValue(page, 'State')).toHaveText('connected', { timeout: 20_000 });

    // The Engine itself must agree that the stream exists.
    await expect
      .poll(async () => (await listStreams(page)) || [], { timeout: 20_000 })
      .toContain(streamName);
  });

  test('outbound bitrate and encoded frames both climb', async ({ page }) => {
    await page.goto('/#/publish');
    await requireEngine(page, test);
    await startPublishing(page, { streamName: uniqueStream('e2eRate') });
    await expectLive(page);

    await expect(statValue(page, 'Video bitrate')).not.toHaveText('\u2014', { timeout: 20_000 });
    await expect
      .poll(async () => Number((await statValue(page, 'Frames encoded').textContent()) || 0), { timeout: 20_000 })
      .toBeGreaterThan(0);
  });

  test('a publish carries video, not audio alone', async ({ page }) => {
    // Guards the failure mode that took most of 2026-09-17 to pin down: a publish that
    // reaches "connected" and shows LIVE while only audio reaches the server. It presents
    // as a working local preview and an empty Video tile.
    await page.goto('/#/publish');
    await requireEngine(page, test);
    await startPublishing(page, { streamName: uniqueStream('e2eVideo') });
    await expectLive(page);

    await expect(statValue(page, 'Video')).not.toHaveText('none', { timeout: 20_000 });
    await expect(statValue(page, 'Video codec')).not.toHaveText('\u2014', { timeout: 20_000 });
    await expect(page.locator('#error-messages')).toHaveCount(0);
  });

  test('an explicit H.264 selection is what actually gets negotiated', async ({ page }) => {
    await page.goto('/#/publish');
    await requireEngine(page, test);
    await startPublishing(page, { streamName: uniqueStream('e2eH264'), codec: 'H264' });
    await expectLive(page);
    await expect(statValue(page, 'Video codec')).toHaveText('H264', { timeout: 20_000 });
  });
  test('the publisher hides receiver-side latency, which it cannot have', async ({ page }) => {
    await page.goto('/#/publish');
    await requireEngine(page, test);
    await startPublishing(page, { streamName: uniqueStream('e2eLat') });
    await expectLive(page);

    await expect(page.locator('.wz-stat__label', { hasText: /^Jitter buffer$/ })).toHaveCount(0);
    await expect(page.locator('.wz-stat__label', { hasText: /^Latency$/ })).toHaveCount(0);
    await expect(page.locator('.wz-stat__label', { hasText: /^Round trip$/ })).toHaveCount(1);
  });

  test('the requested codec preference reaches the offer', async ({ page }) => {
    await page.goto('/#/publish');
    await requireEngine(page, test);
    await startPublishing(page, { streamName: uniqueStream('e2eCodec'), codec: 'H264' });
    await expectLive(page);

    await page.getByRole('button', { name: /Server communication/ }).click();
    await expect(page.getByText('publish codec preference applied: H264')).toBeVisible({ timeout: 15_000 });
  });
});