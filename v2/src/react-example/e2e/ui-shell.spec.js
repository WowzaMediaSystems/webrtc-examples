import { test, expect } from '@playwright/test';

import {
  APPLICATION,
  SIGNALING_URL,
  requireEngine,
  uniqueStream,
} from './helpers.js';
import {
  expectLive,
  expectPlaying,
  openTab,
  startPlaying,
  startPublishing,
  waitForCamera,
} from './ui-helpers.js';

/*
 * The shell before any media flows: settings panel, transport choice, remembered
 * values, theme, and layout stability.
 */

test.describe('settings panel', () => {

  test('the client IP box stays shut until the option is ticked', async ({ page }) => {
    await page.goto('/#/play');
    await openTab(page, 'Advanced');

    const box = page.locator('#playIp');
    await expect(box).toBeDisabled();

    await page.locator('#playIsIp').check();
    await expect(box).toBeEnabled();
  });

  test('an address that is not an address is refused, in place and on Play', async ({ page }) => {
    await page.goto('/#/play');
    await openTab(page, 'Advanced');
    await page.locator('#playIsIp').check();

    await page.fill('#playIp', '192.168.1.999');
    await expect(page.locator('#playIp')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#playIp-error')).toBeVisible();

    // The primary action refuses it too.
    await openTab(page, 'Connection');
    await page.fill('#playSignalingURL', SIGNALING_URL);
    await page.fill('#playApplicationName', APPLICATION);
    await page.fill('#playStreamName', 'anything');
    await page.click('#play-toggle');
    await expect(page.locator('#error-panel')).toContainText(/not an ip address/i);

    await openTab(page, 'Advanced');
    await page.fill('#playIp', '192.168.1.42');
    await expect(page.locator('#playIp')).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('a player reports frames decoded, never frames encoded', async ({ page }) => {
    await page.goto('/#/play');
    const media = page.getByRole('group', { name: 'Media' });
    await expect(media).toContainText('Frames decoded');
    await expect(media).not.toContainText('Frames encoded');
  });

  test('a publisher reports frames encoded, never frames decoded', async ({ page }) => {
    await page.goto('/#/publish');
    const media = page.getByRole('group', { name: 'Media' });
    await expect(media).toContainText('Frames encoded');
    await expect(media).not.toContainText('Frames decoded');
  });
});


test.describe('shell alignment', () => {
  // The topbar rule and the tab-strip rule read as one line, so they share a pixel.
  test('the topbar rule and the tab rule share a line', async ({ page }) => {
    for (const route of ['#/publish', '#/play', '#/loopback']) {
      await page.goto(`/${route}`);
      const rules = await page.evaluate(() => {
        const bottom = (sel) => {
          const el = document.querySelector(sel);
          return el ? Math.round(el.getBoundingClientRect().bottom) : null;
        };
        // On the combined page the Publisher/Player switch stands where the tabs otherwise do.
        return { topbar: bottom('.wz-topbar'), panel: bottom('.wz-inspector__switch') ?? bottom('.wz-tabs') };
      });
      expect(rules.panel, `${route}: topbar ${rules.topbar} vs panel ${rules.panel}`)
        .toBe(rules.topbar);
    }
  });
});


test.describe('status badges', () => {
  test('LIVE appears at the right end of the topbar, not in the rail', async ({ page }) => {
    await page.goto('/#/publish');
    await requireEngine(page, test);

    await startPublishing(page, { streamName: uniqueStream('badge') });
    await expectLive(page);

    const badge = page.locator('#video-live-indicator-live');
    await expect(badge).toBeVisible();

    const where = await page.evaluate(() => {
      const b = document.querySelector('#video-live-indicator-live').getBoundingClientRect();
      const topbar = document.querySelector('.wz-topbar').getBoundingClientRect();
      const inRail = !!document.querySelector('.wz-rail #video-live-indicator-live');
      const status = document.querySelector('.wz-topbar .wz-status').getBoundingClientRect();
      return {
        inTopbar: b.top >= topbar.top && b.bottom <= topbar.bottom,
        // The whole group, not just one badge: a column of two overflowed the bar.
        fitsInBar: status.top >= topbar.top && status.bottom <= topbar.bottom,
        gapToRightEdge: Math.round(topbar.right - b.right),
        pastHalfway: b.left > topbar.left + topbar.width / 2,
        inRail,
      };
    });

    expect(where.inTopbar).toBe(true);
    expect(where.inRail).toBe(false);
    expect(where.fitsInBar).toBe(true);
    expect(where.pastHalfway).toBe(true);
    // Against the edge, but not jammed into it.
    expect(where.gapToRightEdge).toBeGreaterThan(0);
    expect(where.gapToRightEdge).toBeLessThan(40);
  });
});

/*
 * The rendition badge and caption overlay are positioned against their container, which
 * must be the picture, not the pane around it.
 */
test.describe('video overlays', () => {
  for (const route of ['#/play', '#/loopback']) {
    test(`the rendition badge sits on the picture (${route})`, async ({ browser }) => {
      const publisher = await browser.newPage();
      await publisher.goto('/#/publish');
      await requireEngine(publisher, test);

      const streamName = uniqueStream('ovl');
      await startPublishing(publisher, { streamName });
      await expectLive(publisher);

      const viewer = await browser.newPage();
      await viewer.setViewportSize({ width: 1440, height: 900 });
      await viewer.goto(`/${route}`);
      if (route === '#/loopback') {
        await viewer.getByRole('button', { name: 'Player', exact: true }).click();
      }
      await startPlaying(viewer, { streamName });
      await expectPlaying(viewer);
      await viewer.waitForFunction(
        () => { const v = document.querySelector('#player-video'); return v && v.videoWidth > 0; },
        null, { timeout: 20_000 });

      const badge = viewer.locator('#rendition-badge');
      await expect(badge).toBeVisible();

      const within = await viewer.evaluate(() => {
        const b = document.querySelector('#rendition-badge').getBoundingClientRect();
        const v = document.querySelector('#player-video').getBoundingClientRect();
        return b.top >= v.top && b.bottom <= v.bottom && b.left >= v.left && b.right <= v.right;
      });
      expect(within).toBe(true);

      // Sound is controllable whenever there is a picture.
      const toggle = viewer.locator('#player-mute-toggle');
      await expect(toggle).toBeVisible();
      const before = await viewer.evaluate(() => document.querySelector('#player-video').muted);
      await toggle.click();
      await expect.poll(() => viewer.evaluate(() => document.querySelector('#player-video').muted))
        .toBe(!before);
      await expect(toggle).toHaveAttribute('aria-pressed', String(!before));

      await publisher.close();
      await viewer.close();
    });
  }
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


test.describe('remembered values', () => {
  test('a published stream name comes back as a suggestion', async ({ page }) => {
    await page.goto('/#/publish');
    await page.fill('#signalingURL', 'wss://engine.example/webrtc-session.json');
    await page.fill('#applicationName', 'webrtc');
    await page.fill('#streamName', 'rememberMe');
    await page.click('#publish-toggle');

    await page.reload();
    await page.locator('#streamName-recent-toggle').click();
    await expect(page.locator('#streamName-recent .wz-recent__value')).toHaveText(['rememberMe']);

    // The field is still a field: the suggestions do not close it off.
    await page.fill('#streamName', 'somethingElse');
    await expect(page.locator('#streamName')).toHaveValue('somethingElse');
  });

  test('the player is offered what the publisher used', async ({ page }) => {
    await page.goto('/#/publish');
    await page.fill('#signalingURL', 'wss://engine.example/webrtc-session.json');
    await page.fill('#applicationName', 'webrtc');
    await page.fill('#streamName', 'sharedList');
    await page.click('#publish-toggle');

    await page.goto('/#/play');
    await page.locator('#playStreamName-recent-toggle').click();
    await expect(page.locator('#playStreamName-recent .wz-recent__value')).toHaveText(['sharedList']);
  });

  // Offering a credential back in a dropdown is not a convenience worth having.
  test('no secret is remembered', async ({ page }) => {
    await page.goto('/#/publish');
    await page.locator('#publishUseWhip').check();
    await page.fill('#publishAuthToken', 'super-secret');
    await page.fill('#signalingURL', 'https://engine.example');
    await page.fill('#applicationName', 'webrtc');
    await page.fill('#streamName', 'tokenTest');
    await page.click('#publish-toggle');

    const stored = await page.evaluate(() => JSON.stringify(window.localStorage));
    expect(stored).not.toContain('super-secret');
  });
});

// The transport switch is one boolean in the store and on the wire, with a word either side.
test.describe('transport selector', () => {

  test('WSS is the default, and the words either side say what the switch means', async ({ page }) => {
    await page.goto('/#/publish');

    const sides = page.locator('#publishUseWhip').locator('..').locator('.wz-toggle-select__side');
    await expect(sides).toHaveText(['WSS', 'WHIP']);

    // Off is WSS, which is the side shown as chosen.
    await expect(page.locator('#publishUseWhip')).not.toBeChecked();
    await expect(sides.nth(0)).toHaveAttribute('data-active', 'true');
    await expect(sides.nth(1)).toHaveAttribute('data-active', 'false');

    await page.locator('#publishUseWhip').check();
    await expect(sides.nth(0)).toHaveAttribute('data-active', 'false');
    await expect(sides.nth(1)).toHaveAttribute('data-active', 'true');
  });

  test('the player offers WHEP, not WHIP', async ({ page }) => {
    await page.goto('/#/play');

    const sides = page.locator('#playUseWhep').locator('..').locator('.wz-toggle-select__side');
    await expect(sides).toHaveText(['WSS', 'WHEP']);
  });

  // The words go bold when chosen, and bold is wider. Reserved up front, or they slide.
  test('choosing a side does not move the words', async ({ page }) => {
    await page.goto('/#/publish');

    const lefts = () => page.evaluate(() =>
      Array.from(document.querySelectorAll('.wz-toggle-select__side'))
        .map((el) => Math.round(el.getBoundingClientRect().left)));

    const before = await lefts();
    await page.locator('#publishUseWhip').check();
    expect(await lefts()).toEqual(before);
  });

  test('the auth token is present under WSS, disabled, and says why', async ({ page }) => {
    await page.goto('/#/publish');

    const token = page.locator('#publishAuthToken');
    await expect(token).toBeVisible();
    await expect(token).toBeDisabled();
    await expect(page.locator('label[for="publishAuthToken"]')).toHaveText('WHIP Auth Token');
    await expect(page.locator('#publishAuthToken-hint')).toContainText('Select WHIP');

    // The label dims with the control, or it reads as half switched off. Neighbors stay put.
    const dimming = () => page.evaluate(() => ({
      token: getComputedStyle(document.getElementById('publishAuthToken')).opacity,
      label: getComputedStyle(document.querySelector('label[for="publishAuthToken"]')).opacity,
      peer: getComputedStyle(document.querySelector('label[for="applicationName"]')).opacity,
    }));
    expect(await dimming()).toEqual({ token: '0.55', label: '0.6', peer: '1' });

    await page.locator('#publishUseWhip').check();
    await expect(token).toBeEnabled();
    await expect(page.locator('#publishAuthToken-hint')).toContainText('Bearer');
    expect(await dimming()).toEqual({ token: '1', label: '1', peer: '1' });
  });

  test('the player auth token behaves the same way and is named for WHEP', async ({ page }) => {
    await page.goto('/#/play');

    const token = page.locator('#playAuthToken');
    await expect(token).toBeVisible();
    await expect(token).toBeDisabled();
    await expect(page.locator('label[for="playAuthToken"]')).toHaveText('WHEP Auth Token');

    await page.locator('#playUseWhep').check();
    await expect(token).toBeEnabled();
  });
});


test.describe('signaling URL', () => {

  // A pre-filled value that is not a real value leaks downstream; the remembered list
  // already saves the typing.
  test('starts empty and shows the shape the transport wants', async ({ page }) => {
    await page.goto('/#/publish');
    const url = page.locator('#signalingURL');

    await expect(url).toHaveValue('');
    await expect(url).toHaveAttribute('placeholder', /^wss:\/\/.*webrtc-session\.json$/);

    await page.locator('#publishUseWhip').check();
    await expect(url).toHaveValue('');
    await expect(url).toHaveAttribute('placeholder', /^https:\/\//);
  });

  // Transport is how to reach the server, not which one: only scheme and path change.
  test('the host and port carry over when the transport changes', async ({ page }) => {
    await page.goto('/#/publish');
    await page.fill('#signalingURL', 'wss://engine.example:8443/webrtc-session.json');

    await page.locator('#publishUseWhip').check();
    await expect(page.locator('#signalingURL')).toHaveValue('https://engine.example:8443');

    await page.locator('#publishUseWhip').uncheck();
    await expect(page.locator('#signalingURL')).toHaveValue('wss://engine.example:8443/webrtc-session.json');
  });

  test('the player carries it over too', async ({ page }) => {
    await page.goto('/#/play');
    await page.fill('#playSignalingURL', 'wss://engine.example:8443/webrtc-session.json');

    await page.locator('#playUseWhep').check();
    await expect(page.locator('#playSignalingURL')).toHaveValue('https://engine.example:8443');
  });

  // Flipping ws/wss silently changes session protection and yields a URL that does not answer.
  test('carrying it over does not change the security level', async ({ page }) => {
    await page.goto('/#/publish');
    await page.fill('#signalingURL', 'ws://localhost:8080/webrtc-session.json');

    await page.locator('#publishUseWhip').check();
    await expect(page.locator('#signalingURL')).toHaveValue('http://localhost:8080');
  });

  // The switch converts, so the only way to end up mismatched is to type it that way.
  test('a URL typed for the other transport is flagged', async ({ page }) => {
    await page.goto('/#/publish');
    await page.locator('#publishUseWhip').check();

    await page.fill('#signalingURL', 'wss://engine.example/webrtc-session.json');
    await expect(page.locator('#signalingURL-mismatch')).toBeVisible();

    await page.fill('#signalingURL', 'https://engine.example');
    await expect(page.locator('#signalingURL-mismatch')).toHaveCount(0);
  });

  test('an empty field is refused, and is never remembered', async ({ page }) => {
    await page.goto('/#/publish');
    await page.fill('#applicationName', 'webrtc');
    await page.fill('#streamName', 'noUrl');

    await page.click('#publish-toggle');
    await expect(page.locator('#error-panel')).toContainText('Signaling URL is required');

    const stored = await page.evaluate(() => JSON.stringify(window.localStorage));
    expect(stored).not.toContain('webrtc-session.json');
  });
});


// A custom dropdown sized to the panel (a native <datalist> popup is not), over a text field.
test.describe('remembered values dropdown', () => {

  const remember = (page, key, values) =>
    page.evaluate(([k, v]) => window.localStorage.setItem(k, JSON.stringify(v)), [key, values]);

  test('opens on the chevron and fills the field when a row is picked', async ({ page }) => {
    await page.goto('/#/publish');
    await remember(page, 'wz.recent.streamName', ['alpha', 'beta']);
    await page.reload();

    await expect(page.locator('#streamName-recent')).toHaveCount(0);
    await page.locator('#streamName-recent-toggle').click();
    await expect(page.locator('#streamName-recent .wz-recent__value')).toHaveText(['alpha', 'beta']);

    await page.locator('#streamName-recent .wz-recent__value', { hasText: 'beta' }).click();
    await expect(page.locator('#streamName')).toHaveValue('beta');
    await expect(page.locator('#streamName-recent')).toHaveCount(0);
  });

  test('clicking a row outside its text picks it too', async ({ page }) => {
    await page.goto('/#/publish');
    await remember(page, 'wz.recent.streamName', ['alpha', 'beta']);
    await page.reload();
    await page.locator('#streamName-recent-toggle').click();

    // The row's left padding, outside the text.
    await page.locator('#streamName-recent .wz-recent__row', { hasText: 'beta' })
      .click({ position: { x: 3, y: 12 } });
    await expect(page.locator('#streamName')).toHaveValue('beta');
  });

  test('a row is no taller than the control it belongs to', async ({ page }) => {
    await page.goto('/#/publish');
    await remember(page, 'wz.recent.streamName', ['alpha']);
    await page.reload();
    await page.locator('#streamName-recent-toggle').click();

    const heights = await page.evaluate(() => ({
      row: document.querySelector('#streamName-recent .wz-recent__value').getBoundingClientRect().height,
      control: document.getElementById('streamName').getBoundingClientRect().height,
    }));
    expect(heights.row).toBeLessThan(heights.control);
  });

  test('a value can be dropped from the list', async ({ page }) => {
    await page.goto('/#/publish');
    await remember(page, 'wz.recent.streamName', ['keep', 'drop']);
    await page.reload();

    await page.locator('#streamName-recent-toggle').click();
    await page.getByRole('button', { name: 'Forget drop' }).click();
    await expect(page.locator('#streamName-recent .wz-recent__value')).toHaveText(['keep']);

    await page.reload();
    await page.locator('#streamName-recent-toggle').click();
    await expect(page.locator('#streamName-recent .wz-recent__value')).toHaveText(['keep']);
  });

  test('typing filters, and a new value is still typed straight over them', async ({ page }) => {
    await page.goto('/#/publish');
    await remember(page, 'wz.recent.streamName', ['alpha', 'beta']);
    await page.reload();

    await page.fill('#streamName', 'al');
    await expect(page.locator('#streamName-recent .wz-recent__value')).toHaveText(['alpha']);

    await page.fill('#streamName', 'brandNew');
    await expect(page.locator('#streamName-recent')).toHaveCount(0);
    await expect(page.locator('#streamName')).toHaveValue('brandNew');
  });

  // A wss:// URL cannot work where an https:// origin is wanted.
  test('the URL list is kept per transport', async ({ page }) => {
    await page.goto('/#/publish');
    await remember(page, 'wz.recent.signalingURL.wss', ['wss://engine.example/webrtc-session.json']);
    await remember(page, 'wz.recent.signalingURL.http', ['https://engine.example']);
    await page.reload();

    await page.locator('#signalingURL-recent-toggle').click();
    await expect(page.locator('#signalingURL-recent .wz-recent__value'))
      .toHaveText(['wss://engine.example/webrtc-session.json']);

    await page.locator('#publishUseWhip').check();
    await page.locator('#signalingURL-recent-toggle').click();
    await expect(page.locator('#signalingURL-recent .wz-recent__value'))
      .toHaveText(['https://engine.example']);
  });

  // A list stored under the old single key must survive the split.
  test('a list kept before the split is sorted into the two transports', async ({ page }) => {
    await page.goto('/#/publish');
    await remember(page, 'wz.recent.signalingURL',
      ['wss://engine.example/webrtc-session.json', 'https://engine.example']);
    await page.reload();

    await page.locator('#signalingURL-recent-toggle').click();
    await expect(page.locator('#signalingURL-recent .wz-recent__value'))
      .toHaveText(['wss://engine.example/webrtc-session.json']);

    await page.locator('#publishUseWhip').check();
    await page.locator('#signalingURL-recent-toggle').click();
    await expect(page.locator('#signalingURL-recent .wz-recent__value'))
      .toHaveText(['https://engine.example']);
  });
});

// Icons are inline SVG with no icon font; nothing else in this suite would notice them missing.
test.describe('assets', () => {

  test('the icons are drawn inline, with no font to wait for', async ({ page }) => {
    await page.goto('/#/publish');
    await openTab(page, 'Source');
    await page.locator('#publishUseSimulcast').check();

    const add = page.getByRole('button', { name: /Add rendition/ });
    await expect(add.locator('svg.wz-icon')).toHaveCount(1);
    await expect(page.locator('button[title="Remove rendition"] svg.wz-icon').first()).toBeVisible();

    // The glyphs are painted, not empty boxes.
    const box = await add.locator('svg.wz-icon').boundingBox();
    expect(box.width).toBeGreaterThan(8);

    const fontRequests = await page.evaluate(() => performance
      .getEntriesByType('resource')
      .filter((r) => /bootstrap-icons/.test(r.name)).length);
    expect(fontRequests).toBe(0);
  });
});

/*
 * The toggles render from MediaStreamTrack.enabled, not a copy in component state, so a
 * remount cannot show a live microphone over a muted track.
 */
test.describe('camera and microphone toggles', () => {

  const trackState = (page) => page.evaluate(() => ({
    audio: window.__audioTrack ? window.__audioTrack.enabled : null,
    video: window.__videoTrack ? window.__videoTrack.enabled : null,
  }));

  // The tracks are reached through the preview element rather than through the store.
  const captureTracks = (page) => page.evaluate(() => {
    const video = document.getElementById('publisher-video');
    const stream = video && video.srcObject;
    window.__audioTrack = stream ? stream.getAudioTracks()[0] : null;
    window.__videoTrack = stream ? stream.getVideoTracks()[0] : null;
    return Boolean(window.__audioTrack && window.__videoTrack);
  });

  test('the button says what the track is actually doing', async ({ page }) => {
    await page.goto('/#/publish');
    await waitForCamera(page);
    await openTab(page, 'Source');
    expect(await captureTracks(page)).toBe(true);

    const mute = page.locator('#mute-toggle');
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    expect((await trackState(page)).audio).toBe(true);

    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    expect((await trackState(page)).audio).toBe(false);
  });

  // The side switch on the combined page remounts the whole settings form.
  test('a muted microphone stays muted, and still looks muted, across a remount', async ({ page }) => {
    await page.goto('/#/loopback');
    await waitForCamera(page);
    await openTab(page, 'Source');
    expect(await captureTracks(page)).toBe(true);

    await page.locator('#mute-toggle').click();
    expect((await trackState(page)).audio).toBe(false);

    await page.getByRole('button', { name: 'Player', exact: true }).click();
    await page.getByRole('button', { name: 'Publisher', exact: true }).click();
    await openTab(page, 'Source');

    expect((await trackState(page)).audio).toBe(false);
    await expect(page.locator('#mute-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the camera toggle behaves the same way', async ({ page }) => {
    await page.goto('/#/publish');
    await waitForCamera(page);
    await openTab(page, 'Source');
    expect(await captureTracks(page)).toBe(true);

    await page.locator('#camera-toggle').click();
    expect((await trackState(page)).video).toBe(false);
    await expect(page.locator('#camera-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  // Pressing either with no device would throw inside the reducer.
  test('neither can be pressed before there is a track to switch', async ({ page }) => {
    await page.goto('/#/play');
    await expect(page.locator('#mute-toggle')).toHaveCount(0);
  });
});

// A setting's hint needs space before the next setting, or the two read as one paragraph.
test.describe('settings that explain themselves', () => {

  const spacing = (page) => page.evaluate(() => {
    const box = (el) => el.getBoundingClientRect();
    const settings = [...document.querySelectorAll('.wz-inspector .wz-setting')];
    const first = settings[0];
    const second = settings[1];
    const control = first.querySelector('.form-check-inline');
    const hint = first.querySelector('.form-text, .wz-field-error');
    const nextLabel = second.querySelector('.form-check-label');
    return {
      settings: settings.length,
      controlToOwnHint: Math.round(box(hint).top - box(control).bottom),
      hintToNextSetting: Math.round(box(nextLabel).top - box(hint).bottom),
    };
  });

  test('a hint sits closer to its own switch than to the next one', async ({ page }) => {
    await page.goto('/#/publish');
    await openTab(page, 'Advanced');

    const gaps = await spacing(page);
    expect(gaps.settings, 'both diagnostics should be grouped').toBe(2);
    expect(gaps.hintToNextSetting,
      'the next setting runs into the previous explanation')
      .toBeGreaterThan(gaps.controlToOwnHint + 8);
  });

  test('the two diagnostics are separate settings, not one block of prose', async ({ page }) => {
    await page.goto('/#/publish');
    await openTab(page, 'Advanced');

    await expect(page.locator('.wz-setting', { has: page.locator('#publishLatencyProbe') }))
      .toHaveCount(1);
    await expect(page.locator('.wz-setting', { has: page.locator('#publishBurnedClock') }))
      .toHaveCount(1);
  });
});

/*
 * Each theme needs its own label color: one shared gray is too faint on white for a disabled
 * label (60 percent opacity) to look any different.
 */
test.describe('enabled and disabled fields are told apart', () => {

  const contrasts = (page) => page.evaluate(() => {
    const luminance = (colour) => {
      const [r, g, b] = colour.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const panel = luminance(
      getComputedStyle(document.querySelector('.wz-inspector')).backgroundColor);

    // Text drawn at an opacity sits between its own color and what is behind it.
    const effective = (id) => {
      const label = document.querySelector(`label[for="${id}"]`);
      const cs = getComputedStyle(label);
      const alpha = Number(cs.opacity);
      return luminance(cs.color) * alpha + panel * (1 - alpha);
    };
    const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

    const enabled = effective('applicationName');
    const disabled = effective('publishAuthToken');
    return {
      enabledVsPanel: ratio(enabled, panel),
      enabledVsDisabled: ratio(enabled, disabled),
    };
  });

  for (const theme of ['light', 'dark']) {
    test(`in ${theme} mode`, async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem('wz.theme', t), theme);
      await page.goto('/#/publish');
      await expect(page.locator('#publishAuthToken')).toBeDisabled();

      const { enabledVsPanel, enabledVsDisabled } = await contrasts(page);

      // A label someone is expected to read, against the panel it sits on.
      expect(enabledVsPanel, 'the enabled label is too faint to read').toBeGreaterThan(4.5);
      // And enough between the two that one plainly looks switched off.
      expect(enabledVsDisabled, 'enabled and disabled look the same').toBeGreaterThan(1.4);
    });
  }
});


test.describe('field layout', () => {
  test('frame rate and frame size share a line', async ({ page }) => {
    await page.goto('/#/publish');
    await openTab(page, 'Source');

    const tops = await page.evaluate(() => {
      const box = (id) => Math.round(document.getElementById(id).getBoundingClientRect().top);
      return { rate: box('videoFrameRate'), size: box('frameSize') };
    });
    expect(tops.rate).toBe(tops.size);
  });

  test('a field and the control beside it share one ground colour', async ({ page }) => {
    await page.goto('/#/publish');
    await page.evaluate(() => document.documentElement.setAttribute('data-bs-theme', 'light'));
    await openTab(page, 'Source');

    const colours = await page.evaluate(() => {
      const bg = (el) => getComputedStyle(el).backgroundColor;
      return {
        select: bg(document.querySelector('#videoCodec')),
        rung: bg(document.querySelector('#simulcast-renditions input')),
      };
    });
    // Every field in the panel must agree with every other field.
    expect(colours.rung).toBe(colours.select);
  });
});

// The selected tab is bold, and bold is wider. Held to the pixel: the labels must not move.
test.describe('tab stability', () => {
  test('the tab labels do not move when the selection changes', async ({ page }) => {
    await page.goto('/#/publish');

    const positions = async () => page.evaluate(() =>
      [...document.querySelectorAll('.wz-tabs button')].map((b) => {
        const r = b.getBoundingClientRect();
        return { label: b.textContent.trim(), left: Math.round(r.left), width: Math.round(r.width) };
      }));

    const start = await positions();
    for (const label of ['Source', 'Advanced', 'Connection']) {
      await openTab(page, label);
      expect(await positions(), `after selecting ${label}`).toEqual(start);
    }
  });

  test('the publisher and player switch does not move either', async ({ page }) => {
    await page.goto('/#/loopback');

    const positions = async () => page.evaluate(() =>
      [...document.querySelectorAll('.wz-segment button')].map((b) => {
        const r = b.getBoundingClientRect();
        return { label: b.textContent.trim(), left: Math.round(r.left), width: Math.round(r.width) };
      }));

    const start = await positions();
    await page.getByRole('button', { name: 'Player', exact: true }).click();
    expect(await positions()).toEqual(start);
    await page.getByRole('button', { name: 'Publisher', exact: true }).click();
    expect(await positions()).toEqual(start);
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
  test('the player has two tabs and the token settings moved under Advanced', async ({ page }) => {
    await page.goto('/#/play');
    await expect(page.locator('.wz-tabs button')).toHaveCount(2);

    await openTab(page, 'Advanced');
    await expect(page.locator('#playSecret')).toBeVisible();
    await expect(page.locator('#stunServer')).toBeVisible();
  });

  test('the publisher keeps three tabs, and the middle one is Source', async ({ page }) => {
    await page.goto('/#/publish');
    const labels = await page.locator('.wz-tabs button').allTextContents();
    expect(labels.map((l) => l.trim())).toEqual(['Connection', 'Source', 'Advanced']);
  });

  // The guard against someone quietly re-nesting these behind a click later.
  test('simulcast and ICE servers are laid out, not hidden in a drawer', async ({ page }) => {
    await page.goto('/#/publish');

    await openTab(page, 'Source');
    await expect(page.locator('#publishUseSimulcast')).toBeVisible();
    await expect(page.locator('#simulcast-renditions')).toBeVisible();

    await openTab(page, 'Advanced');
    await expect(page.locator('#stunServer')).toBeVisible();
    await expect(page.locator('#turnServer')).toBeVisible();
  });

  // The combined page gives one Inspector two tab arrays, so the selected tab may not exist
  // on the other side.
  test('the tab strip always shows a selection, even after a side switch', async ({ page }) => {
    await page.goto('/#/loopback');
    await openTab(page, 'Source');

    await page.getByRole('button', { name: 'Player', exact: true }).click();
    await expect(page.locator('.wz-tabs button[aria-selected="true"]')).toHaveCount(1);

    await page.getByRole('button', { name: 'Publisher', exact: true }).click();
    await expect(page.locator('.wz-tabs button[aria-selected="true"]')).toHaveCount(1);
  });

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

test.describe('panel alignment', () => {
  // The legacy note's rule and the server communication bar's rule read as one line.
  test('the legacy note rule lines up with the server communication rule', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const route of ['#/publish', '#/play']) {
      await page.goto(`/${route}`);
      const tops = await page.evaluate(() => ({
        foot: document.querySelector('.wz-inspector__foot').getBoundingClientRect().top,
        debug: document.querySelector('.wz-debug').getBoundingClientRect().top,
      }));
      expect(Math.abs(tops.foot - tops.debug), `${route}: foot ${tops.foot} vs debug ${tops.debug}`)
        .toBeLessThanOrEqual(2);
    }
  });
});

test.describe('advanced tab', () => {
  test('the player Advanced tab leads with Diagnostics, and no section is double ruled',
    async ({ page }) => {
      await page.goto('/#/play');
      await openTab(page, 'Advanced');

      const shape = await page.evaluate(() => {
        const adv = [...document.querySelectorAll('.wz-inspector__body form > div')]
          .find((d) => d.querySelector('#playSecret'));
        const seq = [];
        adv.childNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          const c = n.className.toString();
          seq.push(c.includes('wz-group') ? `GROUP ${n.textContent.trim()}` : (c.includes('wz-rule') ? 'rule' : 'block'));
        });
        return seq;
      });

      expect(shape[0]).toBe('GROUP Diagnostics');
      expect(shape.filter((v) => v.startsWith('GROUP'))).toEqual(
        ['GROUP Diagnostics', 'GROUP Secure Token', 'GROUP ICE Servers']);
      expect(shape.some((v, i) => v === 'rule' && shape[i + 1] === 'rule'),
        'two separators in a row').toBe(false);
    });
});
