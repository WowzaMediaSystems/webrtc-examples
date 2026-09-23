import { expect, test } from '@playwright/test';
import {
  failOnPageErrors,
} from './helpers.js';
import {
  openTab,
} from './ui-helpers.js';

/* Needs no Engine: these cover the app shell itself. */

test.describe('app shell', () => {
  test('every route renders without a page error', async ({ page }) => {
    const errors = [];
    failOnPageErrors(page, errors);

    for (const route of ['#/publish', '#/play', '#/loopback']) {
      await page.goto(`/${route}`);
      await expect(page.locator('#top-nav')).toBeVisible();
      await expect(page.locator('#root')).not.toBeEmpty();
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('the nav links reach all three pages', async ({ page }) => {
    await page.goto('/#/publish');
    await page.getByRole('link', { name: 'Play', exact: true }).click();
    await expect(page.locator('#play-settings')).toBeVisible();
    await page.getByRole('link', { name: 'Publish + Play' }).click();
    await expect(page.locator('#loopback-content')).toBeVisible();
  });

  test('the loopback page shows a publisher and a player side by side', async ({ page }) => {
    await page.goto('/#/loopback');
    await expect(page.getByRole('heading', { name: /Publisher/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Player/ })).toBeVisible();
    // The inspector points at one side at a time, so the switch is what proves both are
    // reachable, not both forms being on screen together.
    await expect(page.locator('#publish-settings')).toBeVisible();
    await page.getByRole('button', { name: 'Player', exact: true }).click();
    await expect(page.locator('#play-settings')).toBeVisible();
  });

  test('the debug panel starts collapsed and opens on click', async ({ page }) => {
    await page.goto('/#/play');
    const toggle = page.getByRole('button', { name: /Server communication/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: 'Signaling', exact: true })).toBeVisible();
  });

  test('the default frame size does not raise an overconstrained error', async ({ page }) => {
    // Regression: "default" used to impose min 640x360, which failed on cameras that
    // could not reach it, the moment the page loaded.
    await page.goto('/#/publish');
    await openTab(page, 'Source');
    await expect(page.locator('#frameSize')).toHaveValue('default');
    await page.waitForTimeout(3000);
    await expect(page.locator('#error-panel')).toHaveCount(0);
  });

  // Auto by default: an explicit codec filters the offer, and a server that will not accept
  // it rejects the video line outright rather than falling back.
  test('the video codec defaults to Auto', async ({ page }) => {
    await page.goto('/#/publish');
    await openTab(page, 'Source');
    await expect(page.locator('#videoCodec')).toHaveValue('auto');
  });
});
