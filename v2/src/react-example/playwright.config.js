import { defineConfig, devices } from '@playwright/test';

/*
 * End-to-end tests.
 *
 * These drive a real browser against a real Wowza Streaming Engine. Two things make that
 * possible without hardware or a human:
 *
 *   --use-fake-device-for-media-stream  gives Chromium a synthetic camera and microphone,
 *                                       so publish tests need no webcam.
 *   --use-fake-ui-for-media-stream      auto-accepts the permission prompt.
 *
 * The Engine URL comes from WOWZA_SIGNALING_URL. Tests that need a server skip themselves
 * when it is not reachable, so `npm run test:e2e` is still useful without one.
 */
const PORT = Number(process.env.E2E_PORT || 4183);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The Engine in a development setup usually has a self-signed certificate.
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            '--ignore-certificate-errors',
          ],
        },
      },
    },
  ],

  webServer: {
    // Build first: preview serves an existing output folder and errors on a fresh clone.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});