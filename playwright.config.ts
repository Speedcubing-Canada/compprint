import { defineConfig, devices } from '@playwright/test';

// The production build behind the production server, so the real CSP, SPA fallback and token
// proxy are what the browser meets. The WCA API is faked per page (e2e/fakeWca.ts); the token
// exchange leaves from server.js, so it goes to e2e/fakeWcaOrigin.mjs through WCA_ORIGIN.

const PORT = 4173;
const FAKE_WCA_PORT = 4180;

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'en-US',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node e2e/fakeWcaOrigin.mjs',
      env: { FAKE_WCA_PORT: String(FAKE_WCA_PORT) },
      port: FAKE_WCA_PORT,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run build && node server.js',
      env: {
        PORT: String(PORT),
        VITE_WCA_CLIENT_ID: 'e2e-client',
        WCA_CLIENT_SECRET: 'e2e-secret',
        WCA_ORIGIN: `http://127.0.0.1:${FAKE_WCA_PORT}`,
      },
      port: PORT,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
