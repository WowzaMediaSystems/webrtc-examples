import { expect, test } from '@playwright/test';
import {
  failOnPageErrors,
} from './helpers.js';

/* Needs no Engine: these cover the app shell itself. */

test.describe('app shell', () => {
  test('every route renders without a page error', async ({ page }) => {
    const errors = [];
    failOnPageErrors(page, errors);

    for (const route of ['#/publish', '#/play']) {
      await page.goto(`/${route}`);
      await expect(page.locator('#top-nav')).toBeVisible();
      await expect(page.locator('#root')).not.toBeEmpty();
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('the nav links reach the play page', async ({ page }) => {
    await page.goto('/#/publish');
    await page.getByRole('link', { name: 'Play', exact: true }).click();
    await expect(page.locator('#play-settings')).toBeVisible();
  });
});
