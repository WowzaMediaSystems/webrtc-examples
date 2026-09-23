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
 * The combined page, which carries a publisher and a player at once and is the
 * only place their two sets of figures appear together.
 */

test.describe('combined page alignment', () => {
  test('the pictures start together and the stat strips end together', async ({ page }) => {
    await requireEngine(page, test);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/#/loopback');

    const streamName = uniqueStream('align');
    await startPublishing(page, { streamName });
    await expectLive(page);
    await page.getByRole('button', { name: 'Player', exact: true }).click();
    await startPlaying(page, { streamName });
    await expectPlaying(page);
    await page.waitForTimeout(3000);

    const geom = await page.evaluate(() => {
      const panes = [...document.querySelectorAll('.wz-loopback__pane')];
      const box = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
      return {
        videoTops: panes.map((p) => box(p.querySelector('video')).top),
        stripBottoms: panes.map((p) => box(p.querySelector('.wz-statgroups')).bottom),
      };
    });

    expect(geom.videoTops[0]).toBe(geom.videoTops[1]);
    expect(geom.stripBottoms[0]).toBe(geom.stripBottoms[1]);
  });
});


test.describe('combined page settings', () => {
  test('the player settings are filled from the publisher in one click', async ({ page }) => {
    await page.goto('/#/loopback');

    await page.fill('#signalingURL', 'wss://engine.example/webrtc-session.json');
    await page.fill('#applicationName', 'webrtc');
    await page.fill('#streamName', 'copyMe');

    await page.getByRole('button', { name: 'Player', exact: true }).click();
    await expect(page.locator('#playStreamName')).toHaveValue('');

    await page.locator('#copy-from-publisher').click();

    await expect(page.locator('#playSignalingURL')).toHaveValue('wss://engine.example/webrtc-session.json');
    await expect(page.locator('#playApplicationName')).toHaveValue('webrtc');
    await expect(page.locator('#playStreamName')).toHaveValue('copyMe');
  });

  test('WHIP on the publisher becomes WHEP on the player', async ({ page }) => {
    await page.goto('/#/loopback');
    await page.locator('#publishUseWhip').check();
    await page.fill('#streamName', 'whipCopy');

    await page.getByRole('button', { name: 'Player', exact: true }).click();
    await page.locator('#copy-from-publisher').click();

    await expect(page.locator('#playUseWhep')).toBeChecked();
  });
});

// A latency change during a session should produce a log line naming both values.
