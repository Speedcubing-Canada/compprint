import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Loaded for every file; the shim inside guards on the DOM existing.
    setupFiles: ['./src/test/setup.ts'],
    // Pin the one VITE_ var the app reads at module scope. Without this a test
    // inherits the developer's .env and passes locally while failing in CI,
    // where no .env exists (src/auth/wca.ts reads CLIENT_ID at import time).
    env: { VITE_WCA_CLIENT_ID: 'test-client-id' },
    // The jsdom page tests render whole wizard steps, and v8 instrumentation roughly doubles
    // that. Under --coverage they cross the 5s default on a loaded machine while passing on
    // their own, so the default fails CI on contention rather than on anything real.
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      // Files no test imports are listed on purpose: the baseline has to be the
      // honest number, not the number for whatever happens to be covered.
      include: ['src/**/*.{ts,tsx}', 'analytics.js', 'server.js'],
      exclude: [
        '**/*.test.*',
        'src/test/**',
        'src/**/*.d.ts',
        'src/assets/**',   // base64 blobs, no logic
        'src/types/**',    // type-only
        'src/main.tsx',    // bootstrap, nothing to assert
      ],
      reporter: ['text', 'json-summary', 'html'],
      // A ratchet: autoUpdate rewrites these upward on any run that improves
      // coverage, so CI only ever fails on a drop. Never lower them by hand.
      // Exception, 2026-09-10: coverage-v8 5.x stopped counting two lines 4.x
      // counted as coverable. Denominator shrank, nothing lost coverage.
      thresholds: { autoUpdate: true, lines: 91.56, functions: 88.58, branches: 82.76, statements: 89.73 },
    },
  },
});
