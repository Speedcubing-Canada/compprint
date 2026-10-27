import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dist-e2e', 'coverage']),
  // The production server and the build/render tooling are Node, not browser, and were
  // previously unlinted entirely - server.js serves every request in production.
  {
    files: ['server.js', 'analytics.js', 'analytics.test.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  // Playwright fixtures hand the test a `use()` callback the hooks rule mistakes for React's.
  {
    files: ['e2e/**', 'playwright.config.ts'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
    languageOptions: { globals: globals.node },
  },
])
