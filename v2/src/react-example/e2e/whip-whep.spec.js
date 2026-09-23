import { expect, test } from '@playwright/test';
import {
  listStreams,
  requireEngine,
  uniqueStream,
} from './helpers.js';
import {
  expectLive,
  expectPlaying,
  startPlaying,
  startPublishing,
  statValue,
} from './ui-helpers.js';

/*
 * The HTTP signaling path: WHIP for ingest, WHEP for egress. A separate code path from the
 * WebSocket one, with its own setup and failure modes.
 */

test.describe('WHIP ingest', () => {
  test('publishes over WHIP and the stream appears on the Engine', async ({ page }) => {
    await page.goto('/#/publish');
    await requireEngine(page, test);

    const streamName = uniqueStream('e2eWhip');
    await startPublishing(page, { streamName, useWhip: true });

    await expectLive(page);
    await expect(statValue(page, 'State')).toHaveText('connected', { timeout: 25_000 });
    await expect
      .poll(async () => (await listStreams(page)) || [], { timeout: 25_000 })
      .toContain(streamName);
  });

  test('records the WHIP HTTP exchange in the debug panel, not the socket', async ({ page }) => {
    await page.goto('/#/publish');
    await requireEngine(page, test);

    await startPublishing(page, { streamName: uniqueStream('e2eWhipLog'), useWhip: true });
    await expectLive(page);

    await page.getByRole('button', { name: /Server communication/ }).click();
    // No WebSocket is opened on this path.
    await expect(page.getByText('publish socket open')).toHaveCount(0);

    // The WHIP/WHEP channel specifically: peer-connection rows alone would pass a row count.
    await page.getByRole('button', { name: 'WHIP/WHEP', exact: true }).click();
    const rows = page.locator('.wz-debug__row');
    await expect(rows).not.toHaveCount(0);
    await expect(rows.first()).toContainText(/whip/i);
    await expect(page.locator('.wz-debug__label').filter({ hasText: /→ 20\d/ }).first())
      .toBeVisible();
  });
});

test.describe('WHEP egress', () => {
  test('plays over WHEP and decodes frames', async ({ page }) => {
    await page.goto('/#/play');
    const streams = await requireEngine(page, test);
    test.skip(!streams.length, 'No stream is live on the Engine to play.');

    await startPlaying(page, { streamName: streams[0], useWhep: true });
    await expectPlaying(page);
    await expect(statValue(page, 'State')).toHaveText('connected', { timeout: 25_000 });
    await expect
      .poll(async () => Number((await statValue(page, 'Frames decoded').textContent()) || 0), { timeout: 25_000 })
      .toBeGreaterThan(0);
  });
});

test.describe('WHIP to WHEP round trip', () => {
  // Exercises both HTTP legs against each other: WHIP in, WHEP out, one stream.
  test('a stream published over WHIP plays back over WHEP', async ({ browser }) => {
    const publisher = await browser.newPage();
    const viewer = await browser.newPage();

    await publisher.goto('/#/publish');
    await requireEngine(publisher, test);

    const streamName = uniqueStream('e2eRound');
    await startPublishing(publisher, { streamName, useWhip: true });
    await expectLive(publisher);
    await expect
      .poll(async () => (await listStreams(publisher)) || [], { timeout: 25_000 })
      .toContain(streamName);

    await viewer.goto('/#/play');
    await startPlaying(viewer, { streamName, useWhep: true });
    await expectPlaying(viewer);
    await expect
      .poll(async () => Number((await statValue(viewer, 'Frames decoded').textContent()) || 0), { timeout: 25_000 })
      .toBeGreaterThan(0);

    await publisher.close();
    await viewer.close();
  });
});