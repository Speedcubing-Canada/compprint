import { defineConfig, devices } from '@playwright/test';
import { APP_PORT, CLIENT_ID, CLIENT_SECRET, FAKE_WCA_ORIGIN, FAKE_WCA_PORT, REDIRECT_URI } from './e2e/protocol';

// Built into dist-e2e/, so a run never leaves its fake client id in the developer's dist/.

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: 'retain-on-failure',
    locale: 'en-US',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node e2e/fakeWcaOrigin.ts',
      port: FAKE_WCA_PORT,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'vite build --outDir dist-e2e --emptyOutDir && node server.js',
      env: {
        PORT: String(APP_PORT),
        DIST_DIR: 'dist-e2e',
        // Pinned over the developer's .env, which may point either at another port.
        VITE_WCA_CLIENT_ID: CLIENT_ID,
        VITE_WCA_REDIRECT_URI: REDIRECT_URI,
        WCA_CLIENT_SECRET: CLIENT_SECRET,
        WCA_ORIGIN: FAKE_WCA_ORIGIN,
      },
      port: APP_PORT,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
