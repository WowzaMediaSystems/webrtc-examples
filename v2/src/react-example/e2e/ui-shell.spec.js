import { test, expect } from '@playwright/test';

/*
 * The shell before any media flows: settings panel, transport choice, remembered
 * values, theme, and layout stability.
 */

test.describe('shell alignment', () => {
  // The topbar rule and the tab-strip rule read as one line, so they share a pixel.
  test('the topbar rule and the tab rule share a line', async ({ page }) => {
    for (const route of ['#/publish', '#/play']) {
      await page.goto(`/${route}`);
      const rules = await page.evaluate(() => {
        const bottom = (sel) => {
          const el = document.querySelector(sel);
          return el ? Math.round(el.getBoundingClientRect().bottom) : null;
        };
        return { topbar: bottom('.wz-topbar'), panel: bottom('.wz-tabs') };
      });
      expect(rules.panel, `${route}: topbar ${rules.topbar} vs panel ${rules.panel}`)
        .toBe(rules.topbar);
    }
  });
});


test.describe('theme', () => {
  test('switches between dark and light, and remembers the choice', async ({ page }) => {
    await page.goto('/#/publish');

    const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-bs-theme'));
    const before = await theme();

    await page.locator('#theme-toggle').click();
    const after = await theme();
    expect(after).not.toBe(before);
    expect(['light', 'dark']).toContain(after);

    // The page is genuinely repainted, not just relabeled.
    const surface = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.wz-inspector')).backgroundColor);
    await page.locator('#theme-toggle').click();
    const flipped = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.wz-inspector')).backgroundColor);
    expect(flipped).not.toBe(surface);

    await page.locator('#theme-toggle').click();
    await page.reload();
    expect(await theme()).toBe(after);
  });

  test('no text loses contrast against the light surface', async ({ page }) => {
    await page.goto('/#/publish');
    await page.evaluate(() => document.documentElement.setAttribute('data-bs-theme', 'light'));

    // A token that did not get a light value would leave near-white text on white.
    const unreadable = await page.evaluate(() => {
      const luminance = (colour) => {
        const [r, g, b] = colour.match(/\d+/g).slice(0, 3).map(Number);
        const channel = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const bad = [];
      document.querySelectorAll('.wz-inspector label, .wz-topbar__title, .wz-stat__label, .wz-stat__value')
        .forEach((el) => {
          const style = getComputedStyle(el);
          const text = luminance(style.color);
          const behind = luminance(getComputedStyle(document.querySelector('.wz-inspector')).backgroundColor);
          const ratio = (Math.max(text, behind) + 0.05) / (Math.min(text, behind) + 0.05);
          if (ratio < 3) bad.push(`${el.className || el.tagName}: ${style.color} ratio ${ratio.toFixed(2)}`);
        });
      return bad;
    });

    expect(unreadable, unreadable.join(' | ')).toEqual([]);
  });
});


test.describe('theme on first paint', () => {
  // The inline script in index.html sets the theme before the bundle mounts, so a
  // remembered choice never flashes the other theme.
  test('a remembered choice is applied before anything renders', async ({ page }) => {
    await page.goto('/#/publish');
    await page.evaluate(() => window.localStorage.setItem('wz.theme', 'light'));

    const atFirstPaint = [];
    await page.exposeFunction('__recordTheme', (v) => atFirstPaint.push(v));
    await page.addInitScript(() => {
      // Runs after the document element exists but before the app bundle has mounted.
      document.addEventListener('readystatechange', () => {
        if (document.readyState === 'interactive' && window.__recordTheme) {
          window.__recordTheme(document.documentElement.getAttribute('data-bs-theme'));
        }
      });
    });

    await page.reload();
    await expect(page.locator('.wz-rail')).toBeVisible();

    expect(atFirstPaint, 'theme before the app mounted').toContain('light');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-bs-theme')))
      .toBe('light');
  });
});

// Two player tabs, flat sections instead of drawers, a permanent legacy-Engine note. Engine-free.
test.describe('panel structure', () => {
  test('the legacy Engine note is on the panel without opening anything', async ({ page }) => {
    await page.goto('/#/publish');
    const foot = page.locator('.wz-inspector__foot');
    await expect(foot).toBeVisible();
    await expect(foot).toContainText(/4\.10\.0/);
    await expect(foot.locator('a')).toHaveAttribute('href', /legacy|publish/i);

    await page.goto('/#/play');
    await expect(page.locator('.wz-inspector__foot')).toBeVisible();
  });
});

test.describe('theme colors', () => {
  // A hover wash has to pull away from the surface under it: lighter on a dark panel,
  // darker on a light one.
  test('the hover wash pulls away from the surface in both themes', async ({ page }) => {
    await page.goto('/#/publish');

    const washes = await page.evaluate(() => {
      const read = (theme) => {
        document.documentElement.setAttribute('data-bs-theme', theme);
        const style = getComputedStyle(document.documentElement);
        return {
          hover: style.getPropertyValue('--wz-hover').trim(),
          surface: style.getPropertyValue('--wz-surface').trim(),
        };
      };
      return { dark: read('dark'), light: read('light') };
    });

    expect(washes.dark.hover).not.toBe('');
    expect(washes.light.hover).not.toBe('');
    expect(washes.light.hover).not.toBe(washes.dark.hover);

    // Read back through the browser: the build minifies rgba(255, 255, 255, 0.07) to
    // #ffffff12, which a digit regex would misread.
    const channels = await page.evaluate((colors) => {
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      const normalize = (color) => {
        probe.style.color = '';
        probe.style.color = color;
        const parts = getComputedStyle(probe).color.match(/[\d.]+/g) || [];
        return parts.slice(0, 3).map(Number);
      };
      const out = { dark: normalize(colors.dark), light: normalize(colors.light) };
      probe.remove();
      return out;
    }, { dark: washes.dark.hover, light: washes.light.hover });

    expect(Math.min(...channels.dark), 'the dark wash should be light').toBeGreaterThan(200);
    expect(Math.max(...channels.light), 'the light wash should be dark').toBeLessThan(120);
  });
});
