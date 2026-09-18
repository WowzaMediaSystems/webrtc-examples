import { expect } from '@playwright/test';

import { APPLICATION, SIGNALING_URL, httpOrigin } from './helpers.js';

/*
 * The helpers that know what the page looks like: which tab to click, how to tell that a
 * camera is up, what the Publish button is called.
 *
 * Kept apart from helpers.js, which knows only about the Engine. A test that checks a stream
 * reached the server should not have to import anything that has an opinion about the UI.
 */

/**
 * Switches the inspector to a tab. Fields outside the active tab stay mounted but hidden,
 * so they must be revealed before they can be clicked or typed into.
 */
export const openTab = async (page, label) => {
  const tab = page.getByRole('tab', { name: label, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
};

export const waitForCamera = async (page) => {
  // media.stream has two writers. CompositorUserMedia sets it and deliberately does NOT
  // dispatch SET_PUBLISH_VIDEO_TRACK; PublishVideoDropdown sets it and does. So a preview
  // with a live video track does not imply publishSettings.videoTrack is populated, and
  // publishing at that moment attaches audio only.
  //
  // Re-selecting the camera forces the dropdown's effect to run once videoTracksMap is
  // populated. The dropdown lives on the Media tab, so that tab has to be open first: the
  // fields stay mounted when a tab is inactive, but they are hidden and cannot be clicked.
  await page.waitForFunction(
    () => {
      const cam = document.querySelector('#camera-list-select');
      const mic = document.querySelector('#mic-list-select');
      return !!cam && cam.value !== '' && !!mic && mic.value !== '';
    },
    undefined,
    { timeout: 25_000 }
  );

  await openTab(page, 'Source');
  const cameraId = await page.locator('#camera-list-select').inputValue();
  await page.selectOption('#camera-list-select', '');
  await page.waitForTimeout(250);
  await page.selectOption('#camera-list-select', cameraId);
  await openTab(page, 'Connection');

  await page.waitForFunction(
    () => {
      const v = document.querySelector('#publisher-video');
      if (!v || !v.srcObject || v.videoWidth === 0) return false;
      return v.srcObject.getVideoTracks().some((t) => t.readyState === 'live');
    },
    undefined,
    { timeout: 25_000 }
  );
};
/** Fills the publish form and presses Publish. */
export const startPublishing = async (page, { streamName, useWhip = false, codec }) => {
  await waitForCamera(page);
  // WHIP and the WebSocket path share the same field but want different URLs: wss:// for
  // signalling, an https:// origin for WHIP. Tick the box first so the field is being
  // read as the WHIP endpoint before it is filled.
  if (useWhip) await page.locator('#publishUseWhip').check();
  await page.fill('#signalingURL', useWhip ? httpOrigin() : SIGNALING_URL);
  await page.fill('#applicationName', APPLICATION);
  await page.fill('#streamName', streamName);
  if (codec) {
    await openTab(page, 'Source');
    await page.selectOption('#videoCodec', codec);
    await openTab(page, 'Connection');
  }
  await page.locator('#publish-toggle').click();
};

/** Fills the play form and presses Play. */
export const startPlaying = async (page, { streamName, useWhep = false }) => {
  if (useWhep) await page.locator('#playUseWhep').check();
  await page.fill('#playSignalingURL', useWhep ? httpOrigin() : SIGNALING_URL);
  await page.fill('#playApplicationName', APPLICATION);
  await page.fill('#playStreamName', streamName);
  await page.locator('#play-toggle').click();
};

/** Waits for the header LIVE / PLAYING badge. */
export const expectLive = async (page) =>
  expect(page.locator('#video-live-indicator-live')).toBeVisible({ timeout: 20_000 });

export const expectPlaying = async (page) =>
  expect(page.locator('#video-play-indicator')).toBeVisible({ timeout: 20_000 });

/** Reads a stat tile's value by its label. */
export const statValue = (page, label) =>
  page.locator('.wz-stat', { has: page.locator('.wz-stat__label', { hasText: new RegExp(`^${label}$`, 'i') }) })
    .locator('.wz-stat__value');

/** Fails loudly on page errors so a silent exception cannot pass as success. */
