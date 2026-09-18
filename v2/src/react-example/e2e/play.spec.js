import { expect, test } from '@playwright/test';
import {
  listStreams,
  requireEngine,
} from './helpers.js';
import {
  expectPlaying,
  startPlaying,
  statValue,
} from './ui-helpers.js';

/* Playback over the WebSocket signaling path. Requires a reachable Engine with a stream. */

test.describe('play over wss', () => {
  test('plays an existing stream and decodes frames', async ({ page }) => {
    await page.goto('/#/play');
    const streams = await requireEngine(page, test);
    test.skip(!streams.length, 'No stream is live on the Engine to play.');

    await startPlaying(page, { streamName: streams[0] });
    await expectPlaying(page);
    await expect(statValue(page, 'State')).toHaveText('connected', { timeout: 20_000 });

    await expect
      .poll(async () => Number((await statValue(page, 'Frames decoded').textContent()) || 0), { timeout: 25_000 })
      .toBeGreaterThan(0);
  });

  test('reports a measured round trip and an estimated latency, labelled as an estimate', async ({ page }) => {
    await page.goto('/#/play');
    const streams = await requireEngine(page, test);
    test.skip(!streams.length, 'No stream is live on the Engine to play.');

    await startPlaying(page, { streamName: streams[0] });
    await expectPlaying(page);

    await expect(statValue(page, 'Round trip')).toContainText('ms', { timeout: 20_000 });
    const latencyTile = page.locator('.wz-stat', {
      has: page.locator('.wz-stat__label', { hasText: /^Latency$/ }),
    });
    // The wording matters: this figure must never read as measured glass-to-glass.
    await expect(latencyTile.locator('.wz-stat__sub')).toContainText('est.');
  });

  test('draws a running trend line once samples accumulate', async ({ page }) => {
    await page.goto('/#/play');
    const streams = await requireEngine(page, test);
    test.skip(!streams.length, 'No stream is live on the Engine to play.');

    await startPlaying(page, { streamName: streams[0] });
    await expectPlaying(page);
    // Needs at least two samples at one per second before a line exists.
    //
    // Not toBeVisible(): on localhost the round trip is a constant 1 ms, so the path is
    // perfectly flat and its bounding box has zero height, which Playwright reports as
    // not visible even though it renders. Assert the geometry instead.
    const line = page.locator('.wz-spark__line').first();
    await expect(line).toHaveAttribute('d', /^M[\d.]+,[\d.]+( L[\d.]+,[\d.]+){2,}/, { timeout: 25_000 });
    await expect(page.locator('.wz-spark__now').first()).toHaveCount(1);
  });

  test('the debug panel records the signalling handshake in order', async ({ page }) => {
    await page.goto('/#/play');
    const streams = await requireEngine(page, test);
    test.skip(!streams.length, 'No stream is live on the Engine to play.');

    await startPlaying(page, { streamName: streams[0] });
    await expectPlaying(page);
    await page.getByRole('button', { name: /Server communication/ }).click();

    await expect(page.getByText('play socket open')).toBeVisible();
    await expect(page.getByText('play \u2192 OFFER')).toBeVisible();
    await expect(page.getByText('play connection connected')).toBeVisible({ timeout: 20_000 });
  });
});