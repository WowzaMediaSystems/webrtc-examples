import { expect, test } from '@playwright/test';
import { failOnPageErrors } from './helpers';

/* Needs no Engine: these cover only that the app boots under the new toolchain. */

test.describe('app boot', () => {
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

  test('the root path redirects to the publish page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/#\/publish$/);
    await expect(page.locator('#top-nav')).toBeVisible();
  });
});
